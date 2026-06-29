/**
 * DatabaseService — async facade over the configured DB provider. Exercises every
 * helper against the real local test connection so the typed query surface is covered.
 */
import { DatabaseService } from '../../../src/nest/database/database.service';

import { describe, it, expect } from 'vitest';

describe('DatabaseService (typed query helpers)', () => {
  const svc = new DatabaseService();

  it('prepare + get + all return rows from the live connection', async () => {
    await expect(svc.prepare('SELECT 1 AS one').get()).resolves.toEqual({ one: 1 });
    await expect(svc.get('SELECT 2 AS two')).resolves.toEqual({ two: 2 });
    await expect(svc.all('SELECT 3 AS three')).resolves.toEqual([{ three: 3 }]);
  });

  it('run + transaction operate on a scratch table', async () => {
    await svc.run('CREATE TEMP TABLE IF NOT EXISTS _dbsvc_test (n INTEGER)');
    await svc.run('DELETE FROM _dbsvc_test');

    const info = await svc.run('INSERT INTO _dbsvc_test (n) VALUES (?)', 41);
    expect(info.changes).toBe(1);

    const total = await svc.transaction(async () => {
      await svc.run('INSERT INTO _dbsvc_test (n) VALUES (?)', 1);
      return svc.get<{ s: number }>('SELECT SUM(n) AS s FROM _dbsvc_test');
    })();
    expect(total.s).toBe(42);

    await svc.run('DROP TABLE _dbsvc_test');
  });
});
