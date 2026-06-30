import { asyncDb, closeAsyncDb } from '../src/db/asyncDatabase';
import { getMediaConfig, getMediaStorage, mediaKey, tripFileLegacyKey, uploadUrlToMediaKey } from '../src/services/mediaStorage';

import fs from 'node:fs';
import path from 'node:path';

type RefKind = 'avatar' | 'trip_cover' | 'journey_cover' | 'trip_file' | 'trippi_photo';

interface MediaRef {
  kind: RefKind;
  id: number;
  key: string;
  localPath: string;
  table?: 'trip_files' | 'trippi_photos';
  storageKeyColumn?: string;
  label?: string | null;
}

interface ManifestEntry extends MediaRef {
  existsLocal: boolean;
  applied: boolean;
  error?: string;
}

const args = new Set(process.argv.slice(2));
const apply = args.has('--apply');
const uploadsRoot = path.join(__dirname, '../uploads');
const dataDir = path.join(__dirname, '../data');

function contentTypeFor(key: string): string {
  const ext = path.extname(key).toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.gif') return 'image/gif';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.heic') return 'image/heic';
  if (ext === '.pdf') return 'application/pdf';
  if (ext === '.pkpass') return 'application/vnd.apple.pkpass';
  return 'application/octet-stream';
}

function localPathForKey(key: string): string {
  return path.join(uploadsRoot, key);
}

function addUnique(refs: MediaRef[], seen: Set<string>, ref: MediaRef | null): void {
  if (!ref) return;
  const dedupeKey = `${ref.kind}:${ref.id}:${ref.key}`;
  if (seen.has(dedupeKey)) return;
  seen.add(dedupeKey);
  refs.push(ref);
}

async function scanRefs(): Promise<MediaRef[]> {
  const refs: MediaRef[] = [];
  const seen = new Set<string>();

  for (const row of await asyncDb
    .prepare("SELECT id, avatar FROM users WHERE avatar IS NOT NULL AND avatar != ''")
    .all<{
    id: number;
    avatar: string;
  }>()) {
    const key = mediaKey('avatars', row.avatar);
    addUnique(refs, seen, { kind: 'avatar', id: row.id, key, localPath: localPathForKey(key), label: row.avatar });
  }

  for (const row of await asyncDb
    .prepare("SELECT id, cover_image FROM trips WHERE cover_image IS NOT NULL AND cover_image != ''")
    .all<{ id: number; cover_image: string }>()) {
    const key = uploadUrlToMediaKey(row.cover_image);
    if (key?.startsWith('covers/')) {
      addUnique(refs, seen, { kind: 'trip_cover', id: row.id, key, localPath: localPathForKey(key), label: row.cover_image });
    }
  }

  for (const row of await asyncDb
    .prepare("SELECT id, cover_image FROM journeys WHERE cover_image IS NOT NULL AND cover_image != ''")
    .all<{ id: number; cover_image: string }>()) {
    const key = uploadUrlToMediaKey(row.cover_image) || (row.cover_image.startsWith('journey/') ? row.cover_image : null);
    if (key?.startsWith('journey/')) {
      addUnique(refs, seen, {
        kind: 'journey_cover',
        id: row.id,
        key,
        localPath: localPathForKey(key),
        label: row.cover_image,
      });
    }
  }

  for (const row of await asyncDb
    .prepare(
      `
      SELECT id, filename, original_name, storage_key
      FROM trip_files
      WHERE filename IS NOT NULL AND filename != ''
    `,
    )
    .all<{ id: number; filename: string; original_name?: string | null; storage_key?: string | null }>()) {
    const key = row.storage_key || tripFileLegacyKey(row.filename);
    addUnique(refs, seen, {
      kind: 'trip_file',
      id: row.id,
      key,
      localPath: localPathForKey(tripFileLegacyKey(row.filename)),
      table: 'trip_files',
      storageKeyColumn: 'storage_key',
      label: row.original_name || row.filename,
    });
  }

  for (const row of await asyncDb
    .prepare(
      `
      SELECT id, file_path, storage_key
      FROM trippi_photos
      WHERE provider = 'local' AND file_path IS NOT NULL AND file_path != ''
    `,
    )
    .all<{ id: number; file_path: string; storage_key?: string | null }>()) {
    const key = row.storage_key || row.file_path;
    addUnique(refs, seen, {
      kind: 'trippi_photo',
      id: row.id,
      key,
      localPath: localPathForKey(row.file_path),
      table: 'trippi_photos',
      storageKeyColumn: 'storage_key',
      label: row.file_path,
    });
  }

  return refs;
}

async function applyRef(ref: MediaRef): Promise<void> {
  const storage = getMediaStorage();
  const metadata = await storage.putObject({
    key: ref.key,
    body: fs.createReadStream(ref.localPath),
    contentType: contentTypeFor(ref.key),
  });
  if (ref.table) {
    await asyncDb.prepare(
      `
      UPDATE ${ref.table}
      SET storage_backend = ?, storage_key = ?, storage_etag = ?, storage_size = ?, storage_content_type = ?
      WHERE id = ?
    `,
    ).run(
      metadata.storage_backend,
      metadata.storage_key,
      metadata.storage_etag || null,
      metadata.storage_size ?? null,
      metadata.storage_content_type || null,
      ref.id,
    );
  }
}

async function main(): Promise<void> {
  const refs = await scanRefs();
  let config: ReturnType<typeof getMediaConfig> | null = null;
  try {
    config = getMediaConfig();
  } catch (err) {
    if (apply) throw err;
  }
  if (apply && config?.backend !== 'gcs') {
    throw new Error('Refusing --apply unless TRIPPI_MEDIA_BACKEND=gcs');
  }

  const entries: ManifestEntry[] = [];
  for (const ref of refs) {
    const existsLocal = fs.existsSync(ref.localPath);
    const entry: ManifestEntry = { ...ref, existsLocal, applied: false };
    if (apply && existsLocal) {
      try {
        await applyRef(ref);
        entry.applied = true;
      } catch (err) {
        entry.error = err instanceof Error ? err.message : String(err);
      }
    }
    entries.push(entry);
  }

  await fs.promises.mkdir(dataDir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const manifestPath = path.join(dataDir, `media-backfill-${timestamp}${apply ? '-apply' : '-dry-run'}.json`);
  const manifest = {
    generated_at: new Date().toISOString(),
    mode: apply ? 'apply' : 'dry-run',
    media_backend: config?.backend ?? process.env.TRIPPI_MEDIA_BACKEND ?? 'local',
    gcs_bucket: config?.backend === 'gcs' ? config.gcsBucket : undefined,
    gcs_prefix: config?.backend === 'gcs' ? config.gcsPrefix : undefined,
    counts: {
      scanned: entries.length,
      local_present: entries.filter((entry) => entry.existsLocal).length,
      missing_local: entries.filter((entry) => !entry.existsLocal).length,
      applied: entries.filter((entry) => entry.applied).length,
      errors: entries.filter((entry) => entry.error).length,
    },
    entries,
  };
  await fs.promises.writeFile(manifestPath, JSON.stringify(manifest, null, 2));
  console.log(JSON.stringify({ manifestPath, counts: manifest.counts }, null, 2));
  if (apply && manifest.counts.errors > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
}).finally(async () => {
  await closeAsyncDb();
});
