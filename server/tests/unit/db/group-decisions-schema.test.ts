import { runMigrations } from '../../../src/db/migrations';
import { createTables } from '../../../src/db/schema';

import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';

function columnNames(db: Database.Database, table: string): string[] {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((row) => row.name);
}

describe('group decisions schema', () => {
  it('creates decisions, options, responses, and link tables for fresh databases', () => {
    const db = new Database(':memory:');
    try {
      db.exec('PRAGMA foreign_keys = ON');
      createTables(db);
      runMigrations(db);

      const tables = new Set(
        (
          db
            .prepare(
              `SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'group_decision%' ORDER BY name`,
            )
            .all() as Array<{ name: string }>
        ).map((row) => row.name),
      );
      expect(tables).toEqual(
        new Set(['group_decision_links', 'group_decision_options', 'group_decision_responses', 'group_decisions']),
      );

      expect(columnNames(db, 'group_decisions')).toEqual(
        expect.arrayContaining(['trip_id', 'created_by', 'deadline', 'state', 'final_option_id']),
      );
      expect(columnNames(db, 'group_decision_responses')).toEqual(
        expect.arrayContaining(['decision_id', 'option_id', 'user_id', 'response', 'comment']),
      );
    } finally {
      db.close();
    }
  });

  it('applies the latest additive migration when the group decision tables are missing', () => {
    const db = new Database(':memory:');
    try {
      db.exec('PRAGMA foreign_keys = ON');
      createTables(db);
      runMigrations(db);

      const latest = (db.prepare('SELECT version FROM schema_version').get() as { version: number }).version;
      db.exec('PRAGMA foreign_keys = OFF');
      db.exec(`
        DROP TABLE group_decision_links;
        DROP TABLE group_decision_responses;
        DROP TABLE group_decision_options;
        DROP TABLE group_decisions;
      `);
      db.exec('PRAGMA foreign_keys = ON');
      db.prepare('UPDATE schema_version SET version = ?').run(latest - 1);

      runMigrations(db);

      const row = db
        .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'group_decision_links'`)
        .get();
      expect(row).toBeDefined();
      expect((db.prepare('SELECT version FROM schema_version').get() as { version: number }).version).toBe(latest);
    } finally {
      db.close();
    }
  });

  it('persists options, member responses, deadline, state, final option, and allowed link targets', () => {
    const db = new Database(':memory:');
    try {
      db.exec('PRAGMA foreign_keys = ON');
      createTables(db);
      runMigrations(db);

      const ownerId = Number(
        db
          .prepare('INSERT INTO users (username, email, password_hash, role) VALUES (?, ?, ?, ?)')
          .run('owner', 'owner@example.test', 'hash', 'user').lastInsertRowid,
      );
      const memberId = Number(
        db
          .prepare('INSERT INTO users (username, email, password_hash, role) VALUES (?, ?, ?, ?)')
          .run('member', 'member@example.test', 'hash', 'user').lastInsertRowid,
      );
      const tripId = Number(
        db.prepare('INSERT INTO trips (user_id, title) VALUES (?, ?)').run(ownerId, 'Trip').lastInsertRowid,
      );
      const decisionId = Number(
        db
          .prepare(
            `
            INSERT INTO group_decisions (trip_id, created_by, title, deadline, state)
            VALUES (?, ?, ?, ?, ?)
          `,
          )
          .run(tripId, ownerId, 'Choose hotel', '2026-07-15T12:00:00Z', 'open').lastInsertRowid,
      );
      const optionId = Number(
        db
          .prepare('INSERT INTO group_decision_options (decision_id, label, sort_order) VALUES (?, ?, ?)')
          .run(decisionId, 'Old town', 0).lastInsertRowid,
      );

      db.prepare(
        'INSERT INTO group_decision_responses (decision_id, option_id, user_id, response, comment) VALUES (?, ?, ?, ?, ?)',
      ).run(decisionId, optionId, memberId, 'selected', 'Looks best');
      db.prepare('INSERT INTO group_decision_links (decision_id, target_type, target_id) VALUES (?, ?, ?)').run(
        decisionId,
        'booking_intent',
        42,
      );
      db.prepare("UPDATE group_decisions SET final_option_id = ?, state = 'decided' WHERE id = ?").run(
        optionId,
        decisionId,
      );

      const decision = db.prepare('SELECT * FROM group_decisions WHERE id = ?').get(decisionId) as {
        deadline: string;
        state: string;
        final_option_id: number;
      };
      const response = db
        .prepare('SELECT response, comment FROM group_decision_responses WHERE decision_id = ?')
        .get(decisionId) as { response: string; comment: string };
      const link = db
        .prepare('SELECT target_type, target_id FROM group_decision_links WHERE decision_id = ?')
        .get(decisionId) as { target_type: string; target_id: number };

      expect(decision).toMatchObject({
        deadline: '2026-07-15T12:00:00Z',
        state: 'decided',
        final_option_id: optionId,
      });
      expect(response).toEqual({ response: 'selected', comment: 'Looks best' });
      expect(link).toEqual({ target_type: 'booking_intent', target_id: 42 });
    } finally {
      db.close();
    }
  });
});
