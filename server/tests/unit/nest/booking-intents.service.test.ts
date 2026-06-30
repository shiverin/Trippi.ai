import { runMigrations } from '../../../src/db/migrations';
import { createTables } from '../../../src/db/schema';
import {
  BookingIntentValidationError,
  BookingIntentsService,
} from '../../../src/nest/booking-intents/booking-intents.service';
import type { User } from '../../../src/types';

import Database from 'better-sqlite3';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const { db, canAccessTripAsync, checkPermissionAsync } = vi.hoisted(() => {
  const DatabaseCtor = require('better-sqlite3');
  return {
    db: new DatabaseCtor(':memory:'),
    canAccessTripAsync: vi.fn(),
    checkPermissionAsync: vi.fn(),
  };
});

vi.mock('../../../src/db/asyncDatabase', () => ({
  asyncDb: {
    prepare: (sql: string) => {
      const statement = db.prepare(sql);
      return {
        get: async (...args: unknown[]) => statement.get(...args),
        all: async (...args: unknown[]) => statement.all(...args),
        run: async (...args: unknown[]) => statement.run(...args),
      };
    },
    exec: async (sql: string) => db.exec(sql),
    transaction: (fn: (...args: unknown[]) => unknown) => {
      const run = async (...args: unknown[]) => {
        db.exec('BEGIN');
        try {
          const result = await fn(...args);
          db.exec('COMMIT');
          return result;
        } catch (err) {
          db.exec('ROLLBACK');
          throw err;
        }
      };
      return Object.assign(run, {
        default: run,
        deferred: run,
        immediate: run,
        exclusive: run,
      });
    },
    close: async () => {},
    pragma: async (source: string) => db.pragma(source),
  },
  canAccessTripAsync,
  closeAsyncDb: async () => {},
}));
vi.mock('../../../src/services/permissions', () => ({ checkPermissionAsync }));
vi.mock('../../../src/websocket', () => ({ broadcast: vi.fn() }));

function service() {
  return new BookingIntentsService();
}

let seedSeq = 0;

function seedTrip(): { user: User; tripId: number } {
  seedSeq++;
  const userId = Number(
    db
      .prepare('INSERT INTO users (username, email, password_hash, role) VALUES (?, ?, ?, ?)')
      .run(`owner${seedSeq}`, `owner${seedSeq}@test`, 'hash', 'user').lastInsertRowid,
  );
  const tripId = Number(
    db.prepare("INSERT INTO trips (user_id, title) VALUES (?, 'Trip')").run(userId).lastInsertRowid,
  );
  return {
    user: {
      id: userId,
      username: `owner${seedSeq}`,
      email: `owner${seedSeq}@test`,
      role: 'user',
    } as User,
    tripId,
  };
}

function seedApprovedBookingOption(
  tripId: number,
  userId: number,
  intentId: number,
  overrides: Partial<{
    externalId: string;
    title: string;
    checkoutUrl: string;
    status: string;
    intentStatus: string;
  }> = {},
): number {
  db.prepare('UPDATE booking_intents SET status = ? WHERE id = ?').run(overrides.intentStatus ?? 'approved', intentId);
  const optionId = Number(
    db
      .prepare(
        `
        INSERT INTO booking_options
          (booking_intent_id, provider, external_id, title, price, currency, score, checkout_url, status)
        VALUES (?, 'mock-travel', ?, ?, 420, 'USD', 0.9, ?, ?)
      `,
      )
      .run(
        intentId,
        overrides.externalId ?? 'flight-flex',
        overrides.title ?? 'Flexible Flight',
        overrides.checkoutUrl ?? 'https://provider.example/checkout/flight-flex',
        overrides.status ?? 'current',
      ).lastInsertRowid,
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
        'INSERT INTO group_decision_options (decision_id, booking_option_id, label, sort_order) VALUES (?, ?, ?, 0)',
      )
      .run(decisionId, optionId, overrides.title ?? 'Flexible Flight').lastInsertRowid,
  );
  db.prepare('UPDATE group_decisions SET final_option_id = ? WHERE id = ?').run(decisionOptionId, decisionId);
  db.prepare(
    "INSERT INTO group_decision_links (decision_id, target_type, target_id) VALUES (?, 'booking_intent', ?)",
  ).run(decisionId, intentId);
  return optionId;
}

beforeAll(() => {
  db.exec('PRAGMA foreign_keys = ON');
  createTables(db as Database.Database);
  runMigrations(db as Database.Database);
});

beforeEach(() => {
  db.exec(`
    DELETE FROM agent_jobs;
    DELETE FROM group_decision_links;
    DELETE FROM group_decision_responses;
    DELETE FROM group_decision_options;
    DELETE FROM group_decisions;
    DELETE FROM booking_options;
    DELETE FROM booking_intents;
    DELETE FROM reservations;
    DELETE FROM trip_members;
    DELETE FROM trips;
    DELETE FROM users;
    DELETE FROM app_settings;
  `);
  vi.clearAllMocks();
});

afterAll(() => {
  db.close();
});

describe('BookingIntentsService', () => {
  it('creates checkout handoff columns and accepts the pending_checkout status', () => {
    const { user, tripId } = seedTrip();
    const columns = new Set(
      (
        db.prepare("PRAGMA table_info('booking_intents')").all() as Array<{
          name: string;
        }>
      ).map((column) => column.name),
    );
    expect([...columns]).toEqual(
      expect.arrayContaining([
        'checkout_option_id',
        'checkout_provider',
        'checkout_url',
        'checkout_started_at',
        'booked_at',
        'reservation_id',
        'reservation_url',
        'confirmation_number',
      ]),
    );

    expect(() =>
      db
        .prepare("INSERT INTO booking_intents (trip_id, created_by, type, status) VALUES (?, ?, 'flight', ?)")
        .run(tripId, user.id, 'pending_checkout'),
    ).not.toThrow();
  });

  it('delegates trip access and reservation_edit permission checks', async () => {
    canAccessTripAsync.mockResolvedValue({ id: 5, user_id: 2 });
    checkPermissionAsync.mockResolvedValue(true);
    const trip = await service().verifyTripAccess('5', 1);
    expect(trip).toEqual({ id: 5, user_id: 2 });
    expect(canAccessTripAsync).toHaveBeenCalledWith('5', 1);

    await expect(service().canEdit({ id: 5, user_id: 2 }, { id: 1, role: 'user' } as User)).resolves.toBe(true);
    expect(checkPermissionAsync).toHaveBeenCalledWith('reservation_edit', 'user', 2, 1, true);
  });

  it('creates and lists booking intents with all accepted fields', async () => {
    const { user, tripId } = seedTrip();
    const created = await service().create(String(tripId), user.id, {
      type: 'flight',
      dates: { depart: '2026-08-01', return: '2026-08-10' },
      origin: 'SFO',
      destination: 'HND',
      party_constraints: { adults: 2, seats: ['aisle'] },
      budget: { max: 2400, currency: 'USD' },
      preferences: { nonstop: true },
      status: 'watching',
      watch_status: 'idle',
      last_checked_at: null,
    });

    expect(created).toMatchObject({
      trip_id: tripId,
      created_by: user.id,
      type: 'flight',
      dates: { depart: '2026-08-01', return: '2026-08-10' },
      origin: 'SFO',
      destination: 'HND',
      party_constraints: { adults: 2, seats: ['aisle'] },
      budget: { max: 2400, currency: 'USD' },
      preferences: { nonstop: true },
      status: 'watching',
    });

    await expect(service().list(String(tripId))).resolves.toHaveLength(1);
    await expect(service().list(String(tripId), 'watching')).resolves.toHaveLength(1);
    await expect(service().list(String(tripId), 'draft')).resolves.toHaveLength(0);
  });

  it('updates and archives trip-scoped intents', async () => {
    const { user, tripId } = seedTrip();
    const created = await service().create(String(tripId), user.id, {
      type: 'hotel',
    });

    const updated = await service().update(String(tripId), String(created!.id), {
      type: 'stay',
      budget: { max: 1200, currency: 'EUR' },
      status: 'options_ready',
    });
    expect(updated).toMatchObject({
      id: created!.id,
      type: 'stay',
      budget: { max: 1200, currency: 'EUR' },
      status: 'options_ready',
    });

    await expect(
      service().update(String(tripId + 1), String(created!.id), {
        status: 'approved',
      }),
    ).resolves.toBeNull();
    await expect(service().archive(String(tripId), String(created!.id))).resolves.toMatchObject({ status: 'archived' });
    await expect(service().archive(String(tripId), '999')).resolves.toBeNull();
  });

  it('prepares checkout handoff only after approval and records provider option metadata', async () => {
    const { user, tripId } = seedTrip();
    const created = await service().create(String(tripId), user.id, {
      type: 'flight',
      status: 'options_ready',
    });
    const optionId = seedApprovedBookingOption(tripId, user.id, created!.id, {
      checkoutUrl: 'trippi-provider://checkout/flight-flex',
      status: 'current',
      intentStatus: 'approved',
    });

    await db.prepare("UPDATE booking_intents SET status = 'options_ready' WHERE id = ?").run(created!.id);
    await expect(service().prepareCheckoutHandoff(String(tripId), String(created!.id))).rejects.toThrow(
      'booking intent must be approved before checkout handoff',
    );

    await db.prepare("UPDATE booking_intents SET status = 'approved' WHERE id = ?").run(created!.id);
    const result = await service().prepareCheckoutHandoff(String(tripId), String(created!.id));

    expect(result?.handoff).toMatchObject({
      provider: 'mock-travel',
      option_id: optionId,
      external_id: 'flight-flex',
      title: 'Flexible Flight',
      checkout_url: 'trippi-provider://checkout/flight-flex',
    });
    expect(result?.handoff.opened_at).toEqual(expect.any(String));
    expect(result?.bookingIntent).toMatchObject({
      id: created!.id,
      status: 'pending_checkout',
      checkout_option_id: optionId,
      checkout_provider: 'mock-travel',
      checkout_url: 'trippi-provider://checkout/flight-flex',
      checkout_started_at: result?.handoff.opened_at,
    });
  });

  it('marks approved checkout intents as booked and can attach confirmation metadata later', async () => {
    const { user, tripId } = seedTrip();
    const created = await service().create(String(tripId), user.id, {
      type: 'hotel',
      status: 'approved',
    });
    const optionId = seedApprovedBookingOption(tripId, user.id, created!.id, {
      title: 'Old Town Stay',
      checkoutUrl: 'https://provider.example/checkout/hotel-1',
      intentStatus: 'approved',
    });
    const reservationId = Number(
      db
        .prepare(
          "INSERT INTO reservations (trip_id, title, type, status, confirmation_number) VALUES (?, 'Old Town Stay', 'hotel', 'confirmed', 'ABC123')",
        )
        .run(tripId).lastInsertRowid,
    );

    const booked = await service().markBooked(String(tripId), String(created!.id), {
      reservation_id: reservationId,
      reservation_url: 'https://provider.example/reservations/ABC123',
      confirmation_number: 'ABC123',
    });

    expect(booked).toMatchObject({
      id: created!.id,
      status: 'booked',
      checkout_option_id: optionId,
      checkout_provider: 'mock-travel',
      checkout_url: 'https://provider.example/checkout/hotel-1',
      reservation_id: reservationId,
      reservation_url: 'https://provider.example/reservations/ABC123',
      confirmation_number: 'ABC123',
    });
    expect(booked?.checkout_started_at).toEqual(expect.any(String));
    expect(booked?.booked_at).toEqual(expect.any(String));

    const attachedLater = await service().markBooked(String(tripId), String(created!.id), {
      confirmationNumber: 'XYZ789',
    });
    expect(attachedLater).toMatchObject({
      status: 'booked',
      reservation_id: reservationId,
      reservation_url: 'https://provider.example/reservations/ABC123',
      confirmation_number: 'XYZ789',
    });
  });

  it('rejects booked metadata that points to another trip reservation', async () => {
    const { user, tripId } = seedTrip();
    const other = seedTrip();
    const created = await service().create(String(tripId), user.id, {
      type: 'flight',
      status: 'approved',
    });
    seedApprovedBookingOption(tripId, user.id, created!.id, {
      checkoutUrl: 'https://provider.example/checkout/flight-1',
      intentStatus: 'approved',
    });
    const otherReservationId = Number(
      db
        .prepare("INSERT INTO reservations (trip_id, title, type, status) VALUES (?, 'Other', 'flight', 'confirmed')")
        .run(other.tripId).lastInsertRowid,
    );

    await expect(
      service().markBooked(String(tripId), String(created!.id), {
        reservationId: otherReservationId,
      }),
    ).rejects.toThrow('reservation_id must belong to this trip');
  });

  it('starts watching and idempotently enqueues a price-watch job', async () => {
    const { user, tripId } = seedTrip();
    const created = await service().create(String(tripId), user.id, {
      type: 'hotel',
      destination: 'Kyoto',
      dates: { checkIn: '2026-11-02', checkOut: '2026-11-05' },
      budget: { max: 900, currency: 'USD' },
    });

    const first = await service().startWatch(String(tripId), String(created!.id));
    const second = await service().startWatch(String(tripId), String(created!.id));

    expect(first?.bookingIntent).toMatchObject({
      id: created!.id,
      status: 'watching',
      watch_status: 'queued',
      last_checked_at: null,
    });
    expect(first?.agentJob).toMatchObject({
      type: 'booking-intent.price-watch',
      status: 'queued',
      idempotency_key: `booking-intent:${created!.id}:price-watch`,
      provider: 'mock-travel',
      provider_mode: 'mock-development-provider',
    });
    expect(second?.agentJob.id).toBe(first?.agentJob.id);
    expect(db.prepare('SELECT COUNT(*) AS c FROM agent_jobs').get()).toMatchObject({ c: 1 });

    const stored = await service().list(String(tripId), 'watching');
    expect(stored[0]).toMatchObject({
      id: created!.id,
      watch_status: 'queued',
      last_checked_at: null,
    });
  });

  it('validates status, type, string lengths, and object fields', async () => {
    const { user, tripId } = seedTrip();
    await expect(service().create(String(tripId), user.id, {})).rejects.toThrow(BookingIntentValidationError);
    await expect(
      service().create(String(tripId), user.id, {
        type: 'flight',
        status: 'bad',
      }),
    ).rejects.toThrow('status must be one of');
    await expect(service().create(String(tripId), user.id, { type: 'flight', budget: [] })).rejects.toThrow(
      'budget must be an object',
    );
    await expect(service().create(String(tripId), user.id, { type: 'x'.repeat(65) })).rejects.toThrow(
      'type must be 64 characters or less',
    );
  });
});
