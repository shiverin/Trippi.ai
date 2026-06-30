import { runMigrations } from '../../src/db/migrations';
import { createTables } from '../../src/db/schema';
import { BookingIntentsModule } from '../../src/nest/booking-intents/booking-intents.module';
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

describe('Booking intents e2e', () => {
  let server: Server;
  let app: Awaited<ReturnType<typeof build>>;

  async function build() {
    const moduleRef = await Test.createTestingModule({
      imports: [BookingIntentsModule],
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
    expect((await request(server).get('/api/trips/5/booking-intents')).status).toBe(401);
  });

  it('creates, lists, updates, filters, and archives a booking intent', async () => {
    const { user } = createUser(db);
    const trip = createTrip(db, user.id);
    const payload = {
      type: 'flight',
      dates: { depart: '2026-08-01', return: '2026-08-10' },
      origin: 'SFO',
      destination: 'HND',
      party_constraints: { adults: 2 },
      budget: { max: 2400, currency: 'USD' },
      preferences: { nonstop: true },
      status: 'watching',
    };

    const created = await request(server)
      .post(`/api/trips/${trip.id}/booking-intents`)
      .set('Cookie', authCookie(user.id))
      .send(payload);
    expect(created.status).toBe(201);
    expect(created.body.booking_intent).toMatchObject(payload);

    const intentId = created.body.booking_intent.id;
    const listed = await request(server)
      .get(`/api/trips/${trip.id}/booking-intents`)
      .set('Cookie', authCookie(user.id));
    expect(listed.status).toBe(200);
    expect(listed.body.booking_intents).toHaveLength(1);
    expect(listed.body.booking_intents[0].id).toBe(intentId);

    const updated = await request(server)
      .put(`/api/trips/${trip.id}/booking-intents/${intentId}`)
      .set('Cookie', authCookie(user.id))
      .send({
        status: 'options_ready',
        budget: { max: 2200, currency: 'USD' },
      });
    expect(updated.status).toBe(200);
    expect(updated.body.booking_intent.status).toBe('options_ready');
    expect(updated.body.booking_intent.budget).toEqual({
      max: 2200,
      currency: 'USD',
    });

    const filtered = await request(server)
      .get(`/api/trips/${trip.id}/booking-intents?status=options_ready`)
      .set('Cookie', authCookie(user.id));
    expect(filtered.status).toBe(200);
    expect(filtered.body.booking_intents).toHaveLength(1);

    const archived = await request(server)
      .post(`/api/trips/${trip.id}/booking-intents/${intentId}/archive`)
      .set('Cookie', authCookie(user.id));
    expect(archived.status).toBe(200);
    expect(archived.body.booking_intent.status).toBe('archived');
  });

  it('permission-gates mutations while allowing trip members to list', async () => {
    const { user: owner } = createUser(db);
    const { user: member } = createUser(db);
    const trip = createTrip(db, owner.id);
    addTripMember(db, trip.id, member.id);
    db.prepare("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('perm_reservation_edit', 'trip_owner')").run();
    invalidatePermissionsCache();

    const list = await request(server)
      .get(`/api/trips/${trip.id}/booking-intents`)
      .set('Cookie', authCookie(member.id));
    expect(list.status).toBe(200);

    const create = await request(server)
      .post(`/api/trips/${trip.id}/booking-intents`)
      .set('Cookie', authCookie(member.id))
      .send({ type: 'hotel' });
    expect(create.status).toBe(403);
    expect(create.body).toEqual({ error: 'No permission' });
  });

  it('404s outside trip access and validates payloads', async () => {
    const { user: owner } = createUser(db);
    const { user: other } = createUser(db);
    const trip = createTrip(db, owner.id);

    const inaccessible = await request(server)
      .get(`/api/trips/${trip.id}/booking-intents`)
      .set('Cookie', authCookie(other.id));
    expect(inaccessible.status).toBe(404);

    const missingType = await request(server)
      .post(`/api/trips/${trip.id}/booking-intents`)
      .set('Cookie', authCookie(owner.id))
      .send({ budget: { max: 100 } });
    expect(missingType.status).toBe(400);
    expect(missingType.body).toEqual({ error: 'type is required' });

    const badStatus = await request(server)
      .post(`/api/trips/${trip.id}/booking-intents`)
      .set('Cookie', authCookie(owner.id))
      .send({ type: 'flight', status: 'pending' });
    expect(badStatus.status).toBe(400);
    expect(badStatus.body.error).toContain('status must be one of');
  });
});
