import { Place, Tag } from '../types';
import { runMigrations } from './migrations';
import { OracleNativeAdapter } from './oracleNativeAdapter';
import { requestedOracleNative, resolveDbProvider } from './providerMode';
import { createTables } from './schema';
import { runSeeds } from './seeds';

import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

// In test mode each vitest worker gets an isolated in-memory DB so that
// parallel forks can't race on the same file or share migration state.
const isTest = process.env.NODE_ENV === 'test';
const dbProvider = resolveDbProvider();
const isOracleNative = dbProvider === 'oracle-native-blocking';
const isOracleAsync = dbProvider === 'oracle-async';

if (requestedOracleNative() && !isOracleNative) {
  console.warn(
    '[DB] TRIPPI_DB_PROVIDER=oracle-native requested, but ORACLE_NATIVE_ALLOW_BLOCKING is not true. ' +
      'Falling back to Oracle-backed SQLite mode so slow Oracle calls cannot block the HTTP server.',
  );
}

let dbPath: string;
if (isTest) {
  dbPath = ':memory:';
} else if (process.env.TRIPPI_DB_FILE) {
  // Explicit DB file (used by the Playwright E2E harness to run against an
  // isolated, throwaway database instead of the real data/travel.db). Purely
  // additive — when unset the default path below is used exactly as before.
  dbPath = process.env.TRIPPI_DB_FILE;
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
} else {
  const dataDir = path.join(__dirname, '../../data');
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  dbPath = path.join(dataDir, 'travel.db');
}

type DbConnection = Database.Database | OracleNativeAdapter;

let _db: DbConnection | null = null;

function initDb(): void {
  if (_db) {
    if (!isOracleNativeConnection(_db)) {
      try {
        _db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
      } catch (e) {}
    }
    try {
      _db.close();
    } catch (e) {}
    _db = null;
  }

  if (isOracleAsync) {
    console.log('[DB] Async Oracle provider selected; sync SQLite database is disabled');
    return;
  }

  if (isOracleNative) {
    _db = new OracleNativeAdapter({
      env: process.env,
      syncTimeoutMs: Number(process.env.ORACLE_NATIVE_SYNC_TIMEOUT_MS || 60000),
      startupTimeoutMs: Number(process.env.ORACLE_NATIVE_STARTUP_TIMEOUT_MS || 60000),
    });
    console.log('[DB] Native Oracle provider enabled');
    return;
  }

  _db = new Database(dbPath);
  _db.exec('PRAGMA journal_mode = WAL');
  _db.exec('PRAGMA busy_timeout = 5000');
  _db.exec('PRAGMA foreign_keys = ON');

  createTables(_db);
  runMigrations(_db);

  runSeeds(_db);
}

initDb();

const db = new Proxy({} as Database.Database, {
  get(_, prop: string | symbol) {
    if (!_db) {
      if (isOracleAsync) {
        throw new Error('Sync database access is disabled when TRIPPI_DB_PROVIDER=oracle-async. Use asyncDb instead.');
      }
      throw new Error('Database connection is not available (restore in progress?)');
    }
    const val = (_db as unknown as Record<string | symbol, unknown>)[prop];
    return typeof val === 'function' ? val.bind(_db) : val;
  },
  set(_, prop: string | symbol, val: unknown) {
    (_db as unknown as Record<string | symbol, unknown>)[prop] = val;
    return true;
  },
});

if (process.env.DEMO_MODE?.toLowerCase() === 'true') {
  if (isOracleNative || isOracleAsync) {
    console.warn('[Demo] DEMO_MODE seed is skipped for Oracle provider');
  } else {
    try {
      const { seedDemoData } = require('../demo/demo-seed');
      seedDemoData(_db);
    } catch (err: unknown) {
      console.error('[Demo] Seed error:', err instanceof Error ? err.message : err);
    }
  }
}

function closeDb(): void {
  if (_db) {
    if (!isOracleNativeConnection(_db)) {
      try {
        _db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
      } catch (e) {}
    }
    try {
      _db.close();
    } catch (e) {}
    _db = null;
    console.log('[DB] Database connection closed');
  }
}

function isOracleNativeConnection(connection: DbConnection): connection is OracleNativeAdapter {
  return connection instanceof OracleNativeAdapter;
}

function reinitialize(): void {
  console.log('[DB] Reinitializing database connection after restore...');
  if (_db) closeDb();
  initDb();
  console.log('[DB] Database reinitialized successfully');
}

interface PlaceWithCategory extends Place {
  category_name: string | null;
  category_color: string | null;
  category_icon: string | null;
}

interface PlaceWithTags extends Place {
  category: { id: number; name: string; color: string; icon: string } | null;
  tags: Tag[];
}

function getPlaceWithTags(placeId: number | string): PlaceWithTags | null {
  const place = db
    .prepare(
      `
    SELECT p.*, c.name as category_name, c.color as category_color, c.icon as category_icon
    FROM places p
    LEFT JOIN categories c ON p.category_id = c.id
    WHERE p.id = ?
  `,
    )
    .get(placeId) as PlaceWithCategory | undefined;

  if (!place) return null;

  const tags = db
    .prepare(
      `
    SELECT t.* FROM tags t
    JOIN place_tags pt ON t.id = pt.tag_id
    WHERE pt.place_id = ?
  `,
    )
    .all(placeId) as Tag[];

  return {
    ...place,
    category: place.category_id
      ? {
          id: place.category_id,
          name: place.category_name!,
          color: place.category_color!,
          icon: place.category_icon!,
        }
      : null,
    tags,
  };
}

interface TripAccess {
  id: number;
  user_id: number;
}

function canAccessTrip(tripId: number | string, userId: number): TripAccess | undefined {
  return db
    .prepare(
      `
    SELECT t.id, t.user_id FROM trips t
    LEFT JOIN trip_members m ON m.trip_id = t.id AND m.user_id = ?
    WHERE t.id = ? AND (t.user_id = ? OR m.user_id IS NOT NULL)
  `,
    )
    .get(userId, tripId, userId) as TripAccess | undefined;
}

function isOwner(tripId: number | string, userId: number): boolean {
  return !!db.prepare('SELECT id FROM trips WHERE id = ? AND user_id = ?').get(tripId, userId);
}

if (!isOracleAsync) {
  try {
    const { backfillFlightEndpoints } = require('../services/airportService');
    backfillFlightEndpoints();
  } catch (err) {
    console.error('[DB] Flight endpoint backfill failed:', err);
  }
}

export { db, closeDb, reinitialize, getPlaceWithTags, canAccessTrip, isOwner };
