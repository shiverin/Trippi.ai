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

function seedTrip(): { user: User; tripId: number } {
  const userId = Number(
    db
      .prepare(
        "INSERT INTO users (username, email, password_hash, role) VALUES ('owner', 'owner@test', 'hash', 'user')",
      )
      .run().lastInsertRowid,
  );
  const tripId = Number(
    db.prepare("INSERT INTO trips (user_id, title) VALUES (?, 'Trip')").run(userId).lastInsertRowid,
  );
  return {
    user: {
      id: userId,
      username: 'owner',
      email: 'owner@test',
      role: 'user',
    } as User,
    tripId,
  };
}

beforeAll(() => {
  db.exec('PRAGMA foreign_keys = ON');
  createTables(db as Database.Database);
  runMigrations(db as Database.Database);
});

beforeEach(() => {
  db.exec(`
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

describe('BookingIntentsService', () => {
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
