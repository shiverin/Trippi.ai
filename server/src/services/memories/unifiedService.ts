import { asyncDb, canAccessTripAsync } from '../../db/asyncDatabase';
import { resolveDbProvider } from '../../db/providerMode';
import { broadcast } from '../../websocket';
import { encrypt_api_key } from '../apiKeyCrypto';
import { send } from '../notificationService';
import { ServiceResult, fail, success, mapDbError, Selection } from './helpersService';
import { getOrCreateTrippiPhotoAsync, deleteTrippiPhotoIfOrphanAsync } from './photoResolverService';

async function _providers(): Promise<Array<{ id: string; enabled: boolean }>> {
  const rows = await asyncDb.prepare('SELECT id, enabled FROM photo_providers').all<{ id: string; enabled: number }>();
  return rows.map((r) => ({ id: r.id, enabled: r.enabled === 1 }));
}

async function _validProvider(provider: string): Promise<ServiceResult<string>> {
  const providers = await _providers();
  const found = providers.find((p) => p.id === provider);
  if (!found) {
    return fail(`Provider: "${provider}" is not supported`, 400);
  }
  if (!found.enabled) {
    return fail(`Provider: "${provider}" is not enabled, contact server administrator`, 400);
  }
  return success(provider);
}

export async function listTripPhotos(tripId: string, userId: number): Promise<ServiceResult<any[]>> {
  const access = await canAccessTripAsync(tripId, userId);
  if (!access) {
    return fail('Trip not found or access denied', 404);
  }

  try {
    const enabledProviders = (await _providers())
      .filter((p) => p.enabled)
      .map((p) => p.id);

    if (enabledProviders.length === 0) {
      return fail('No photo providers enabled', 400);
    }

    const photos = await asyncDb
      .prepare(
        `
      SELECT tp.photo_id, tkp.asset_id, tkp.provider, tp.user_id, tp.shared, tp.added_at,
             u.username, u.avatar
      FROM trip_photos tp
      JOIN trippi_photos tkp ON tkp.id = tp.photo_id
      JOIN users u ON tp.user_id = u.id
      WHERE tp.trip_id = ?
        AND (tp.user_id = ? OR tp.shared = 1)
        AND tkp.provider IN (${enabledProviders.map(() => '?').join(',')})
      ORDER BY tp.added_at ASC
    `,
      )
      .all(tripId, userId, ...enabledProviders);

    return success(photos);
  } catch (error) {
    return mapDbError(error as Error, 'Failed to list trip photos');
  }
}

export async function listTripAlbumLinks(tripId: string, userId: number): Promise<ServiceResult<any[]>> {
  const access = await canAccessTripAsync(tripId, userId);
  if (!access) {
    return fail('Trip not found or access denied', 404);
  }

  const enabledProviders = (await _providers())
    .filter((p) => p.enabled)
    .map((p) => p.id);

  if (enabledProviders.length === 0) {
    return fail('No photo providers enabled', 400);
  }

  try {
    const links = await asyncDb
      .prepare(
        `
      SELECT tal.id,
             tal.trip_id,
             tal.user_id,
             tal.provider,
             tal.album_id,
             tal.album_name,
             tal.sync_enabled,
             tal.last_synced_at,
             tal.created_at,
             u.username
      FROM trip_album_links tal
      JOIN users u ON tal.user_id = u.id
      WHERE tal.trip_id = ?
        AND tal.provider IN (${enabledProviders.map(() => '?').join(',')})
      ORDER BY tal.created_at ASC
    `,
      )
      .all(tripId, ...enabledProviders);

    return success(links);
  } catch (error) {
    return mapDbError(error as Error, 'Failed to list trip album links');
  }
}

//-----------------------------------------------
// managing photos in trip

async function _addTripPhoto(
  tripId: string,
  userId: number,
  provider: string,
  assetId: string,
  shared: boolean,
  albumLinkId?: string,
  passphrase?: string,
): Promise<ServiceResult<boolean>> {
  const providerResult = await _validProvider(provider);
  if (!providerResult.success) {
    return providerResult as ServiceResult<boolean>;
  }
  try {
    const photoId = await getOrCreateTrippiPhotoAsync(provider, assetId, userId, passphrase);
    const result = await asyncDb
      .prepare(
        'INSERT OR IGNORE INTO trip_photos (trip_id, user_id, photo_id, shared, album_link_id) VALUES (?, ?, ?, ?, ?)',
      )
      .run(tripId, userId, photoId, shared ? 1 : 0, albumLinkId || null);
    return success(result.changes > 0);
  } catch (error) {
    return mapDbError(error as Error, 'Failed to add photo to trip');
  }
}

export async function addTripPhotos(
  tripId: string,
  userId: number,
  shared: boolean,
  selections: Selection[],
  sid: string,
  albumLinkId?: string,
): Promise<ServiceResult<{ added: number; shared: boolean }>> {
  const access = await canAccessTripAsync(tripId, userId);
  if (!access) {
    return fail('Trip not found or access denied', 404);
  }

  if (selections.length === 0) {
    return fail('No photos selected', 400);
  }

  let added = 0;
  for (const selection of selections) {
    const providerResult = await _validProvider(selection.provider);
    if (!providerResult.success) {
      return providerResult as ServiceResult<{ added: number; shared: boolean }>;
    }
    for (const raw of selection.asset_ids) {
      const assetId = String(raw || '').trim();
      if (!assetId) continue;
      const result = await _addTripPhoto(
        tripId,
        userId,
        selection.provider,
        assetId,
        shared,
        albumLinkId,
        selection.passphrase,
      );
      if (!result.success) {
        return result as ServiceResult<{ added: number; shared: boolean }>;
      }
      if (result.data) {
        added++;
      }
    }
  }

  await _notifySharedTripPhotos(tripId, userId, added);
  broadcast(tripId, 'memories:updated', { userId }, sid);
  return success({ added, shared });
}

export async function setTripPhotoSharing(
  tripId: string,
  userId: number,
  photoId: number,
  shared: boolean,
  sid?: string,
): Promise<ServiceResult<true>> {
  const access = await canAccessTripAsync(tripId, userId);
  if (!access) {
    return fail('Trip not found or access denied', 404);
  }

  try {
    await asyncDb.prepare(
      `
      UPDATE trip_photos
      SET shared = ?
      WHERE trip_id = ?
        AND user_id = ?
        AND photo_id = ?
    `,
    ).run(shared ? 1 : 0, tripId, userId, photoId);

    await _notifySharedTripPhotos(tripId, userId, 1);
    broadcast(tripId, 'memories:updated', { userId }, sid);
    return success(true);
  } catch (error) {
    return mapDbError(error as Error, 'Failed to update photo sharing');
  }
}

export async function removeTripPhoto(
  tripId: string,
  userId: number,
  photoId: number,
  sid?: string,
): Promise<ServiceResult<true>> {
  const access = await canAccessTripAsync(tripId, userId);
  if (!access) {
    return fail('Trip not found or access denied', 404);
  }

  try {
    await asyncDb.prepare(
      `
      DELETE FROM trip_photos
      WHERE trip_id = ?
        AND user_id = ?
        AND photo_id = ?
    `,
    ).run(tripId, userId, photoId);

    await deleteTrippiPhotoIfOrphanAsync(photoId);
    broadcast(tripId, 'memories:updated', { userId }, sid);

    return success(true);
  } catch (error) {
    return mapDbError(error as Error, 'Failed to remove trip photo');
  }
}

// ----------------------------------------------
// managing album links in trip

export async function createTripAlbumLink(
  tripId: string,
  userId: number,
  providerRaw: unknown,
  albumIdRaw: unknown,
  albumNameRaw: unknown,
  passphrase?: string,
): Promise<ServiceResult<true>> {
  const access = await canAccessTripAsync(tripId, userId);
  if (!access) {
    return fail('Trip not found or access denied', 404);
  }

  const provider = String(providerRaw || '').toLowerCase();
  const albumId = String(albumIdRaw || '').trim();
  const albumName = String(albumNameRaw || '').trim();

  if (!provider) {
    return fail('provider is required', 400);
  }
  if (!albumId) {
    return fail('album_id required', 400);
  }

  const providerResult = await _validProvider(provider);
  if (!providerResult.success) {
    return providerResult as ServiceResult<true>;
  }

  try {
    const encryptedPassphrase = passphrase ? encrypt_api_key(passphrase) : null;
    const result = await asyncDb
      .prepare(
        'INSERT OR IGNORE INTO trip_album_links (trip_id, user_id, provider, album_id, album_name, passphrase) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(tripId, userId, provider, albumId, albumName, encryptedPassphrase);

    if (result.changes === 0) {
      return fail('Album already linked', 409);
    }

    return success(true);
  } catch (error) {
    return mapDbError(error as Error, 'Failed to link album');
  }
}

export async function removeAlbumLink(tripId: string, linkId: string, userId: number): Promise<ServiceResult<true>> {
  const access = await canAccessTripAsync(tripId, userId);
  if (!access) {
    return fail('Trip not found or access denied', 404);
  }

  try {
    const linkedPhotos = await asyncDb
      .prepare('SELECT photo_id FROM trip_photos WHERE trip_id = ? AND album_link_id = ?')
      .all<{ photo_id: number }>(tripId, linkId);

    await asyncDb.transaction(async () => {
      await asyncDb.prepare('DELETE FROM trip_photos WHERE trip_id = ? AND album_link_id = ?').run(tripId, linkId);
      await asyncDb.prepare('DELETE FROM trip_album_links WHERE id = ? AND trip_id = ? AND user_id = ?').run(
        linkId,
        tripId,
        userId,
      );
    })();

    for (const { photo_id } of linkedPhotos) {
      await deleteTrippiPhotoIfOrphanAsync(photo_id);
    }

    return success(true);
  } catch (error) {
    return mapDbError(error as Error, 'Failed to remove album link');
  }
}

//-----------------------------------------------
// notifications helper

async function _notifySharedTripPhotos(
  tripId: string,
  actorUserId: number,
  added: number,
): Promise<ServiceResult<void>> {
  if (added <= 0) return success(undefined);

  try {
    const actorRow = await asyncDb
      .prepare('SELECT username, email FROM users WHERE id = ?')
      .get<{ username: string | null; email: string | null }>(actorUserId);

    const tripInfo = await asyncDb.prepare('SELECT title FROM trips WHERE id = ?').get<{ title: string }>(tripId);

    if (resolveDbProvider() !== 'oracle-async') {
      send({
        event: 'photos_shared',
        actorId: actorUserId,
        scope: 'trip',
        targetId: Number(tripId),
        params: {
          trip: tripInfo?.title || 'Untitled',
          actor: actorRow?.email || 'Unknown',
          count: String(added),
          tripId: String(tripId),
        },
      }).catch(() => {});
    }
    return success(undefined);
  } catch {
    return fail('Failed to send notifications', 500);
  }
}

export {
  listTripPhotos as listTripPhotosAsync,
  listTripAlbumLinks as listTripAlbumLinksAsync,
  addTripPhotos as addTripPhotosAsync,
  setTripPhotoSharing as setTripPhotoSharingAsync,
  removeTripPhoto as removeTripPhotoAsync,
  createTripAlbumLink as createTripAlbumLinkAsync,
  removeAlbumLink as removeAlbumLinkAsync,
};
