import { asyncDb, closeAsyncDb } from '../../../src/db/asyncDatabase';
import { buildOracleBinds, translateSqlPlaceholders } from '../../../src/db/oracleNativeAdapter';

import { afterAll, describe, expect, it } from 'vitest';

describe('asyncDatabase', () => {
  afterAll(async () => {
    await closeAsyncDb();
  });

  it('wraps the local SQLite provider with promise-returning statements', async () => {
    const row = await asyncDb.prepare('SELECT ? AS value').get<{ value: number }>(42);
    expect(row).toEqual({ value: 42 });
  });

  it('supports promise-aware transactions for the SQLite wrapper', async () => {
    await asyncDb.exec('CREATE TEMP TABLE async_db_test (id INTEGER PRIMARY KEY, name TEXT)');
    const insertMany = asyncDb.transaction(async (names: string[]) => {
      for (const name of names) {
        await asyncDb.prepare('INSERT INTO async_db_test (name) VALUES (?)').run(name);
      }
      return asyncDb.prepare('SELECT COUNT(*) AS count FROM async_db_test').get<{ count: number }>();
    });

    await expect(insertMany(['alpha', 'beta'])).resolves.toEqual({ count: 2 });
  });
});

describe('Oracle async SQL compatibility helpers', () => {
  it('translates SQLite placeholders and LIMIT/OFFSET into Oracle binds', () => {
    const translated = translateSqlPlaceholders(
      'SELECT * FROM trips WHERE id = ? AND user_id = @userId LIMIT 5 OFFSET 10',
    );

    expect(translated.sql).toContain('id = :b1');
    expect(translated.sql).toContain('user_id = :userId');
    expect(translated.sql).toContain('OFFSET 10 ROWS FETCH NEXT 5 ROWS ONLY');
    expect(buildOracleBinds([{ b1: 123, userId: 7 }], translated)).toEqual({ b1: 123, userId: 7 });
  });

  it('marks INSERT OR IGNORE so Oracle execution can suppress unique-key conflicts', () => {
    const translated = translateSqlPlaceholders('INSERT OR IGNORE INTO tags (name) VALUES (?)');

    expect(translated.sql.trim()).toBe('INSERT INTO tags (name) VALUES (:b1)');
    expect(translated.sqliteConflictAction).toBe('ignore');
    expect(buildOracleBinds(['food'], translated)).toEqual({ b1: 'food' });
  });
});
