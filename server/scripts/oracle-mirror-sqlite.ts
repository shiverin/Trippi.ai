import {
  ensureOracleMirrorTables,
  getOracleAutonomousConfigFromEnv,
  openOracleAutonomousConnection,
} from '../src/db/oracleAutonomous';

import Database from 'better-sqlite3';
import crypto from 'crypto';
import fs from 'fs';
import oracledb from 'oracledb';
import path from 'path';

interface SqliteTable {
  name: string;
}

interface SqliteColumnInfo {
  name: string;
  pk: number;
}

interface MirrorBind {
  table_name: string;
  row_key: string;
  payload: string;
}

const DEFAULT_BATCH_SIZE = 250;

function getSqlitePath(): string {
  if (process.env.TRIPPI_DB_FILE) return process.env.TRIPPI_DB_FILE;
  return path.resolve(__dirname, '../data/travel.db');
}

function quoteSqliteIdentifier(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

function normalizeValue(value: unknown): unknown {
  if (Buffer.isBuffer(value)) return { __type: 'buffer', base64: value.toString('base64') };
  return value;
}

function buildRowKey(table: string, pkColumns: string[], row: Record<string, unknown>): string {
  if (pkColumns.length > 0) {
    return pkColumns.map((column) => String(row[column] ?? '')).join(':');
  }
  return String(row.__rowid ?? crypto.createHash('sha256').update(JSON.stringify(row)).digest('hex'));
}

function listTables(db: Database.Database): SqliteTable[] {
  return db
    .prepare(
      `
        SELECT name
        FROM sqlite_master
        WHERE type = 'table'
          AND name NOT LIKE 'sqlite_%'
        ORDER BY name
      `,
    )
    .all() as SqliteTable[];
}

function listPrimaryKeyColumns(db: Database.Database, tableName: string): string[] {
  return (db.prepare(`PRAGMA table_info(${quoteSqliteIdentifier(tableName)})`).all() as SqliteColumnInfo[])
    .filter((column) => column.pk > 0)
    .sort((a, b) => a.pk - b.pk)
    .map((column) => column.name);
}

async function mirrorBatch(connection: oracledb.Connection, binds: MirrorBind[]): Promise<void> {
  if (binds.length === 0) return;

  await connection.executeMany(
    `
      MERGE INTO trippi_sqlite_mirror dst
      USING (
        SELECT :table_name AS table_name, :row_key AS row_key, :payload AS payload
        FROM dual
      ) src
      ON (dst.table_name = src.table_name AND dst.row_key = src.row_key)
      WHEN MATCHED THEN UPDATE SET
        dst.payload = src.payload,
        dst.mirrored_at = SYSTIMESTAMP
      WHEN NOT MATCHED THEN INSERT (table_name, row_key, payload, mirrored_at)
        VALUES (src.table_name, src.row_key, src.payload, SYSTIMESTAMP)
    `,
    binds,
    {
      bindDefs: {
        table_name: { type: oracledb.STRING, maxSize: 128 },
        row_key: { type: oracledb.STRING, maxSize: 512 },
        payload: { type: oracledb.DB_TYPE_CLOB },
      },
    },
  );
}

async function main(): Promise<void> {
  const config = getOracleAutonomousConfigFromEnv();
  if (!config) {
    throw new Error(
      [
        'Missing Oracle Autonomous DB environment.',
        'Set ORACLE_DB_USER, ORACLE_DB_PASSWORD, and ORACLE_DB_CONNECT_STRING.',
        'If you use a wallet, also set ORACLE_DB_WALLET_LOCATION or TNS_ADMIN.',
      ].join(' '),
    );
  }

  const sqlitePath = getSqlitePath();
  if (!fs.existsSync(sqlitePath)) {
    throw new Error(`SQLite database not found: ${sqlitePath}`);
  }

  const batchSize = Math.max(1, Number.parseInt(process.env.ORACLE_MIRROR_BATCH_SIZE ?? '', 10) || DEFAULT_BATCH_SIZE);
  const runId = crypto.randomUUID();
  const sqlite = new Database(sqlitePath, { readonly: true, fileMustExist: true });
  const oracle = await openOracleAutonomousConnection(config);

  let tableCount = 0;
  let rowCount = 0;
  try {
    await ensureOracleMirrorTables(oracle);
    await oracle.execute(
      `
        INSERT INTO trippi_sqlite_mirror_runs (run_id, source_db_path, status)
        VALUES (:run_id, :source_db_path, 'running')
      `,
      { run_id: runId, source_db_path: sqlitePath },
      { autoCommit: true },
    );

    const tables = listTables(sqlite);
    for (const table of tables) {
      tableCount++;
      const pkColumns = listPrimaryKeyColumns(sqlite, table.name);
      const rows = sqlite
        .prepare(`SELECT rowid AS __rowid, * FROM ${quoteSqliteIdentifier(table.name)}`)
        .all() as Record<string, unknown>[];

      await oracle.execute(`DELETE FROM trippi_sqlite_mirror WHERE table_name = :table_name`, {
        table_name: table.name,
      });

      let batch: MirrorBind[] = [];
      for (const rawRow of rows) {
        const normalized = Object.fromEntries(
          Object.entries(rawRow).map(([key, value]) => [key, normalizeValue(value)]),
        );
        batch.push({
          table_name: table.name,
          row_key: buildRowKey(table.name, pkColumns, rawRow),
          payload: JSON.stringify(normalized),
        });
        rowCount++;

        if (batch.length >= batchSize) {
          await mirrorBatch(oracle, batch);
          batch = [];
        }
      }
      await mirrorBatch(oracle, batch);
      await oracle.commit();
    }

    await oracle.execute(
      `
        UPDATE trippi_sqlite_mirror_runs
        SET finished_at = SYSTIMESTAMP,
            table_count = :table_count,
            row_count = :row_count,
            status = 'success'
        WHERE run_id = :run_id
      `,
      { table_count: tableCount, row_count: rowCount, run_id: runId },
      { autoCommit: true },
    );

    console.log(JSON.stringify({ ok: true, runId, source: sqlitePath, tableCount, rowCount }, null, 2));
  } catch (err) {
    await oracle
      .execute(
        `
          UPDATE trippi_sqlite_mirror_runs
          SET finished_at = SYSTIMESTAMP,
              table_count = :table_count,
              row_count = :row_count,
              status = 'failed',
              error_message = :error_message
          WHERE run_id = :run_id
        `,
        {
          table_count: tableCount,
          row_count: rowCount,
          error_message: err instanceof Error ? err.message : String(err),
          run_id: runId,
        },
        { autoCommit: true },
      )
      .catch(() => {});
    throw err;
  } finally {
    sqlite.close();
    await oracle.close();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
