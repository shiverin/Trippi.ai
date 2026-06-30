import { runMigrations } from '../../../src/db/migrations';
import { createTables } from '../../../src/db/schema';
import {
  BookingOptionValidationError,
  BookingOptionsService,
} from '../../../src/nest/booking-options/booking-options.service';
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
  return new BookingOptionsService();
}

let seedSeq = 0;

function seedTrip(): { user: User; tripId: number; intentId: number } {
  seedSeq++;
  const userId = Number(
    db
      .prepare('INSERT INTO users (username, email, password_hash, role) VALUES (?, ?, ?, ?)')
      .run(`owner${seedSeq}`, `owner${seedSeq}@test`, 'hash', 'user').lastInsertRowid,
  );
  const tripId = Number(
    db.prepare("INSERT INTO trips (user_id, title) VALUES (?, 'Trip')").run(userId).lastInsertRowid,
  );
  const intentId = Number(
    db
      .prepare("INSERT INTO booking_intents (trip_id, created_by, type, status) VALUES (?, ?, 'flight', 'watching')")
      .run(tripId, userId).lastInsertRowid,
  );
  return {
    user: {
      id: userId,
      username: `owner${seedSeq}`,
      email: `owner${seedSeq}@test`,
      role: 'user',
    } as User,
    tripId,
    intentId,
  };
}

beforeAll(() => {
  db.exec('PRAGMA foreign_keys = ON');
  createTables(db as Database.Database);
  runMigrations(db as Database.Database);
});

beforeEach(() => {
  db.exec(`
    DELETE FROM booking_options;
    DELETE FROM booking_intents;
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

describe('BookingOptionsService', () => {
  it('creates the booking_options schema with trip-scoped intent linkage', () => {
    const columns = new Set(
      (
        db.prepare("PRAGMA table_info('booking_options')").all() as Array<{
          name: string;
        }>
      ).map((column) => column.name),
    );
    expect([...columns]).toEqual(
      expect.arrayContaining([
        'booking_intent_id',
        'provider',
        'price',
        'currency',
        'score',
        'expires_at',
        'checkout_url',
        'metadata',
        'status',
      ]),
    );

    const foreignKeys = db.prepare("PRAGMA foreign_key_list('booking_options')").all() as Array<{
      table: string;
      from: string;
    }>;
    expect(foreignKeys).toContainEqual(
      expect.objectContaining({ table: 'booking_intents', from: 'booking_intent_id' }),
    );

    const indexes = new Set(
      (db.prepare("PRAGMA index_list('booking_options')").all() as Array<{ name: string }>).map((index) => index.name),
    );
    expect([...indexes]).toEqual(
      expect.arrayContaining([
        'idx_booking_options_intent_id',
        'idx_booking_options_status',
        'idx_booking_options_provider_external',
      ]),
    );
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

  it('upserts worker results by provider external ID and lists normalized options', async () => {
    const { tripId, intentId } = seedTrip();
    const created = await service().upsertFromWorker(String(tripId), String(intentId), {
      provider: 'mock-travel',
      externalId: 'flight-1',
      title: 'Flexible Flight',
      price: 420.5,
      currency: 'USD',
      score: 0.91,
      expiresAt: '2999-01-01T00:00:00.000Z',
      deepLink: 'https://trippi.example/checkout/flight-1',
      metadata: { rank: 1, refundable: true },
    });

    expect(created).toMatchObject({
      booking_intent_id: intentId,
      provider: 'mock-travel',
      external_id: 'flight-1',
      title: 'Flexible Flight',
      price: 420.5,
      currency: 'USD',
      score: 0.91,
      expires_at: '2999-01-01T00:00:00.000Z',
      checkout_url: 'https://trippi.example/checkout/flight-1',
      metadata: { rank: 1, refundable: true },
      status: 'current',
      is_expired: false,
    });

    const updated = await service().upsertFromWorker(String(tripId), String(intentId), {
      provider: 'mock-travel',
      external_id: 'flight-1',
      price: 399,
      score: 0.96,
      metadata: { rank: 1, refreshed: true },
    });
    expect(updated).toMatchObject({
      id: created!.id,
      price: 399,
      score: 0.96,
      metadata: { rank: 1, refreshed: true },
      status: 'current',
    });

    const rows = await service().list(String(tripId), String(intentId));
    expect(rows).toHaveLength(1);
    expect(rows![0].id).toBe(created!.id);
    expect(db.prepare('SELECT COUNT(*) AS count FROM booking_options').get()).toEqual({ count: 1 });
  });

  it('keeps options scoped through their booking intent', async () => {
    const { tripId, intentId } = seedTrip();
    const other = seedTrip();
    const option = await service().upsertFromWorker(String(tripId), String(intentId), {
      provider: 'mock-travel',
      price: 100,
    });

    await expect(service().list(String(other.tripId), String(intentId))).resolves.toBeNull();
    await expect(
      service().update(String(other.tripId), String(intentId), String(option!.id), {
        price: 1,
      }),
    ).resolves.toBeNull();
    await expect(service().list(String(tripId), String(other.intentId))).resolves.toBeNull();
  });

  it('distinguishes current, expired, and archived options in list filters', async () => {
    const { tripId, intentId } = seedTrip();
    const current = await service().upsertFromWorker(String(tripId), String(intentId), {
      provider: 'mock-current',
      score: 0.8,
      expires_at: '2999-01-01T00:00:00.000Z',
    });
    const expiredByTime = await service().upsertFromWorker(String(tripId), String(intentId), {
      provider: 'mock-stale',
      score: 0.7,
      expires_at: '2000-01-01T00:00:00.000Z',
    });
    const expiredByStatus = await service().upsertFromWorker(String(tripId), String(intentId), {
      provider: 'mock-expired',
      status: 'expired',
    });
    const archived = await service().upsertFromWorker(String(tripId), String(intentId), {
      provider: 'mock-archived',
    });
    await service().archive(String(tripId), String(intentId), String(archived!.id));

    await expect(service().list(String(tripId), String(intentId))).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: current!.id, status: 'current', is_expired: false }),
        expect.objectContaining({ id: expiredByTime!.id, status: 'expired', is_expired: true }),
        expect.objectContaining({ id: expiredByStatus!.id, status: 'expired', is_expired: true }),
      ]),
    );
    await expect(service().list(String(tripId), String(intentId), 'current')).resolves.toEqual([
      expect.objectContaining({ id: current!.id }),
    ]);
    await expect(service().list(String(tripId), String(intentId), 'expired')).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: expiredByTime!.id }),
        expect.objectContaining({ id: expiredByStatus!.id }),
      ]),
    );
    await expect(service().list(String(tripId), String(intentId), 'archived')).resolves.toEqual([
      expect.objectContaining({ id: archived!.id, status: 'archived' }),
    ]);
    await expect(service().list(String(tripId), String(intentId), 'all')).resolves.toHaveLength(4);
  });

  it('updates, expires, and archives trip-scoped options', async () => {
    const { tripId, intentId } = seedTrip();
    const option = await service().upsertFromWorker(String(tripId), String(intentId), {
      provider: 'mock-travel',
      price: 120,
    });

    await expect(
      service().update(String(tripId), String(intentId), String(option!.id), {
        currency: 'EUR',
        checkout_url: 'https://trippi.example/pay',
      }),
    ).resolves.toMatchObject({
      currency: 'EUR',
      checkout_url: 'https://trippi.example/pay',
    });
    await expect(service().expire(String(tripId), String(intentId), String(option!.id))).resolves.toMatchObject({
      status: 'expired',
      is_expired: true,
    });
    await expect(service().archive(String(tripId), String(intentId), String(option!.id))).resolves.toMatchObject({
      status: 'archived',
      is_expired: false,
    });
    await expect(service().archive(String(tripId), String(intentId), '999')).resolves.toBeNull();
  });

  it('validates required fields, numeric values, status, dates, and metadata', async () => {
    const { tripId, intentId } = seedTrip();
    await expect(service().upsertFromWorker(String(tripId), String(intentId), {})).rejects.toThrow(
      BookingOptionValidationError,
    );
    await expect(
      service().upsertFromWorker(String(tripId), String(intentId), {
        provider: 'mock',
        price: -1,
      }),
    ).rejects.toThrow('price must be greater than or equal to 0');
    await expect(
      service().upsertFromWorker(String(tripId), String(intentId), {
        provider: 'mock',
        score: Number.NaN,
      }),
    ).rejects.toThrow('score must be a finite number');
    await expect(
      service().upsertFromWorker(String(tripId), String(intentId), {
        provider: 'mock',
        status: 'bad',
      }),
    ).rejects.toThrow('status must be one of');
    await expect(
      service().upsertFromWorker(String(tripId), String(intentId), {
        provider: 'mock',
        expires_at: 'not-a-date',
      }),
    ).rejects.toThrow('expires_at must be a valid date/time');
    await expect(
      service().upsertFromWorker(String(tripId), String(intentId), {
        provider: 'mock',
        metadata: [],
      }),
    ).rejects.toThrow('metadata must be an object');
    await expect(service().list(String(tripId), String(intentId), 'bad')).rejects.toThrow('status must be one of');
  });
});
