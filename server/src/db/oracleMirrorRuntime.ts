import {
  getOracleMirrorStats,
  isOracleBackedMode,
  mirrorSqliteToOracle,
  resolveSqliteDbPath,
  restoreSqliteFromOracle,
} from './oracleSqliteMirror';

import fs from 'fs';

let timer: NodeJS.Timeout | null = null;
let syncInFlight: Promise<void> | null = null;

function intervalMs(): number {
  const configured = Number.parseInt(process.env.ORACLE_MIRROR_INTERVAL_MS ?? '', 10);
  if (Number.isFinite(configured) && configured > 0) return configured;
  return 30_000;
}

async function syncOnce(reason: string): Promise<void> {
  if (!isOracleBackedMode()) return;
  if (syncInFlight) return syncInFlight;

  syncInFlight = (async () => {
    const sqlitePath = resolveSqliteDbPath();
    try {
      const result = await mirrorSqliteToOracle(sqlitePath);
      console.log(
        `[Oracle DB] ${reason} sync complete: ${result.tableCount} tables, ${result.rowCount} rows mirrored to Oracle.`,
      );
    } catch (err) {
      console.error(`[Oracle DB] ${reason} sync failed:`, err instanceof Error ? err.message : err);
    } finally {
      syncInFlight = null;
    }
  })();

  return syncInFlight;
}

export async function prepareOracleBackedMode(): Promise<void> {
  if (!isOracleBackedMode()) return;

  const sqlitePath = resolveSqliteDbPath();
  console.log('[Oracle DB] TRIPPI_DB_PROVIDER=oracle enabled.');
  console.log('[Oracle DB] Using Oracle-backed SQLite compatibility mode while the native Oracle port is in progress.');

  const stats = await getOracleMirrorStats();
  if (stats.rowCount > 0) {
    const restored = await restoreSqliteFromOracle(sqlitePath);
    console.log(
      `[Oracle DB] Restored ${restored.restoredRows} rows from Oracle into ${sqlitePath}. ` +
        `Backups: ${restored.backupPaths.length}. FK issues: ${restored.foreignKeyIssueCount}.`,
    );
    if (restored.skippedTables.length > 0) {
      console.warn(`[Oracle DB] Skipped tables not present locally: ${restored.skippedTables.join(', ')}`);
    }
    return;
  }

  if (!fs.existsSync(sqlitePath)) {
    console.warn(
      '[Oracle DB] Oracle mirror is empty and no local SQLite DB exists yet; starting with a fresh local DB.',
    );
    return;
  }

  console.warn('[Oracle DB] Oracle mirror is empty; seeding it from the existing local SQLite database.');
  await mirrorSqliteToOracle(sqlitePath);
}

export function startOracleBackedSync(): void {
  if (!isOracleBackedMode() || timer) return;

  const ms = intervalMs();
  console.log(`[Oracle DB] Background Oracle sync enabled every ${ms} ms.`);
  timer = setInterval(() => {
    void syncOnce('scheduled');
  }, ms);
  timer.unref?.();

  void syncOnce('startup');
}

export async function stopOracleBackedSync(): Promise<void> {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  await syncOnce('shutdown');
}
