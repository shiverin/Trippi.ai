import { runMigrations } from '../../src/db/migrations';
import { createTables } from '../../src/db/schema';
import { BookingOptionsModule } from '../../src/nest/booking-options/booking-options.module';
import { TrippiExceptionFilter } from '../../src/nest/common/trippi-exception.filter';
import { invalidatePermissionsCache } from '../../src/services/permissions';
import { authCookie } from '../helpers/auth';
import { addTripMember, createTrip, createUser } from '../helpers/factories';
import { resetTestDb } from '../helpers/test-db';
import { Test } from '@nestjs/testing';

import cookieParser from 'cookie-parser';
import type { Server } from 'http';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const { db, dbMock } = vi.hoisted(() => {
  const Database = require('better-sqlite3');
  const tmp = new Database(':memory:');
  tmp.exec('PRAGMA journal_mode = WAL');
  tmp.exec('PRAGMA foreign_keys = ON');
  tmp.exec('PRAGMA busy_timeout = 5000');
  const mock = {
    db: tmp,
    closeDb: () => {},
    reinitialize: () => {},
    getPlaceWithTags: vi.fn(),
    canAccessTrip: (tripId: string | number, userId: number) =>
      tmp
        .prepare(
          `
          SELECT t.id, t.user_id FROM trips t
          LEFT JOIN trip_members m ON m.trip_id = t.id AND m.user_id = ?
          WHERE t.id = ? AND (t.user_id = ? OR m.user_id IS NOT NULL)
        `,
        )
        .get(userId, tripId, userId),
    isOwner: (tripId: string | number, userId: number) =>
      !!tmp.prepare('SELECT id FROM trips WHERE id = ? AND user_id = ?').get(tripId, userId),
  };
  return { db: tmp, dbMock: mock };
});

vi.mock('../../src/db/database', () => dbMock);
vi.mock('../../src/config', () => ({
  JWT_SECRET: 'test-jwt-secret-for-trippi-testing-only',
  ENCRYPTION_KEY: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6a7b8c9d0e1f2a3b4c5d6a7b8c9d0e1f2',
  updateJwtSecret: () => {},
  SESSION_DURATION: '24h',
  SESSION_DURATION_MS: 86400000,
  SESSION_DURATION_SECONDS: 86400,
  DEFAULT_LANGUAGE: 'en',
}));
vi.mock('../../src/websocket', () => ({
  broadcast: vi.fn(),
  broadcastToUser: vi.fn(),
}));

function createIntent(tripId: number, userId: number, type = 'flight'): number {
  return Number(
    db
      .prepare('INSERT INTO booking_intents (trip_id, created_by, type, status) VALUES (?, ?, ?, ?)')
      .run(tripId, userId, type, 'watching').lastInsertRowid,
  );
}

describe('Booking options e2e', () => {
  let server: Server;
  let app: Awaited<ReturnType<typeof build>>;

  async function build() {
    const moduleRef = await Test.createTestingModule({
      imports: [BookingOptionsModule],
    }).compile();
    const nest = moduleRef.createNestApplication();
    nest.use(cookieParser());
    nest.useGlobalFilters(new TrippiExceptionFilter());
    await nest.init();
    return nest;
  }

  beforeAll(async () => {
    createTables(db);
    runMigrations(db);
    app = await build();
    server = app.getHttpServer();
  });

  beforeEach(() => {
    resetTestDb(db);
    invalidatePermissionsCache();
  });

  afterAll(async () => {
    await app.close();
    db.close();
  });

  it('401 without a cookie', async () => {
    expect((await request(server).get('/api/trips/5/booking-intents/8/options')).status).toBe(401);
  });

  it('upserts, lists, updates, expires, filters, and archives booking options', async () => {
    const { user } = createUser(db);
    const trip = createTrip(db, user.id);
    const intentId = createIntent(trip.id, user.id);
    const payload = {
      provider: 'mock-travel',
      externalId: 'flight-1',
      title: 'Flexible Flight',
      price: 420.5,
      currency: 'USD',
      score: 0.91,
      expiresAt: '2999-01-01T00:00:00.000Z',
      deepLink: 'https://trippi.example/checkout/flight-1',
      metadata: { rank: 1 },
    };

    const created = await request(server)
      .post(`/api/trips/${trip.id}/booking-intents/${intentId}/options`)
      .set('Cookie', authCookie(user.id))
      .send(payload);
    expect(created.status).toBe(200);
    expect(created.body.booking_option).toMatchObject({
      provider: 'mock-travel',
      external_id: 'flight-1',
      title: 'Flexible Flight',
      price: 420.5,
      currency: 'USD',
      score: 0.91,
      expires_at: '2999-01-01T00:00:00.000Z',
      checkout_url: 'https://trippi.example/checkout/flight-1',
      metadata: { rank: 1 },
      status: 'current',
      is_expired: false,
    });
    const optionId = created.body.booking_option.id;

    const upserted = await request(server)
      .post(`/api/trips/${trip.id}/booking-intents/${intentId}/options`)
      .set('Cookie', authCookie(user.id))
      .send({
        provider: 'mock-travel',
        external_id: 'flight-1',
        price: 399,
        score: 0.96,
        metadata: { rank: 1, refreshed: true },
      });
    expect(upserted.status).toBe(200);
    expect(upserted.body.booking_option).toMatchObject({
      id: optionId,
      price: 399,
      score: 0.96,
      metadata: { rank: 1, refreshed: true },
    });

    const listed = await request(server)
      .get(`/api/trips/${trip.id}/booking-intents/${intentId}/options`)
      .set('Cookie', authCookie(user.id));
    expect(listed.status).toBe(200);
    expect(listed.body.booking_options).toHaveLength(1);
    expect(listed.body.booking_options[0].id).toBe(optionId);

    const updated = await request(server)
      .put(`/api/trips/${trip.id}/booking-intents/${intentId}/options/${optionId}`)
      .set('Cookie', authCookie(user.id))
      .send({ currency: 'SGD', checkout_url: 'https://trippi.example/pay' });
    expect(updated.status).toBe(200);
    expect(updated.body.booking_option).toMatchObject({
      id: optionId,
      currency: 'SGD',
      checkout_url: 'https://trippi.example/pay',
    });

    const stale = await request(server)
      .post(`/api/trips/${trip.id}/booking-intents/${intentId}/options`)
      .set('Cookie', authCookie(user.id))
      .send({
        provider: 'mock-stale',
        expires_at: '2000-01-01T00:00:00.000Z',
        metadata: { stale: true },
      });
    expect(stale.status).toBe(200);
    expect(stale.body.booking_option.status).toBe('expired');
    expect(stale.body.booking_option.is_expired).toBe(true);

    const expired = await request(server)
      .post(`/api/trips/${trip.id}/booking-intents/${intentId}/options/${optionId}/expire`)
      .set('Cookie', authCookie(user.id));
    expect(expired.status).toBe(200);
    expect(expired.body.booking_option.status).toBe('expired');

    const expiredList = await request(server)
      .get(`/api/trips/${trip.id}/booking-intents/${intentId}/options?status=expired`)
      .set('Cookie', authCookie(user.id));
    expect(expiredList.status).toBe(200);
    expect(expiredList.body.booking_options).toHaveLength(2);

    const archived = await request(server)
      .post(`/api/trips/${trip.id}/booking-intents/${intentId}/options/${stale.body.booking_option.id}/archive`)
      .set('Cookie', authCookie(user.id));
    expect(archived.status).toBe(200);
    expect(archived.body.booking_option.status).toBe('archived');

    const defaultList = await request(server)
      .get(`/api/trips/${trip.id}/booking-intents/${intentId}/options`)
      .set('Cookie', authCookie(user.id));
    expect(defaultList.status).toBe(200);
    expect(defaultList.body.booking_options.map((option: { id: number }) => option.id)).not.toContain(
      stale.body.booking_option.id,
    );

    const archivedList = await request(server)
      .get(`/api/trips/${trip.id}/booking-intents/${intentId}/options?status=archived`)
      .set('Cookie', authCookie(user.id));
    expect(archivedList.status).toBe(200);
    expect(archivedList.body.booking_options).toHaveLength(1);
  });

  it('permission-gates mutations while allowing trip members to list', async () => {
    const { user: owner } = createUser(db);
    const { user: member } = createUser(db);
    const trip = createTrip(db, owner.id);
    const intentId = createIntent(trip.id, owner.id);
    addTripMember(db, trip.id, member.id);
    db.prepare("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('perm_reservation_edit', 'trip_owner')").run();
    invalidatePermissionsCache();

    const list = await request(server)
      .get(`/api/trips/${trip.id}/booking-intents/${intentId}/options`)
      .set('Cookie', authCookie(member.id));
    expect(list.status).toBe(200);

    const create = await request(server)
      .post(`/api/trips/${trip.id}/booking-intents/${intentId}/options`)
      .set('Cookie', authCookie(member.id))
      .send({ provider: 'mock' });
    expect(create.status).toBe(403);
    expect(create.body).toEqual({ error: 'No permission' });
  });

  it('404s outside trip or intent access and validates payloads', async () => {
    const { user: owner } = createUser(db);
    const { user: other } = createUser(db);
    const trip = createTrip(db, owner.id);
    const intentId = createIntent(trip.id, owner.id);

    const inaccessible = await request(server)
      .get(`/api/trips/${trip.id}/booking-intents/${intentId}/options`)
      .set('Cookie', authCookie(other.id));
    expect(inaccessible.status).toBe(404);

    const missingIntent = await request(server)
      .post(`/api/trips/${trip.id}/booking-intents/${intentId + 99}/options`)
      .set('Cookie', authCookie(owner.id))
      .send({ provider: 'mock' });
    expect(missingIntent.status).toBe(404);
    expect(missingIntent.body).toEqual({ error: 'Booking intent not found' });

    const missingProvider = await request(server)
      .post(`/api/trips/${trip.id}/booking-intents/${intentId}/options`)
      .set('Cookie', authCookie(owner.id))
      .send({ price: 100 });
    expect(missingProvider.status).toBe(400);
    expect(missingProvider.body).toEqual({ error: 'provider is required' });

    const badStatus = await request(server)
      .get(`/api/trips/${trip.id}/booking-intents/${intentId}/options?status=bad`)
      .set('Cookie', authCookie(owner.id));
    expect(badStatus.status).toBe(400);
    expect(badStatus.body.error).toContain('status must be one of');
  });
});
