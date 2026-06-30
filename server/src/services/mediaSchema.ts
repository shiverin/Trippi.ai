import { asyncDb } from '../db/asyncDatabase';
import { resolveDbProvider } from '../db/providerMode';

const MEDIA_COLUMNS = [
  ['storage_backend', 'VARCHAR2(32)'],
  ['storage_key', 'VARCHAR2(1024)'],
  ['storage_etag', 'VARCHAR2(255)'],
  ['storage_size', 'NUMBER'],
  ['storage_content_type', 'VARCHAR2(255)'],
] as const;

function isAlreadyExistsError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /ORA-01430|ORA-00955|duplicate column|already exists/i.test(message);
}

function isMissingTableError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /ORA-00942|no such table/i.test(message);
}

async function execIgnoringAlreadyExists(sql: string): Promise<void> {
  try {
    await asyncDb.exec(sql);
  } catch (err) {
    if (!isAlreadyExistsError(err) && !isMissingTableError(err)) throw err;
  }
}

export async function ensureMediaStorageSchema(): Promise<void> {
  if (resolveDbProvider() !== 'oracle-async') return;

  for (const table of ['trip_files', 'trippi_photos']) {
    for (const [column, type] of MEDIA_COLUMNS) {
      await execIgnoringAlreadyExists(`ALTER TABLE ${table} ADD ${column} ${type}`);
    }
  }

  await execIgnoringAlreadyExists('CREATE INDEX idx_trip_files_storage_key ON trip_files(storage_backend, storage_key)');
  await execIgnoringAlreadyExists(
    'CREATE INDEX idx_trippi_photos_storage_key ON trippi_photos(storage_backend, storage_key)',
  );
}
