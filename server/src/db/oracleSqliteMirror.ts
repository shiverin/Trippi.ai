import { runMigrations } from './migrations';
import {
  ensureOracleMirrorTables,
  getOracleAutonomousConfigFromEnv,
  openOracleAutonomousConnection,
} from './oracleAutonomous';
import { resolveDbProvider } from './providerMode';
import { createTables } from './schema';
import { runSeeds } from './seeds';

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

interface MirrorPayloadRow {
  TABLE_NAME: string;
  ROW_KEY: string;
  PAYLOAD: string;
}

export interface OracleMirrorStats {
  tableCount: number;
  rowCount: number;
  lastSuccessAt?: Date;
}

export interface OracleMirrorResult {
  ok: true;
  runId: string;
  source: string;
  tableCount: number;
  rowCount: number;
}

export interface OracleRestoreResult {
  ok: true;
  target: string;
  restoredTables: number;
  restoredRows: number;
  skippedTables: string[];
  backupPaths: string[];
  foreignKeyIssueCount: number;
}

const DEFAULT_BATCH_SIZE = 250;

export function isOracleBackedMode(env: NodeJS.ProcessEnv = process.env): boolean {
  return resolveDbProvider(env) === 'oracle-backed';
}

export function resolveSqliteDbPath(env: NodeJS.ProcessEnv = process.env): string {
  if (env.TRIPPI_DB_FILE) return env.TRIPPI_DB_FILE;
  return path.resolve(__dirname, '../../data/travel.db');
}

function quoteSqliteIdentifier(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

function normalizeValue(value: unknown): unknown {
  if (Buffer.isBuffer(value)) return { __type: 'buffer', base64: value.toString('base64') };
  return value;
}

function denormalizeValue(value: unknown): unknown {
  if (
    value &&
    typeof value === 'object' &&
    (value as { __type?: string }).__type === 'buffer' &&
    typeof (value as { base64?: string }).base64 === 'string'
  ) {
    return Buffer.from((value as { base64: string }).base64, 'base64');
  }
  return value;
}

function buildRowKey(pkColumns: string[], row: Record<string, unknown>): string {
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

function listColumnNames(db: Database.Database, tableName: string): Set<string> {
  return new Set(
    (db.prepare(`PRAGMA table_info(${quoteSqliteIdentifier(tableName)})`).all() as SqliteColumnInfo[]).map(
      (column) => column.name,
    ),
  );
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

function backupExistingSqliteFiles(sqlitePath: string): string[] {
  const backupPaths: string[] = [];
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  for (const suffix of ['', '-wal', '-shm']) {
    const source = `${sqlitePath}${suffix}`;
    if (!fs.existsSync(source)) continue;
    const target = `${source}.pre-oracle-restore-${stamp}.bak`;
    fs.copyFileSync(source, target);
    backupPaths.push(target);
  }
  return backupPaths;
}

export async function getOracleMirrorStats(): Promise<OracleMirrorStats> {
  const config = getOracleAutonomousConfigFromEnv();
  if (!config) {
    throw new Error('Missing Oracle Autonomous DB environment.');
  }

  const oracle = await openOracleAutonomousConnection(config);
  try {
    await ensureOracleMirrorTables(oracle);
    const counts = await oracle.execute<{ TABLE_COUNT: number; ROW_COUNT: number }>(
      `
        SELECT
          COUNT(DISTINCT table_name) AS table_count,
          COUNT(*) AS row_count
        FROM trippi_sqlite_mirror
      `,
      [],
      { outFormat: oracledb.OUT_FORMAT_OBJECT },
    );
    const lastRun = await oracle.execute<{ LAST_SUCCESS_AT?: Date }>(
      `
        SELECT MAX(finished_at) AS last_success_at
        FROM trippi_sqlite_mirror_runs
        WHERE status = 'success'
      `,
      [],
      { outFormat: oracledb.OUT_FORMAT_OBJECT },
    );
    const row = counts.rows?.[0];
    return {
      tableCount: Number(row?.TABLE_COUNT ?? 0),
      rowCount: Number(row?.ROW_COUNT ?? 0),
      lastSuccessAt: lastRun.rows?.[0]?.LAST_SUCCESS_AT,
    };
  } finally {
    await oracle.close();
  }
}

export async function mirrorSqliteToOracle(
  sqlitePath = resolveSqliteDbPath(),
  env: NodeJS.ProcessEnv = process.env,
): Promise<OracleMirrorResult> {
  const config = getOracleAutonomousConfigFromEnv(env);
  if (!config) {
    throw new Error(
      [
        'Missing Oracle Autonomous DB environment.',
        'Set ORACLE_DB_USER, ORACLE_DB_PASSWORD, and ORACLE_DB_CONNECT_STRING.',
        'If you use a wallet, also set ORACLE_DB_WALLET_LOCATION or TNS_ADMIN.',
      ].join(' '),
    );
  }

  if (!fs.existsSync(sqlitePath)) {
    throw new Error(`SQLite database not found: ${sqlitePath}`);
  }

  const batchSize = Math.max(1, Number.parseInt(env.ORACLE_MIRROR_BATCH_SIZE ?? '', 10) || DEFAULT_BATCH_SIZE);
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
          row_key: buildRowKey(pkColumns, rawRow),
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

    return { ok: true, runId, source: sqlitePath, tableCount, rowCount };
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

export async function restoreSqliteFromOracle(
  sqlitePath = resolveSqliteDbPath(),
  env: NodeJS.ProcessEnv = process.env,
): Promise<OracleRestoreResult> {
  const config = getOracleAutonomousConfigFromEnv(env);
  if (!config) {
    throw new Error(
      [
        'Missing Oracle Autonomous DB environment.',
        'Set ORACLE_DB_USER, ORACLE_DB_PASSWORD, and ORACLE_DB_CONNECT_STRING.',
        'If you use a wallet, also set ORACLE_DB_WALLET_LOCATION or TNS_ADMIN.',
      ].join(' '),
    );
  }

  const oracle = await openOracleAutonomousConnection(config);
  const targetDir = path.dirname(sqlitePath);
  if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });

  try {
    await ensureOracleMirrorTables(oracle);
    const payloadRows = await oracle.execute<MirrorPayloadRow>(
      `
        SELECT table_name, row_key, payload
        FROM trippi_sqlite_mirror
        ORDER BY table_name, row_key
      `,
      [],
      {
        fetchInfo: { PAYLOAD: { type: oracledb.STRING } },
        outFormat: oracledb.OUT_FORMAT_OBJECT,
      },
    );
    const rows = payloadRows.rows ?? [];
    if (rows.length === 0) {
      return {
        ok: true,
        target: sqlitePath,
        restoredTables: 0,
        restoredRows: 0,
        skippedTables: [],
        backupPaths: [],
        foreignKeyIssueCount: 0,
      };
    }

    const backupPaths = backupExistingSqliteFiles(sqlitePath);
    const sqlite = new Database(sqlitePath);
    try {
      createTables(sqlite);
      runMigrations(sqlite);
      runSeeds(sqlite);

      const existingTables = new Set(listTables(sqlite).map((table) => table.name));
      const tableColumns = new Map<string, Set<string>>();
      for (const tableName of existingTables) {
        tableColumns.set(tableName, listColumnNames(sqlite, tableName));
      }

      sqlite.exec('PRAGMA foreign_keys = OFF');
      sqlite.exec('BEGIN');
      try {
        for (const tableName of existingTables) {
          sqlite.prepare(`DELETE FROM ${quoteSqliteIdentifier(tableName)}`).run();
        }

        const restoredTableNames = new Set<string>();
        const skippedTables = new Set<string>();
        let restoredRows = 0;

        for (const row of rows) {
          const tableName = row.TABLE_NAME;
          if (!existingTables.has(tableName)) {
            skippedTables.add(tableName);
            continue;
          }

          const payload = JSON.parse(row.PAYLOAD) as Record<string, unknown>;
          const columns = tableColumns.get(tableName) ?? new Set<string>();
          const insertColumns = Object.keys(payload).filter((column) => column !== '__rowid' && columns.has(column));
          if (insertColumns.length === 0) continue;

          const placeholders = insertColumns.map(() => '?').join(', ');
          const sql = `INSERT INTO ${quoteSqliteIdentifier(tableName)} (${insertColumns
            .map(quoteSqliteIdentifier)
            .join(', ')}) VALUES (${placeholders})`;
          sqlite.prepare(sql).run(...insertColumns.map((column) => denormalizeValue(payload[column]) ?? null));
          restoredTableNames.add(tableName);
          restoredRows++;
        }

        sqlite.exec('COMMIT');
        sqlite.exec('PRAGMA foreign_keys = ON');
        const foreignKeyIssues = sqlite.prepare('PRAGMA foreign_key_check').all() as unknown[];
        return {
          ok: true,
          target: sqlitePath,
          restoredTables: restoredTableNames.size,
          restoredRows,
          skippedTables: [...skippedTables].sort(),
          backupPaths,
          foreignKeyIssueCount: foreignKeyIssues.length,
        };
      } catch (err) {
        sqlite.exec('ROLLBACK');
        throw err;
      } finally {
        sqlite.exec('PRAGMA foreign_keys = ON');
      }
    } finally {
      sqlite.close();
    }
  } finally {
    await oracle.close();
  }
}
