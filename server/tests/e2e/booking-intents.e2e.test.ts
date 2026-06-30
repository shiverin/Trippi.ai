import { runMigrations } from '../../src/db/migrations';
import { createTables } from '../../src/db/schema';
import { BookingIntentsModule } from '../../src/nest/booking-intents/booking-intents.module';
import { TrippiExceptionFilter } from '../../src/nest/common/trippi-exception.filter';
import { invalidatePermissionsCache } from '../../src/services/permissions';
import { authCookie } from '../helpers/auth';
import { addTripMember, createReservation, createTrip, createUser } from '../helpers/factories';
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

function createApprovedBookingOption(tripId: number, userId: number, intentId: number): number {
  db.prepare("UPDATE booking_intents SET status = 'approved' WHERE id = ?").run(intentId);
  const optionId = Number(
    db
      .prepare(
        `
        INSERT INTO booking_options
          (booking_intent_id, provider, external_id, title, price, currency, score, checkout_url, status)
        VALUES (?, 'mock-travel', 'flight-flex', 'Flexible Flight', 420, 'USD', 0.9, ?, 'current')
      `,
      )
      .run(intentId, 'https://provider.example/checkout/flight-flex').lastInsertRowid,
  );
  const decisionId = Number(
    db
      .prepare(
        "INSERT INTO group_decisions (trip_id, created_by, title, state) VALUES (?, ?, 'Approve booking option', 'decided')",
      )
      .run(tripId, userId).lastInsertRowid,
  );
  const decisionOptionId = Number(
    db
      .prepare(
        "INSERT INTO group_decision_options (decision_id, booking_option_id, label, sort_order) VALUES (?, ?, 'Flexible Flight', 0)",
      )
      .run(decisionId, optionId).lastInsertRowid,
  );
  db.prepare('UPDATE group_decisions SET final_option_id = ? WHERE id = ?').run(decisionOptionId, decisionId);
  db.prepare(
    "INSERT INTO group_decision_links (decision_id, target_type, target_id) VALUES (?, 'booking_intent', ?)",
  ).run(decisionId, intentId);
  return optionId;
}

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

  it('starts a price watch with UI-ready watch status and an idempotent agent job', async () => {
    const { user } = createUser(db);
    const trip = createTrip(db, user.id);
    const created = await request(server)
      .post(`/api/trips/${trip.id}/booking-intents`)
      .set('Cookie', authCookie(user.id))
      .send({
        type: 'hotel',
        destination: 'Kyoto',
        dates: { checkIn: '2026-11-02', checkOut: '2026-11-05' },
        budget: { max: 900, currency: 'USD' },
      });
    const intentId = created.body.booking_intent.id;

    const started = await request(server)
      .post(`/api/trips/${trip.id}/booking-intents/${intentId}/start-watch`)
      .set('Cookie', authCookie(user.id));
    const duplicate = await request(server)
      .post(`/api/trips/${trip.id}/booking-intents/${intentId}/start-watch`)
      .set('Cookie', authCookie(user.id));

    expect(started.status).toBe(200);
    expect(started.body.booking_intent).toMatchObject({
      id: intentId,
      status: 'watching',
      watch_status: 'queued',
      last_checked_at: null,
    });
    expect(started.body.agent_job).toMatchObject({
      type: 'booking-intent.price-watch',
      status: 'queued',
      idempotency_key: `booking-intent:${intentId}:price-watch`,
      provider: 'mock-travel',
      provider_mode: 'mock-development-provider',
    });
    expect(duplicate.body.agent_job.id).toBe(started.body.agent_job.id);
    expect(db.prepare('SELECT COUNT(*) AS c FROM agent_jobs').get()).toMatchObject({ c: 1 });

    const listed = await request(server)
      .get(`/api/trips/${trip.id}/booking-intents?status=watching`)
      .set('Cookie', authCookie(user.id));
    expect(listed.body.booking_intents[0]).toMatchObject({
      id: intentId,
      watch_status: 'queued',
      last_checked_at: null,
    });
  });

  it('hands off approved checkout links and records booked confirmation metadata', async () => {
    const { user } = createUser(db);
    const trip = createTrip(db, user.id);
    const created = await request(server)
      .post(`/api/trips/${trip.id}/booking-intents`)
      .set('Cookie', authCookie(user.id))
      .send({
        type: 'flight',
        status: 'options_ready',
      });
    const intentId = created.body.booking_intent.id;

    const unapproved = await request(server)
      .post(`/api/trips/${trip.id}/booking-intents/${intentId}/checkout-handoff`)
      .set('Cookie', authCookie(user.id));
    expect(unapproved.status).toBe(400);
    expect(unapproved.body.error).toContain('approved');

    const optionId = createApprovedBookingOption(trip.id, user.id, intentId);
    const handoff = await request(server)
      .post(`/api/trips/${trip.id}/booking-intents/${intentId}/checkout-handoff`)
      .set('Cookie', authCookie(user.id));
    expect(handoff.status).toBe(200);
    expect(handoff.body.handoff).toMatchObject({
      provider: 'mock-travel',
      option_id: optionId,
      external_id: 'flight-flex',
      checkout_url: 'https://provider.example/checkout/flight-flex',
    });
    expect(handoff.body.booking_intent).toMatchObject({
      status: 'pending_checkout',
      checkout_option_id: optionId,
      checkout_provider: 'mock-travel',
      checkout_url: 'https://provider.example/checkout/flight-flex',
    });

    const reservation = createReservation(db, trip.id, {
      title: 'Flexible Flight',
      type: 'flight',
    });
    const booked = await request(server)
      .post(`/api/trips/${trip.id}/booking-intents/${intentId}/mark-booked`)
      .set('Cookie', authCookie(user.id))
      .send({
        reservation_id: reservation.id,
        reservation_url: 'https://provider.example/reservations/ABC123',
        confirmation_number: 'ABC123',
      });
    expect(booked.status).toBe(200);
    expect(booked.body.booking_intent).toMatchObject({
      status: 'booked',
      checkout_option_id: optionId,
      checkout_provider: 'mock-travel',
      reservation_id: reservation.id,
      reservation_url: 'https://provider.example/reservations/ABC123',
      confirmation_number: 'ABC123',
    });
    expect(booked.body.booking_intent.booked_at).toEqual(expect.any(String));

    const archived = await request(server)
      .post(`/api/trips/${trip.id}/booking-intents/${intentId}/archive`)
      .set('Cookie', authCookie(user.id));
    expect(archived.status).toBe(200);
    expect(archived.body.booking_intent.status).toBe('archived');
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
