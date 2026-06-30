import { asyncDb } from '../../db/asyncDatabase';
import { db } from '../../db/database';
import type { TrippiPhoto } from '../../types';
import { encrypt_api_key, decrypt_api_key } from '../apiKeyCrypto';
import {
  getMediaStorage,
  openStoredMedia,
  readStoredMediaBuffer,
  sendMediaBuffer,
  sendMediaObject,
  type StoredMediaMetadata,
} from '../mediaStorage';
import type { ServiceResult, AssetInfo } from './helpersService';
import { fail, success } from './helpersService';
import { streamImmichAsset, fetchImmichThumbnailBytes, getAssetInfo as getImmichAssetInfo } from './immichService';
import { streamSynologyAsset, fetchSynologyThumbnailBytes, getSynologyAssetInfo } from './synologyService';
import { createThumbnailFromBuffer, ensureLocalThumbnail } from './thumbnailService';
import * as photoCache from './trippiPhotoCache';

import { Response } from 'express';
import fs from 'fs';
import path from 'path';

// ── Lookup / Register ────────────────────────────────────────────────────

export function getOrCreateTrippiPhoto(
  provider: string,
  assetId: string,
  ownerId: number,
  passphrase?: string,
): number {
  const existing = db
    .prepare('SELECT id FROM trippi_photos WHERE provider = ? AND asset_id = ? AND owner_id = ?')
    .get(provider, assetId, ownerId) as { id: number } | undefined;
  if (existing) {
    if (passphrase) {
      db.prepare('UPDATE trippi_photos SET passphrase = ? WHERE id = ?').run(encrypt_api_key(passphrase), existing.id);
    }
    return existing.id;
  }

  const res = db
    .prepare('INSERT INTO trippi_photos (provider, asset_id, owner_id, passphrase) VALUES (?, ?, ?, ?)')
    .run(provider, assetId, ownerId, passphrase ? encrypt_api_key(passphrase) : null);
  return Number(res.lastInsertRowid);
}

export async function getOrCreateTrippiPhotoAsync(
  provider: string,
  assetId: string,
  ownerId: number,
  passphrase?: string,
): Promise<number> {
  const existing = await asyncDb
    .prepare('SELECT id FROM trippi_photos WHERE provider = ? AND asset_id = ? AND owner_id = ?')
    .get<{ id: number }>(provider, assetId, ownerId);
  if (existing) {
    if (passphrase) {
      await asyncDb
        .prepare('UPDATE trippi_photos SET passphrase = ? WHERE id = ?')
        .run(encrypt_api_key(passphrase), existing.id);
    }
    return existing.id;
  }

  const res = await asyncDb
    .prepare('INSERT INTO trippi_photos (provider, asset_id, owner_id, passphrase) VALUES (?, ?, ?, ?)')
    .run(provider, assetId, ownerId, passphrase ? encrypt_api_key(passphrase) : null);
  return Number(res.lastInsertRowid);
}

export function getOrCreateLocalTrippiPhoto(
  filePath: string,
  thumbnailPath?: string | null,
  width?: number | null,
  height?: number | null,
  storage?: Partial<StoredMediaMetadata>,
): number {
  const existing = db
    .prepare("SELECT id FROM trippi_photos WHERE provider = 'local' AND file_path = ?")
    .get(filePath) as { id: number } | undefined;
  if (existing) return existing.id;

  const res = db
    .prepare(
      `
      INSERT INTO trippi_photos (
        provider, file_path, thumbnail_path, width, height,
        storage_backend, storage_key, storage_etag, storage_size, storage_content_type
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    )
    .run(
      'local',
      filePath,
      thumbnailPath || null,
      width || null,
      height || null,
      storage?.storage_backend || null,
      storage?.storage_key || null,
      storage?.storage_etag || null,
      storage?.storage_size ?? null,
      storage?.storage_content_type || null,
    );
  return Number(res.lastInsertRowid);
}

export async function getOrCreateLocalTrippiPhotoAsync(
  filePath: string,
  thumbnailPath?: string | null,
  width?: number | null,
  height?: number | null,
  storage?: Partial<StoredMediaMetadata>,
): Promise<number> {
  const existing = await asyncDb
    .prepare("SELECT id, storage_key FROM trippi_photos WHERE provider = 'local' AND file_path = ?")
    .get<{ id: number; storage_key?: string | null }>(filePath);
  if (existing) {
    if (storage?.storage_key && !existing.storage_key) {
      await asyncDb
        .prepare(
          `
          UPDATE trippi_photos
          SET storage_backend = ?, storage_key = ?, storage_etag = ?, storage_size = ?, storage_content_type = ?
          WHERE id = ?
        `,
        )
        .run(
          storage.storage_backend || null,
          storage.storage_key,
          storage.storage_etag || null,
          storage.storage_size ?? null,
          storage.storage_content_type || null,
          existing.id,
        );
    }
    return existing.id;
  }

  const res = await asyncDb
    .prepare(
      `
      INSERT INTO trippi_photos (
        provider, file_path, thumbnail_path, width, height,
        storage_backend, storage_key, storage_etag, storage_size, storage_content_type
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    )
    .run(
      'local',
      filePath,
      thumbnailPath || null,
      width || null,
      height || null,
      storage?.storage_backend || null,
      storage?.storage_key || null,
      storage?.storage_etag || null,
      storage?.storage_size ?? null,
      storage?.storage_content_type || null,
    );
  return Number(res.lastInsertRowid);
}

export function resolveTrippiPhoto(photoId: number): TrippiPhoto | null {
  return (db.prepare('SELECT * FROM trippi_photos WHERE id = ?').get(photoId) as TrippiPhoto | undefined) || null;
}

export async function resolveTrippiPhotoAsync(photoId: number): Promise<TrippiPhoto | null> {
  return (await asyncDb.prepare('SELECT * FROM trippi_photos WHERE id = ?').get<TrippiPhoto>(photoId)) || null;
}

// ── Streaming ────────────────────────────────────────────────────────────

async function streamCachedThumbnail(
  res: Response,
  photo: TrippiPhoto,
  fetchBytes: () => Promise<{ bytes: Buffer; contentType: string } | { error: string; status: number }>,
  fallback: () => Promise<unknown>,
): Promise<void> {
  const key = photoCache.cacheKey(photo.provider!, photo.asset_id!, 'thumbnail', photo.owner_id!);

  if (await photoCache.serveFreshAsync(res, key)) return;

  const existing = photoCache.getInFlight(key);
  if (existing) {
    const bytes = await existing;
    if (bytes && (await photoCache.serveFreshAsync(res, key))) return;
    await fallback();
    return;
  }

  const promise = fetchBytes().then(async (result) => {
    if ('error' in result) return null;
    await photoCache.put(key, result.bytes, result.contentType);
    return result.bytes;
  });
  photoCache.setInFlight(key, promise);

  const bytes = await promise;
  if (bytes && (await photoCache.serveFreshAsync(res, key))) return;
  await fallback();
}

export async function streamPhoto(
  res: Response,
  userId: number,
  photoId: number,
  kind: 'thumbnail' | 'original',
): Promise<void> {
  const photo = await resolveTrippiPhotoAsync(photoId);
  if (!photo) {
    res.status(404).json({ error: 'Photo not found' });
    return;
  }

  if (photo.file_path) {
    const uploadsRoot = path.join(__dirname, '../../../uploads');

    if (kind === 'thumbnail') {
      let thumbRel = photo.thumbnail_path ?? null;
      if (thumbRel) {
        try {
          const thumbObject = await openStoredMedia(photo.storage_key ? thumbRel : null, thumbRel);
          if (thumbObject) {
            await sendMediaObject(res, thumbObject, {
              contentType: thumbObject.contentType || 'image/jpeg',
              cacheControl: 'public, max-age=86400, immutable',
            });
            return;
          }
        } catch {
          // Fall through and try to regenerate below.
        }
      }
      if (!thumbRel) {
        let result = await ensureLocalThumbnail(uploadsRoot, photo.file_path);
        if (!result && photo.storage_key) {
          const original = await readStoredMediaBuffer(photo.storage_key, photo.file_path);
          if (original) {
            const generated = await createThumbnailFromBuffer(original, photo.file_path);
            if (generated) {
              await getMediaStorage().putObject({
                key: generated.thumbnailRelPath,
                body: generated.buffer,
                contentType: 'image/jpeg',
              });
              result = generated;
            }
          }
        }
        if (result) {
          thumbRel = result.thumbnailRelPath;
          await asyncDb
            .prepare(
              'UPDATE trippi_photos SET thumbnail_path = ?, width = COALESCE(width, ?), height = COALESCE(height, ?) WHERE id = ?',
            )
            .run(thumbRel, result.width, result.height, photo.id);
          const thumbnailBuffer = 'buffer' in result && Buffer.isBuffer(result.buffer) ? result.buffer : null;
          if (thumbnailBuffer) {
            await sendMediaBuffer(res, thumbnailBuffer, {
              contentType: 'image/jpeg',
              cacheControl: 'public, max-age=86400, immutable',
            });
            return;
          }
        }
      }
      if (thumbRel) {
        try {
          const thumbObject = await openStoredMedia(photo.storage_key ? thumbRel : null, thumbRel);
          if (thumbObject) {
            await sendMediaObject(res, thumbObject, {
              contentType: thumbObject.contentType || 'image/jpeg',
              cacheControl: 'public, max-age=86400, immutable',
            });
            return;
          }
        } catch {
          // Fall through to original if thumbnail unavailable.
        }
        const thumbAbs = path.join(uploadsRoot, thumbRel);
        if (!photo.storage_key && fs.existsSync(thumbAbs)) {
          res.set('Cache-Control', 'public, max-age=86400, immutable');
          res.sendFile(thumbAbs);
          return;
        }
      }
      // Fall through to original if thumbnail unavailable.
    }

    try {
      const object = await openStoredMedia(photo.storage_key, photo.file_path);
      if (object) {
        await sendMediaObject(res, object, {
          contentType: object.contentType || photo.storage_content_type || undefined,
          cacheControl: 'public, max-age=86400',
        });
        return;
      }
    } catch {
      // Invalid legacy path or storage key falls through to 404/provider path.
    }
  }

  switch (photo.provider) {
    case 'local': {
      res.status(404).json({ error: 'File not found' });
      return;
    }
    case 'immich': {
      if (kind === 'thumbnail') {
        await streamCachedThumbnail(
          res,
          photo,
          () => fetchImmichThumbnailBytes(userId, photo.asset_id!, photo.owner_id!),
          () => streamImmichAsset(res, userId, photo.asset_id!, kind, photo.owner_id!),
        );
        return;
      }
      await streamImmichAsset(res, userId, photo.asset_id!, kind, photo.owner_id!);
      return;
    }
    case 'synologyphotos': {
      const passphrase = photo.passphrase ? decrypt_api_key(photo.passphrase) || undefined : undefined;
      if (kind === 'thumbnail') {
        await streamCachedThumbnail(
          res,
          photo,
          () => fetchSynologyThumbnailBytes(userId, photo.owner_id!, photo.asset_id!, passphrase),
          () => streamSynologyAsset(res, userId, photo.owner_id!, photo.asset_id!, kind, undefined, passphrase),
        );
        return;
      }
      await streamSynologyAsset(res, userId, photo.owner_id!, photo.asset_id!, kind, undefined, passphrase);
      return;
    }
    default:
      res.status(400).json({ error: `Unknown provider: ${photo.provider}` });
  }
}

// ── Asset Info ────────────────────────────────────────────────────────────

export async function getPhotoInfo(userId: number, photoId: number): Promise<ServiceResult<AssetInfo>> {
  const photo = await resolveTrippiPhotoAsync(photoId);
  if (!photo) return fail('Photo not found', 404);

  switch (photo.provider) {
    case 'local': {
      return success({
        id: String(photo.id),
        takenAt: photo.created_at,
        city: null,
        country: null,
        width: photo.width,
        height: photo.height,
        fileName: photo.file_path?.split('/').pop() || null,
      } as AssetInfo);
    }
    case 'immich': {
      const result = await getImmichAssetInfo(userId, photo.asset_id!, photo.owner_id!);
      if (result.error) return fail(result.error, result.status || 500);
      return success(result.data as AssetInfo);
    }
    case 'synologyphotos': {
      const passphrase = photo.passphrase ? decrypt_api_key(photo.passphrase) || undefined : undefined;
      return getSynologyAssetInfo(userId, photo.asset_id!, photo.owner_id!, passphrase);
    }
    default:
      return fail(`Unknown provider: ${photo.provider}`, 400);
  }
}

// ── Update provider on existing trippi_photo (for Immich upload sync) ─────

export function setTrippiPhotoProvider(
  trippiPhotoId: number,
  provider: string,
  assetId: string,
  ownerId: number,
): void {
  db.prepare('UPDATE trippi_photos SET provider = ?, asset_id = ?, owner_id = ? WHERE id = ?').run(
    provider,
    assetId,
    ownerId,
    trippiPhotoId,
  );
}

export async function setTrippiPhotoProviderAsync(
  trippiPhotoId: number,
  provider: string,
  assetId: string,
  ownerId: number,
): Promise<void> {
  await asyncDb
    .prepare('UPDATE trippi_photos SET provider = ?, asset_id = ?, owner_id = ? WHERE id = ?')
    .run(provider, assetId, ownerId, trippiPhotoId);
}

// ── Orphan cleanup ───────────────────────────────────────────────────────

export function deleteTrippiPhotoIfOrphan(photoId: number): void {
  const stillUsed = db
    .prepare(
      `
    SELECT 1 FROM trip_photos WHERE photo_id = ?
    UNION ALL
    SELECT 1 FROM journey_photos WHERE photo_id = ?
    LIMIT 1
  `,
    )
    .get(photoId, photoId);
  if (stillUsed) return;
  db.prepare("DELETE FROM trippi_photos WHERE id = ? AND provider != 'local'").run(photoId);
}

export async function deleteTrippiPhotoIfOrphanAsync(photoId: number): Promise<void> {
  const stillUsed = await asyncDb
    .prepare(
      `
    SELECT 1 FROM trip_photos WHERE photo_id = ?
    UNION ALL
    SELECT 1 FROM journey_photos WHERE photo_id = ?
    LIMIT 1
  `,
    )
    .get(photoId, photoId);
  if (stillUsed) return;
  await asyncDb.prepare("DELETE FROM trippi_photos WHERE id = ? AND provider != 'local'").run(photoId);
}

export { streamPhoto as streamPhotoAsync, getPhotoInfo as getPhotoInfoAsync };
