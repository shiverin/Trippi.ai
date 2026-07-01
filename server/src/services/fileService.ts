import { asyncDb } from '../db/asyncDatabase';
import { db } from '../db/database';
import { verifyJwtAndLoadUser } from '../middleware/auth';
import { TripFile } from '../types';
import { DEFAULT_ALLOWED_EXTENSIONS, getAllowedExtensionsAsync } from './allowedFileTypes';
import { consumeEphemeralToken } from './ephemeralTokens';
import { deleteStoredMedia, tripFileLegacyKey, type StoredMediaMetadata } from './mediaStorage';
import { BLOCKED_EXTENSIONS } from './uploadPolicy';

import type { Request } from 'express';
import path from 'path';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MB
export { DEFAULT_ALLOWED_EXTENSIONS, getAllowedExtensionsAsync };
export { BLOCKED_EXTENSIONS };
export const filesDir = path.join(__dirname, '../../uploads/files');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export { verifyTripAccess } from './tripAccess';

export function getAllowedExtensions(): string {
  try {
    const row = db.prepare("SELECT value FROM app_settings WHERE key = 'allowed_file_types'").get() as
      | { value: string }
      | undefined;
    return row?.value || DEFAULT_ALLOWED_EXTENSIONS;
  } catch {
    return DEFAULT_ALLOWED_EXTENSIONS;
  }
}

const FILE_SELECT = `
  SELECT f.*, r.title as reservation_title, u.username as uploaded_by_name, u.avatar as uploaded_by_avatar
  FROM trip_files f
  LEFT JOIN reservations r ON f.reservation_id = r.id
  LEFT JOIN users u ON f.uploaded_by = u.id
`;

export function formatFile(file: TripFile & { trip_id?: number; uploaded_by_avatar?: string | null }) {
  const tripId = file.trip_id;
  return {
    ...file,
    url: `/api/trips/${tripId}/files/${file.id}/download`,
    uploaded_by_avatar: file.uploaded_by_avatar ? `/uploads/avatars/${file.uploaded_by_avatar}` : null,
  };
}

// ---------------------------------------------------------------------------
// File path resolution & validation
// ---------------------------------------------------------------------------

export function resolveFilePath(filename: string): { resolved: string; safe: boolean } {
  const safeName = path.basename(filename);
  const filePath = path.join(filesDir, safeName);
  const resolved = path.resolve(filePath);
  const safe = resolved.startsWith(path.resolve(filesDir));
  return { resolved, safe };
}

// ---------------------------------------------------------------------------
// Token-based download auth
// ---------------------------------------------------------------------------

export async function authenticateDownload(
  req: Request,
): Promise<{ userId: number } | { error: string; status: number }> {
  const cookieToken = (req as any).cookies?.trippi_session as string | undefined;
  const authHeader = req.headers['authorization'];
  const bearerToken = authHeader ? authHeader.split(' ')[1] || undefined : undefined;
  const queryToken = req.query.token as string | undefined;

  // Cookie and Bearer both carry a full JWT — try them first (cookie wins).
  const jwtToken = cookieToken || bearerToken;
  if (jwtToken) {
    // Use the shared helper so the password_version gate applies here too;
    // previously this bypassed the check and stolen download tokens stayed
    // valid across a password reset.
    const user = await verifyJwtAndLoadUser(jwtToken);
    if (!user) return { error: 'Invalid or expired token', status: 401 };
    return { userId: user.id };
  }

  if (queryToken) {
    const uid = consumeEphemeralToken(queryToken, 'download');
    if (!uid) return { error: 'Invalid or expired token', status: 401 };
    return { userId: uid };
  }

  return { error: 'Authentication required', status: 401 };
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

export interface FileLink {
  file_id: number;
  reservation_id: number | null;
  place_id: number | null;
}

type FileUploadInput = {
  filename: string;
  originalname: string;
  size: number;
  mimetype: string;
} & Partial<StoredMediaMetadata>;

export function getFileById(id: string | number, tripId: string | number): TripFile | undefined {
  return db.prepare('SELECT * FROM trip_files WHERE id = ? AND trip_id = ?').get(id, tripId) as TripFile | undefined;
}

export async function getFileByIdAsync(id: string | number, tripId: string | number): Promise<TripFile | undefined> {
  return asyncDb.prepare('SELECT * FROM trip_files WHERE id = ? AND trip_id = ?').get<TripFile>(id, tripId);
}

export function getDeletedFile(id: string | number, tripId: string | number): TripFile | undefined {
  return db
    .prepare('SELECT * FROM trip_files WHERE id = ? AND trip_id = ? AND deleted_at IS NOT NULL')
    .get(id, tripId) as TripFile | undefined;
}

export async function getDeletedFileAsync(id: string | number, tripId: string | number): Promise<TripFile | undefined> {
  return asyncDb
    .prepare('SELECT * FROM trip_files WHERE id = ? AND trip_id = ? AND deleted_at IS NOT NULL')
    .get<TripFile>(id, tripId);
}

export function listFiles(tripId: string | number, showTrash: boolean) {
  const where = showTrash ? 'f.trip_id = ? AND f.deleted_at IS NOT NULL' : 'f.trip_id = ? AND f.deleted_at IS NULL';
  const files = db
    .prepare(`${FILE_SELECT} WHERE ${where} ORDER BY f.starred DESC, f.created_at DESC`)
    .all(tripId) as TripFile[];

  const fileIds = files.map((f) => f.id);
  let linksMap: Record<number, FileLink[]> = {};
  if (fileIds.length > 0) {
    const placeholders = fileIds.map(() => '?').join(',');
    const links = db
      .prepare(`SELECT file_id, reservation_id, place_id FROM file_links WHERE file_id IN (${placeholders})`)
      .all(...fileIds) as FileLink[];
    for (const link of links) {
      if (!linksMap[link.file_id]) linksMap[link.file_id] = [];
      linksMap[link.file_id].push(link);
    }
  }

  return files.map((f) => {
    const fileLinks = linksMap[f.id] || [];
    return {
      ...formatFile(f),
      linked_reservation_ids: fileLinks.filter((l) => l.reservation_id).map((l) => l.reservation_id),
      linked_place_ids: fileLinks.filter((l) => l.place_id).map((l) => l.place_id),
    };
  });
}

export async function listFilesAsync(tripId: string | number, showTrash: boolean) {
  const where = showTrash ? 'f.trip_id = ? AND f.deleted_at IS NOT NULL' : 'f.trip_id = ? AND f.deleted_at IS NULL';
  const files = await asyncDb
    .prepare(`${FILE_SELECT} WHERE ${where} ORDER BY f.starred DESC, f.created_at DESC`)
    .all<TripFile>(tripId);

  const fileIds = files.map((f) => f.id);
  const linksMap: Record<number, FileLink[]> = {};
  if (fileIds.length > 0) {
    const placeholders = fileIds.map(() => '?').join(',');
    const links = await asyncDb
      .prepare(`SELECT file_id, reservation_id, place_id FROM file_links WHERE file_id IN (${placeholders})`)
      .all<FileLink>(...fileIds);
    for (const link of links) {
      if (!linksMap[link.file_id]) linksMap[link.file_id] = [];
      linksMap[link.file_id].push(link);
    }
  }

  return files.map((f) => {
    const fileLinks = linksMap[f.id] || [];
    return {
      ...formatFile(f),
      linked_reservation_ids: fileLinks.filter((l) => l.reservation_id).map((l) => l.reservation_id),
      linked_place_ids: fileLinks.filter((l) => l.place_id).map((l) => l.place_id),
    };
  });
}

export function createFile(
  tripId: string | number,
  file: FileUploadInput,
  uploadedBy: number,
  opts: { place_id?: string | null; reservation_id?: string | null; description?: string | null },
) {
  const result = db
    .prepare(
      `
    INSERT INTO trip_files (
      trip_id, place_id, reservation_id, filename, original_name, file_size, mime_type, description, uploaded_by,
      storage_backend, storage_key, storage_etag, storage_size, storage_content_type
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `,
    )
    .run(
      tripId,
      opts.place_id || null,
      opts.reservation_id || null,
      file.filename,
      file.originalname,
      file.size,
      file.mimetype,
      opts.description || null,
      uploadedBy,
      file.storage_backend || null,
      file.storage_key || null,
      file.storage_etag || null,
      file.storage_size ?? file.size ?? null,
      file.storage_content_type || file.mimetype || null,
    );

  const created = db.prepare(`${FILE_SELECT} WHERE f.id = ?`).get(result.lastInsertRowid) as TripFile;
  return formatFile(created);
}

export async function createFileAsync(
  tripId: string | number,
  file: FileUploadInput,
  uploadedBy: number,
  opts: { place_id?: string | null; reservation_id?: string | null; description?: string | null },
) {
  const result = await asyncDb
    .prepare(
      `
    INSERT INTO trip_files (
      trip_id, place_id, reservation_id, filename, original_name, file_size, mime_type, description, uploaded_by,
      storage_backend, storage_key, storage_etag, storage_size, storage_content_type
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `,
    )
    .run(
      tripId,
      opts.place_id || null,
      opts.reservation_id || null,
      file.filename,
      file.originalname,
      file.size,
      file.mimetype,
      opts.description || null,
      uploadedBy,
      file.storage_backend || null,
      file.storage_key || null,
      file.storage_etag || null,
      file.storage_size ?? file.size ?? null,
      file.storage_content_type || file.mimetype || null,
    );

  const created = (await asyncDb.prepare(`${FILE_SELECT} WHERE f.id = ?`).get<TripFile>(result.lastInsertRowid))!;
  return formatFile(created);
}

export function updateFile(
  id: string | number,
  current: TripFile,
  updates: { description?: string; place_id?: string | null; reservation_id?: string | null },
) {
  db.prepare(
    `
    UPDATE trip_files SET
      description = ?,
      place_id = ?,
      reservation_id = ?
    WHERE id = ?
  `,
  ).run(
    updates.description !== undefined ? updates.description : current.description,
    updates.place_id !== undefined ? updates.place_id || null : current.place_id,
    updates.reservation_id !== undefined ? updates.reservation_id || null : current.reservation_id,
    id,
  );

  const updated = db.prepare(`${FILE_SELECT} WHERE f.id = ?`).get(id) as TripFile;
  return formatFile(updated);
}

export async function updateFileAsync(
  id: string | number,
  current: TripFile,
  updates: { description?: string; place_id?: string | null; reservation_id?: string | null },
) {
  await asyncDb
    .prepare(
      `
    UPDATE trip_files SET
      description = ?,
      place_id = ?,
      reservation_id = ?
    WHERE id = ?
  `,
    )
    .run(
      updates.description !== undefined ? updates.description : current.description,
      updates.place_id !== undefined ? updates.place_id || null : current.place_id,
      updates.reservation_id !== undefined ? updates.reservation_id || null : current.reservation_id,
      id,
    );

  const updated = (await asyncDb.prepare(`${FILE_SELECT} WHERE f.id = ?`).get<TripFile>(id))!;
  return formatFile(updated);
}

export function toggleStarred(id: string | number, currentStarred: number | undefined) {
  const newStarred = currentStarred ? 0 : 1;
  db.prepare('UPDATE trip_files SET starred = ? WHERE id = ?').run(newStarred, id);

  const updated = db.prepare(`${FILE_SELECT} WHERE f.id = ?`).get(id) as TripFile;
  return formatFile(updated);
}

export async function toggleStarredAsync(id: string | number, currentStarred: number | undefined) {
  const newStarred = currentStarred ? 0 : 1;
  await asyncDb.prepare('UPDATE trip_files SET starred = ? WHERE id = ?').run(newStarred, id);

  const updated = (await asyncDb.prepare(`${FILE_SELECT} WHERE f.id = ?`).get<TripFile>(id))!;
  return formatFile(updated);
}

export function softDeleteFile(id: string | number) {
  db.prepare('UPDATE trip_files SET deleted_at = CURRENT_TIMESTAMP WHERE id = ?').run(id);
}

export async function softDeleteFileAsync(id: string | number): Promise<void> {
  await asyncDb.prepare('UPDATE trip_files SET deleted_at = CURRENT_TIMESTAMP WHERE id = ?').run(id);
}

export function restoreFile(id: string | number) {
  db.prepare('UPDATE trip_files SET deleted_at = NULL WHERE id = ?').run(id);
  const restored = db.prepare(`${FILE_SELECT} WHERE f.id = ?`).get(id) as TripFile;
  return formatFile(restored);
}

export async function restoreFileAsync(id: string | number) {
  await asyncDb.prepare('UPDATE trip_files SET deleted_at = NULL WHERE id = ?').run(id);
  const restored = (await asyncDb.prepare(`${FILE_SELECT} WHERE f.id = ?`).get<TripFile>(id))!;
  return formatFile(restored);
}

export async function permanentDeleteFile(file: TripFile): Promise<void> {
  // `force: true` swallows ENOENT, replacing the prior existsSync+unlink
  // double-call that blocked the event loop twice per deletion. Only
  // drop the DB row when the on-disk unlink either succeeded or the
  // file was already gone — otherwise a permission / ENOSPC failure
  // would orphan the bytes on disk with no DB pointer left to clean it.
  try {
    await deleteStoredMedia(file.storage_key, tripFileLegacyKey(file.filename));
  } catch (e) {
    console.error(`[files] unlink failed for ${file.filename}, keeping DB row:`, e);
    throw e;
  }
  await asyncDb.prepare('DELETE FROM trip_files WHERE id = ?').run(file.id);
}

export async function emptyTrash(tripId: string | number): Promise<number> {
  const trashed = await asyncDb
    .prepare('SELECT * FROM trip_files WHERE trip_id = ? AND deleted_at IS NOT NULL')
    .all<TripFile>(tripId);
  // Collect successful IDs separately so we only DELETE rows whose disk
  // content was actually removed — failing unlinks keep their DB row
  // and a retry via the single-file delete path can try again.
  const successfullyUnlinked: number[] = [];
  await Promise.all(
    trashed.map(async (file) => {
      try {
        await deleteStoredMedia(file.storage_key, tripFileLegacyKey(file.filename));
        successfullyUnlinked.push(Number(file.id));
      } catch (e) {
        console.error(`[files] unlink failed for ${file.filename}, keeping DB row:`, e);
      }
    }),
  );
  if (successfullyUnlinked.length > 0) {
    const placeholders = successfullyUnlinked.map(() => '?').join(',');
    await asyncDb.prepare(`DELETE FROM trip_files WHERE id IN (${placeholders})`).run(...successfullyUnlinked);
  }
  return successfullyUnlinked.length;
}

// ---------------------------------------------------------------------------
// File links (many-to-many)
// ---------------------------------------------------------------------------

export function createFileLink(
  fileId: string | number,
  opts: { reservation_id?: string | null; assignment_id?: string | null; place_id?: string | null },
) {
  try {
    db.prepare(
      'INSERT OR IGNORE INTO file_links (file_id, reservation_id, assignment_id, place_id) VALUES (?, ?, ?, ?)',
    ).run(fileId, opts.reservation_id || null, opts.assignment_id || null, opts.place_id || null);
  } catch (err) {
    console.error('[Files] Error creating file link:', err instanceof Error ? err.message : err);
  }
  return db.prepare('SELECT * FROM file_links WHERE file_id = ?').all(fileId);
}

export async function createFileLinkAsync(
  fileId: string | number,
  opts: { reservation_id?: string | null; assignment_id?: string | null; place_id?: string | null },
) {
  try {
    await asyncDb
      .prepare(
        'INSERT OR IGNORE INTO file_links (file_id, reservation_id, assignment_id, place_id) VALUES (?, ?, ?, ?)',
      )
      .run(fileId, opts.reservation_id || null, opts.assignment_id || null, opts.place_id || null);
  } catch (err) {
    console.error('[Files] Error creating file link:', err instanceof Error ? err.message : err);
  }
  return asyncDb.prepare('SELECT * FROM file_links WHERE file_id = ?').all(fileId);
}

export function deleteFileLink(linkId: string | number, fileId: string | number) {
  db.prepare('DELETE FROM file_links WHERE id = ? AND file_id = ?').run(linkId, fileId);
}

export async function deleteFileLinkAsync(linkId: string | number, fileId: string | number): Promise<void> {
  await asyncDb.prepare('DELETE FROM file_links WHERE id = ? AND file_id = ?').run(linkId, fileId);
}

export function getFileLinks(fileId: string | number) {
  return db
    .prepare(
      `
    SELECT fl.*, r.title as reservation_title
    FROM file_links fl
    LEFT JOIN reservations r ON fl.reservation_id = r.id
    WHERE fl.file_id = ?
  `,
    )
    .all(fileId);
}

export async function getFileLinksAsync(fileId: string | number) {
  return asyncDb
    .prepare(
      `
    SELECT fl.*, r.title as reservation_title
    FROM file_links fl
    LEFT JOIN reservations r ON fl.reservation_id = r.id
    WHERE fl.file_id = ?
  `,
    )
    .all(fileId);
}
