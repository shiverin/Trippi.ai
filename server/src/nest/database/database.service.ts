import { asyncDb } from '../../db/asyncDatabase';
import type { AsyncRunResult, AsyncStatement, AsyncTransaction } from '../../db/asyncTypes';
import { Injectable } from '@nestjs/common';

/**
 * Injectable async DB facade for migrated Nest runtime code.
 * Under SQLite it wraps the existing local DB; under `oracle-async` it goes
 * directly through the Oracle pool with no sync worker bridge.
 */
@Injectable()
export class DatabaseService {
  prepare(sql: string): AsyncStatement {
    return asyncDb.prepare(sql);
  }

  get<T = unknown>(sql: string, ...params: unknown[]): Promise<T | undefined> {
    return asyncDb.prepare(sql).get<T>(...params);
  }

  all<T = unknown>(sql: string, ...params: unknown[]): Promise<T[]> {
    return asyncDb.prepare(sql).all<T>(...params);
  }

  run(sql: string, ...params: unknown[]): Promise<AsyncRunResult> {
    return asyncDb.prepare(sql).run(...params);
  }

  transaction<Args extends unknown[], Result>(
    fn: (...args: Args) => Result | Promise<Result>,
  ): AsyncTransaction<Args, Result> {
    return asyncDb.transaction(fn);
  }
}
