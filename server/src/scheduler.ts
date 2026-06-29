import { logInfo, logError } from './services/auditLog';
import { asyncDb } from './db/asyncDatabase';
import { resolveDbProvider } from './db/providerMode';

import archiver from 'archiver';
import cron, { type ScheduledTask } from 'node-cron';
import fs from 'node:fs';
import path from 'node:path';

const dataDir = path.join(__dirname, '../data');
const backupsDir = path.join(dataDir, 'backups');
const uploadsDir = path.join(__dirname, '../uploads');
const settingsFile = path.join(dataDir, 'backup-settings.json');

const VALID_INTERVALS = ['hourly', 'daily', 'weekly', 'monthly'];
const VALID_DAYS_OF_WEEK = new Set([0, 1, 2, 3, 4, 5, 6]); // 0=Sunday
const VALID_HOURS = new Set(Array.from({ length: 24 }, (_, i) => i));

interface BackupSettings {
  enabled: boolean;
  interval: string;
  keep_days: number;
  hour: number;
  day_of_week: number;
  day_of_month: number;
}

export function buildCronExpression(settings: BackupSettings): string {
  const hour = VALID_HOURS.has(settings.hour) ? settings.hour : 2;
  const dow = VALID_DAYS_OF_WEEK.has(settings.day_of_week) ? settings.day_of_week : 0;
  const dom = settings.day_of_month >= 1 && settings.day_of_month <= 28 ? settings.day_of_month : 1;

  switch (settings.interval) {
    case 'hourly':
      return '0 * * * *';
    case 'daily':
      return `0 ${hour} * * *`;
    case 'weekly':
      return `0 ${hour} * * ${dow}`;
    case 'monthly':
      return `0 ${hour} ${dom} * *`;
    default:
      return `0 ${hour} * * *`;
  }
}

let currentTask: ScheduledTask | null = null;

function isOracleAsyncRuntime(): boolean {
  return resolveDbProvider() === 'oracle-async';
}

async function getAppSettingValue(key: string): Promise<string | undefined> {
  if (isOracleAsyncRuntime()) {
    return (await asyncDb.prepare('SELECT value FROM app_settings WHERE key = ?').get<{ value: string }>(key))?.value;
  }

  const { db } = require('./db/database');
  return (db.prepare('SELECT value FROM app_settings WHERE key = ?').get(key) as { value: string } | undefined)?.value;
}

function getDefaults(): BackupSettings {
  return { enabled: false, interval: 'daily', keep_days: 7, hour: 2, day_of_week: 0, day_of_month: 1 };
}

function loadSettings(): BackupSettings {
  let settings = getDefaults();
  try {
    if (fs.existsSync(settingsFile)) {
      const saved = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
      settings = { ...settings, ...saved };
    }
  } catch (e) {}
  return settings;
}

function saveSettings(settings: BackupSettings): void {
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 2));
}

async function runBackup(): Promise<void> {
  if (!fs.existsSync(backupsDir)) fs.mkdirSync(backupsDir, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const filename = `auto-backup-${timestamp}.zip`;
  const outputPath = path.join(backupsDir, filename);

  try {
    // Flush WAL to main DB file before archiving
    try {
      const { db } = require('./db/database');
      db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    } catch (e) {}

    await new Promise<void>((resolve, reject) => {
      const output = fs.createWriteStream(outputPath);
      const archive = archiver('zip', { zlib: { level: 9 } });
      output.on('close', resolve);
      archive.on('error', reject);
      archive.pipe(output);
      const dbPath = path.join(dataDir, 'travel.db');
      if (fs.existsSync(dbPath)) archive.file(dbPath, { name: 'travel.db' });
      if (fs.existsSync(uploadsDir)) archive.directory(uploadsDir, 'uploads');
      archive.finalize();
    });
    logInfo(`Auto-Backup created: ${filename}`);
  } catch (err: unknown) {
    logError(`Auto-Backup: ${err instanceof Error ? err.message : err}`);
    if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
    return;
  }

  const settings = loadSettings();
  if (settings.keep_days > 0) {
    cleanupOldBackups(settings.keep_days);
  }
}

function autoBackupTimestampMs(filename: string): number | null {
  // auto-backup-2026-04-27T00-00-00.zip → 2026-04-27T00:00:00
  const stamp = filename.slice('auto-backup-'.length, -'.zip'.length);
  const iso = stamp.replace(/T(\d{2})-(\d{2})-(\d{2})$/, 'T$1:$2:$3');
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : ms;
}

export function cleanupOldBackups(keepDays: number, now: number = Date.now()): void {
  try {
    const cutoff = now - keepDays * 24 * 60 * 60 * 1000;
    const files = fs.readdirSync(backupsDir).filter((f) => f.startsWith('auto-backup-') && f.endsWith('.zip'));
    for (const file of files) {
      const filePath = path.join(backupsDir, file);
      const ageMs = autoBackupTimestampMs(file) ?? fs.statSync(filePath).mtimeMs;
      if (ageMs < cutoff) {
        fs.unlinkSync(filePath);
        logInfo(`Auto-Backup old backup deleted: ${file}`);
      }
    }
  } catch (err: unknown) {
    logError(`Auto-Backup cleanup: ${err instanceof Error ? err.message : err}`);
  }
}

function start(): void {
  if (currentTask) {
    currentTask.stop();
    currentTask = null;
  }

  const settings = loadSettings();
  if (!settings.enabled) {
    logInfo('Auto-Backup disabled');
    return;
  }

  const expression = buildCronExpression(settings);
  const tz = process.env.TZ || 'UTC';
  currentTask = cron.schedule(expression, runBackup, { timezone: tz });
  logInfo(
    `Auto-Backup scheduled: ${settings.interval} (${expression}), tz: ${tz}, retention: ${settings.keep_days === 0 ? 'forever' : settings.keep_days + ' days'}`,
  );
}

// Demo mode: hourly reset of demo user data
let demoTask: ScheduledTask | null = null;

function startDemoReset(): void {
  if (demoTask) {
    demoTask.stop();
    demoTask = null;
  }
  if (process.env.DEMO_MODE?.toLowerCase() !== 'true') return;
  if (isOracleAsyncRuntime()) {
    logInfo('Demo hourly reset disabled for oracle-async runtime');
    return;
  }

  demoTask = cron.schedule('0 * * * *', () => {
    try {
      const { resetDemoUser } = require('./demo/demo-reset');
      resetDemoUser();
    } catch (err: unknown) {
      logError(`Demo reset: ${err instanceof Error ? err.message : err}`);
    }
  });
  logInfo('Demo hourly reset scheduled');
}

// Trip reminders: daily check at 9 AM local time for trips starting tomorrow
let reminderTask: ScheduledTask | null = null;

async function countTripsWithReminders(): Promise<number> {
  if (isOracleAsyncRuntime()) {
    const row = await asyncDb
      .prepare('SELECT COUNT(*) as c FROM trips WHERE reminder_days > 0 AND start_date IS NOT NULL')
      .get<{ c: number }>();
    return Number(row?.c ?? 0);
  }

  const { db } = require('./db/database');
  return (
    db.prepare('SELECT COUNT(*) as c FROM trips WHERE reminder_days > 0 AND start_date IS NOT NULL').get() as {
      c: number;
    }
  ).c;
}

async function listActiveReminderTrips(): Promise<
  { id: number; title: string; user_id: number; start_date: string; reminder_days: number }[]
> {
  const sql = `
    SELECT t.id, t.title, t.user_id, t.start_date, t.reminder_days FROM trips t
    WHERE t.reminder_days > 0
      AND t.start_date IS NOT NULL
      AND t.start_date <> ''
  `;
  if (isOracleAsyncRuntime()) {
    return asyncDb.prepare(sql).all();
  }

  const { db } = require('./db/database');
  return db.prepare(sql).all() as { id: number; title: string; user_id: number; start_date: string; reminder_days: number }[];
}

function startTripReminders(): void {
  void startTripRemindersAsync();
}

async function startTripRemindersAsync(): Promise<void> {
  if (reminderTask) {
    reminderTask.stop();
    reminderTask = null;
  }

  try {
    const reminderEnabled = (await getAppSettingValue('notify_trip_reminder')) !== 'false';
    const channelsRaw =
      (await getAppSettingValue('notification_channels')) || (await getAppSettingValue('notification_channel')) || 'none';
    const activeChannels = channelsRaw === 'none' ? [] : channelsRaw.split(',').map((c: string) => c.trim());
    if (!reminderEnabled) {
      logInfo('Trip reminders: disabled in settings');
      return;
    }

    const tripCount = await countTripsWithReminders();
    logInfo(
      `Trip reminders: enabled via [${activeChannels.join(',')}]${tripCount > 0 ? `, ${tripCount} trip(s) with active reminders` : ''}`,
    );
  } catch {
    return;
  }

  const tz = process.env.TZ || 'UTC';
  reminderTask = cron.schedule(
    '0 9 * * *',
    async () => {
      try {
        const { send } = require('./services/notificationService');

        const activeTrips = await listActiveReminderTrips();
        const trips = activeTrips.filter((trip) => trip.start_date === dateOnly(trip.reminder_days));

        for (const trip of trips) {
          await send({
            event: 'trip_reminder',
            actorId: null,
            scope: 'trip',
            targetId: trip.id,
            params: { trip: trip.title, tripId: String(trip.id) },
          }).catch(() => {});
        }

        if (trips.length > 0) {
          logInfo(
            `Trip reminders sent for ${trips.length} trip(s): ${trips.map((t) => `"${t.title}" (${t.reminder_days}d)`).join(', ')}`,
          );
        }
      } catch (err: unknown) {
        logError(`Trip reminder check failed: ${err instanceof Error ? err.message : err}`);
      }
    },
    { timezone: tz },
  );
}

// Todo due-date reminders: daily check at 9 AM for unchecked todos
// whose due_date falls within the next TODO_REMINDER_LEAD_DAYS days.
// Each todo gets reminded at most once per 24 h (tracked via
// todo_items.reminded_at) so the scheduler doesn't spam the user every
// morning leading up to the deadline.
const TODO_REMINDER_LEAD_DAYS = 3;
let todoReminderTask: ScheduledTask | null = null;

function dateOnly(offsetDays = 0): string {
  const date = new Date();
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}

function timestampValue(value: unknown): number | null {
  if (!value) return null;
  if (value instanceof Date) return value.getTime();
  const parsed = Date.parse(String(value));
  return Number.isNaN(parsed) ? null : parsed;
}

async function listDueTodos(today: string, dueCutoff: string): Promise<
  {
    id: number;
    trip_id: number;
    name: string;
    due_date: string;
    reminded_at: unknown;
    assigned_user_id: number | null;
    trip_title: string;
    trip_owner_id: number;
  }[]
> {
  const sql = `
    SELECT ti.id, ti.trip_id, ti.name, ti.due_date, ti.assigned_user_id, ti.reminded_at,
           t.title AS trip_title, t.user_id AS trip_owner_id
    FROM todo_items ti
    JOIN trips t ON t.id = ti.trip_id
    WHERE ti.checked = 0
      AND ti.due_date IS NOT NULL
      AND ti.due_date <> ''
      AND ti.due_date <= ?
      AND ti.due_date >= ?
  `;
  if (isOracleAsyncRuntime()) {
    return asyncDb.prepare(sql).all(dueCutoff, today);
  }

  const { db } = require('./db/database');
  return db.prepare(sql).all(dueCutoff, today) as {
    id: number;
    trip_id: number;
    name: string;
    due_date: string;
    reminded_at: unknown;
    assigned_user_id: number | null;
    trip_title: string;
    trip_owner_id: number;
  }[];
}

async function markTodoReminderSent(todoId: number): Promise<void> {
  if (isOracleAsyncRuntime()) {
    await asyncDb.prepare('UPDATE todo_items SET reminded_at = CURRENT_TIMESTAMP WHERE id = ?').run(todoId);
    return;
  }

  const { db } = require('./db/database');
  db.prepare('UPDATE todo_items SET reminded_at = CURRENT_TIMESTAMP WHERE id = ?').run(todoId);
}

function startTodoReminders(): void {
  void startTodoRemindersAsync();
}

async function startTodoRemindersAsync(): Promise<void> {
  if (todoReminderTask) {
    todoReminderTask.stop();
    todoReminderTask = null;
  }

  const enabled = (await getAppSettingValue('notify_todo_due')) !== 'false';
  if (!enabled) {
    logInfo('Todo due reminders: disabled in settings');
    return;
  }
  logInfo(`Todo due reminders: enabled (lead ${TODO_REMINDER_LEAD_DAYS}d)`);

  const tz = process.env.TZ || 'UTC';
  todoReminderTask = cron.schedule(
    '0 9 * * *',
    async () => {
      try {
        const { send } = require('./services/notificationService');

	        const today = dateOnly();
	        const dueCutoff = dateOnly(TODO_REMINDER_LEAD_DAYS);
	        const reminderCutoff = Date.now() - 20 * 60 * 60 * 1000;
        const todos = (await listDueTodos(today, dueCutoff)).filter((todo) => {
          const remindedAt = timestampValue(todo.reminded_at);
          return remindedAt === null || remindedAt <= reminderCutoff;
        });

        for (const todo of todos) {
          const targetScope: 'user' | 'trip' = todo.assigned_user_id ? 'user' : 'trip';
          const targetId = todo.assigned_user_id ?? todo.trip_id;
          await send({
            event: 'todo_due',
            actorId: null,
            scope: targetScope,
            targetId,
            params: {
              todo: todo.name,
              trip: todo.trip_title,
              tripId: String(todo.trip_id),
              due: todo.due_date,
            },
	          }).catch(() => {});
          await markTodoReminderSent(todo.id);
	        }

        if (todos.length > 0) {
          logInfo(`Todo reminders sent for ${todos.length} item(s)`);
        }
      } catch (err: unknown) {
        logError(`Todo reminder check failed: ${err instanceof Error ? err.message : err}`);
      }
    },
    { timezone: tz },
  );
}

// Version check: daily at 9 AM — notify admins if a new trippi.ai release is available
let versionCheckTask: ScheduledTask | null = null;

function startVersionCheck(): void {
  if (versionCheckTask) {
    versionCheckTask.stop();
    versionCheckTask = null;
  }

  const tz = process.env.TZ || 'UTC';
  versionCheckTask = cron.schedule(
    '0 9 * * *',
    async () => {
      try {
        const { checkAndNotifyVersion } = require('./services/adminService');
        await checkAndNotifyVersion();
      } catch (err: unknown) {
        logError(`Version check: ${err instanceof Error ? err.message : err}`);
      }
    },
    { timezone: tz },
  );
}

// Idempotency key cleanup: nightly at 3 AM — delete keys past their TTL.
// The TTL must exceed any realistic offline window: the trippi.ai client replays
// queued mutations with their X-Idempotency-Key when it reconnects, so a key
// GC'd before the device comes back online would let the replay create a
// duplicate. 24h was far too short for a multi-day offline trip; default 30d,
// overridable via IDEMPOTENCY_TTL_SECONDS.
const DEFAULT_IDEMPOTENCY_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 days
let idempotencyCleanupTask: ScheduledTask | null = null;

function idempotencyTtlSeconds(): number {
  const n = Number(process.env.IDEMPOTENCY_TTL_SECONDS);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_IDEMPOTENCY_TTL_SECONDS;
}

interface PurgeDb {
  prepare(sql: string): { run(...args: unknown[]): { changes: number } };
}

/** Delete idempotency keys older than the configured TTL. Returns rows removed.
 *  The db is injectable for testing; the cron job uses the default. */
function purgeExpiredIdempotencyKeys(
  now: number = Date.now(),
  ttlSeconds: number = idempotencyTtlSeconds(),
  database: PurgeDb = require('./db/database').db,
): number {
  const cutoff = Math.floor(now / 1000) - ttlSeconds;
  const result = database.prepare('DELETE FROM idempotency_keys WHERE created_at < ?').run(cutoff);
  return result.changes;
}

async function purgeExpiredIdempotencyKeysRuntime(
  now: number = Date.now(),
  ttlSeconds: number = idempotencyTtlSeconds(),
): Promise<number> {
  if (!isOracleAsyncRuntime()) return purgeExpiredIdempotencyKeys(now, ttlSeconds);

  const cutoff = Math.floor(now / 1000) - ttlSeconds;
  const result = await asyncDb.prepare('DELETE FROM idempotency_keys WHERE created_at < ?').run(cutoff);
  return result.changes;
}

function startIdempotencyCleanup(): void {
  if (idempotencyCleanupTask) {
    idempotencyCleanupTask.stop();
    idempotencyCleanupTask = null;
  }

  const tz = process.env.TZ || 'UTC';
  idempotencyCleanupTask = cron.schedule(
    '0 3 * * *',
    async () => {
      try {
        const removed = await purgeExpiredIdempotencyKeysRuntime();
        if (removed > 0) {
          logInfo(`Idempotency cleanup: removed ${removed} expired key(s)`);
        }
      } catch (err: unknown) {
        logError(`Idempotency cleanup: ${err instanceof Error ? err.message : err}`);
      }
    },
    { timezone: tz },
  );
}

// Trippi photo cache cleanup: every 2 hours — evict disk files and DB rows past their 1h TTL
let trippiPhotoCacheTask: ScheduledTask | null = null;

function startTrippiPhotoCacheCleanup(): void {
  if (trippiPhotoCacheTask) {
    trippiPhotoCacheTask.stop();
    trippiPhotoCacheTask = null;
  }
  if (isOracleAsyncRuntime()) {
    logInfo('Trippi photo cache cleanup disabled for oracle-async runtime');
    return;
  }

  // Run once immediately on startup to evict any entries left over from a previous run
  try {
    const { sweepExpired } = require('./services/memories/trippiPhotoCache');
    sweepExpired();
  } catch {
    /* cache dir may not exist yet — harmless */
  }

  trippiPhotoCacheTask = cron.schedule('0 */2 * * *', () => {
    try {
      const { sweepExpired } = require('./services/memories/trippiPhotoCache');
      sweepExpired();
    } catch (err: unknown) {
      logError(`Trippi photo cache cleanup: ${err instanceof Error ? err.message : err}`);
    }
  });
}

// Place-photo (Google/Wikimedia) cache cleanup: nightly — reclaim cached files and
// meta rows no place references anymore (deleted places/trips, overwritten image_url).
let placePhotoCacheTask: ScheduledTask | null = null;

function startPlacePhotoCacheCleanup(): void {
  if (placePhotoCacheTask) {
    placePhotoCacheTask.stop();
    placePhotoCacheTask = null;
  }
  if (isOracleAsyncRuntime()) {
    logInfo('Place-photo cache cleanup disabled for oracle-async runtime');
    return;
  }

  const sweep = () => {
    try {
      const { sweepOrphans } = require('./services/placePhotoCache');
      const removed = sweepOrphans();
      if (removed > 0) logInfo(`Place-photo cache cleanup: removed ${removed} orphaned file(s)/row(s)`);
    } catch (err: unknown) {
      logError(`Place-photo cache cleanup: ${err instanceof Error ? err.message : err}`);
    }
  };

  // Run once on startup to reclaim orphans left over from before this sweeper existed.
  sweep();

  const tz = process.env.TZ || 'UTC';
  placePhotoCacheTask = cron.schedule('30 3 * * *', sweep, { timezone: tz });
}

// AirTrail sync: poll connected instances on an interval and reconcile linked
// flights both ways (#214). The per-tick enable gate (addon + setting) lives in
// runAirtrailSync, so toggling the addon takes effect without a restart.
let airtrailSyncTask: ScheduledTask | null = null;

function startAirTrailSync(): void {
  if (airtrailSyncTask) {
    airtrailSyncTask.stop();
    airtrailSyncTask = null;
  }
  if (isOracleAsyncRuntime()) {
    logInfo('AirTrail sync disabled for oracle-async runtime');
    return;
  }

  const { db } = require('./db/database');
  const getSetting = (key: string) =>
    (db.prepare('SELECT value FROM app_settings WHERE key = ?').get(key) as { value: string } | undefined)?.value;
  const raw = parseInt(getSetting('airtrail_poll_interval_minutes') || '5', 10);
  const minutes = Number.isFinite(raw) && raw >= 1 && raw <= 59 ? raw : 5;
  const tz = process.env.TZ || 'UTC';
  logInfo(`AirTrail sync: scheduled every ${minutes}m`);

  airtrailSyncTask = cron.schedule(
    `*/${minutes} * * * *`,
    async () => {
      try {
        const { runAirtrailSync } = require('./services/airtrail/airtrailSync');
        await runAirtrailSync();
      } catch (err: unknown) {
        logError(`AirTrail sync tick failed: ${err instanceof Error ? err.message : err}`);
      }
    },
    { timezone: tz },
  );
}

function stop(): void {
  if (currentTask) {
    currentTask.stop();
    currentTask = null;
  }
  if (demoTask) {
    demoTask.stop();
    demoTask = null;
  }
  if (reminderTask) {
    reminderTask.stop();
    reminderTask = null;
  }
  if (versionCheckTask) {
    versionCheckTask.stop();
    versionCheckTask = null;
  }
  if (idempotencyCleanupTask) {
    idempotencyCleanupTask.stop();
    idempotencyCleanupTask = null;
  }
  if (trippiPhotoCacheTask) {
    trippiPhotoCacheTask.stop();
    trippiPhotoCacheTask = null;
  }
  if (placePhotoCacheTask) {
    placePhotoCacheTask.stop();
    placePhotoCacheTask = null;
  }
  if (airtrailSyncTask) {
    airtrailSyncTask.stop();
    airtrailSyncTask = null;
  }
}

export {
  start,
  stop,
  startDemoReset,
  startTripReminders,
  startTodoReminders,
  startVersionCheck,
  startIdempotencyCleanup,
  purgeExpiredIdempotencyKeys,
  startTrippiPhotoCacheCleanup,
  startPlacePhotoCacheCleanup,
  startAirTrailSync,
  loadSettings,
  saveSettings,
  VALID_INTERVALS,
};
