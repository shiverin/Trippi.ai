import type { Place, Tag } from '../types';
import type { AsyncDb, AsyncRunResult, AsyncStatement, AsyncTransaction } from './asyncTypes';
import OracleAsyncAdapter from './oracleAsyncAdapter';
import { resolveDbProvider } from './providerMode';

import type Database from 'better-sqlite3';

type SyncDbModule = typeof import('./database');

let sqliteModule: SyncDbModule | null = null;
let sqliteModulePromise: Promise<SyncDbModule> | null = null;
let oracleAsync: OracleAsyncAdapter | null = null;

async function loadSqliteModule(): Promise<SyncDbModule> {
  if (sqliteModule) return sqliteModule;
  if (!sqliteModulePromise) {
    sqliteModulePromise = import('./database');
  }
  sqliteModule = await sqliteModulePromise;
  return sqliteModule;
}

class SqliteAsyncStatement implements AsyncStatement {
  private statement: Database.Statement | null = null;

  constructor(private readonly sql: string) {}

  private async prepared(): Promise<Database.Statement> {
    if (!this.statement) {
      const module = await loadSqliteModule();
      this.statement = module.db.prepare(this.sql);
    }
    return this.statement;
  }

  async get<T = unknown>(...args: unknown[]): Promise<T | undefined> {
    return (await this.prepared()).get(...args) as T | undefined;
  }

  async all<T = unknown>(...args: unknown[]): Promise<T[]> {
    return (await this.prepared()).all(...args) as T[];
  }

  async run(...args: unknown[]): Promise<AsyncRunResult> {
    return (await this.prepared()).run(...args);
  }
}

class SqliteAsyncAdapter implements AsyncDb {
  prepare(sql: string): AsyncStatement {
    return new SqliteAsyncStatement(sql);
  }

  async exec(sql: string): Promise<this> {
    (await loadSqliteModule()).db.exec(sql);
    return this;
  }

  transaction<Args extends unknown[], Result>(
    fn: (...args: Args) => Result | Promise<Result>,
  ): AsyncTransaction<Args, Result> {
    const run = async (...args: Args): Promise<Awaited<Result>> => {
      const db = (await loadSqliteModule()).db;
      db.exec('BEGIN');
      try {
        const result = await fn(...args);
        db.exec('COMMIT');
        return result as Awaited<Result>;
      } catch (err) {
        try {
          db.exec('ROLLBACK');
        } catch {
          /* preserve original error */
        }
        throw err;
      }
    };
    return Object.assign(run, {
      default: run,
      deferred: run,
      immediate: run,
      exclusive: run,
    });
  }

  async pragma(source: string): Promise<unknown[]> {
    return (await loadSqliteModule()).db.pragma(source) as unknown[];
  }

  async close(): Promise<void> {
    (await loadSqliteModule()).closeDb();
  }
}

function asyncConnection(): AsyncDb {
  if (resolveDbProvider() === 'oracle-async') {
    if (!oracleAsync) {
      oracleAsync = new OracleAsyncAdapter({ env: process.env });
      console.log('[DB] Async Oracle provider enabled');
    }
    return oracleAsync;
  }
  return sqliteAsync;
}

const sqliteAsync = new SqliteAsyncAdapter();

const asyncDb = new Proxy({} as AsyncDb, {
  get(_, prop: string | symbol) {
    const connection = asyncConnection();
    const val = (connection as unknown as Record<string | symbol, unknown>)[prop];
    return typeof val === 'function' ? val.bind(connection) : val;
  },
});

async function closeAsyncDb(): Promise<void> {
  if (oracleAsync) {
    await oracleAsync.close();
    oracleAsync = null;
  }
  if (sqliteModule) {
    sqliteModule.closeDb();
    sqliteModule = null;
    sqliteModulePromise = null;
  }
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

async function getPlaceWithTagsAsync(placeId: number | string): Promise<PlaceWithTags | null> {
  const place = await asyncDb
    .prepare(
      `
    SELECT p.*, c.name as category_name, c.color as category_color, c.icon as category_icon
    FROM places p
    LEFT JOIN categories c ON p.category_id = c.id
    WHERE p.id = ?
  `,
    )
    .get<PlaceWithCategory>(placeId);

  if (!place) return null;

  const tags = await asyncDb
    .prepare(
      `
    SELECT t.* FROM tags t
    JOIN place_tags pt ON t.id = pt.tag_id
    WHERE pt.place_id = ?
  `,
    )
    .all<Tag>(placeId);

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

async function canAccessTripAsync(tripId: number | string, userId: number): Promise<TripAccess | undefined> {
  return asyncDb
    .prepare(
      `
    SELECT t.id, t.user_id FROM trips t
    LEFT JOIN trip_members m ON m.trip_id = t.id AND m.user_id = ?
    WHERE t.id = ? AND (t.user_id = ? OR m.user_id IS NOT NULL)
  `,
    )
    .get<TripAccess>(userId, tripId, userId);
}

async function isOwnerAsync(tripId: number | string, userId: number): Promise<boolean> {
  return !!(await asyncDb.prepare('SELECT id FROM trips WHERE id = ? AND user_id = ?').get(tripId, userId));
}

export { asyncDb, closeAsyncDb, getPlaceWithTagsAsync, canAccessTripAsync, isOwnerAsync };
