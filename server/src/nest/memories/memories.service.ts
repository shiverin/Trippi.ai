import { canAccessUserPhotoAsync } from '../../services/memories/helpersService';
import type { Selection } from '../../services/memories/helpersService';
import {
  getConnectionSettingsAsync,
  saveImmichSettingsAsync,
  setImmichAutoUploadAsync,
  testConnectionAsync,
  getConnectionStatusAsync,
  browseTimelineAsync,
  searchPhotosAsync,
  streamImmichAssetAsync,
  listAlbumsAsync,
  getAlbumPhotosAsync,
  syncAlbumAssetsAsync,
  getAssetInfoAsync,
  isValidAssetId,
} from '../../services/memories/immichService';
import {
  getSynologySettingsAsync,
  updateSynologySettingsAsync,
  getSynologyStatusAsync,
  testSynologyConnectionAsync,
  listSynologyAlbumsAsync,
  getSynologyAlbumPhotosAsync,
  syncSynologyAlbumLinkAsync,
  searchSynologyPhotosAsync,
  getSynologyAssetInfoAsync,
  streamSynologyAssetAsync,
} from '../../services/memories/synologyService';
import {
  listTripPhotosAsync,
  listTripAlbumLinksAsync,
  createTripAlbumLinkAsync,
  removeAlbumLinkAsync,
  addTripPhotosAsync,
  removeTripPhotoAsync,
  setTripPhotoSharingAsync,
} from '../../services/memories/unifiedService';
import { broadcast } from '../../websocket';
import { Injectable } from '@nestjs/common';

import type { Response } from 'express';

/**
 * Thin Nest wrapper around the existing memories (photo-providers) services.
 * Every method delegates to the `services/memories/*` async request-path
 * variants so provider logic, per-provider access checks and streaming helpers
 * stay centralized. No new business logic lives here.
 */
@Injectable()
export class MemoriesService {
  // ── Access check (reused by both provider asset routes) ──────────────────
  canAccessUserPhoto(
    requestingUserId: number,
    ownerUserId: number,
    tripId: string,
    assetId: string,
    provider: string,
  ): Promise<boolean> {
    return canAccessUserPhotoAsync(requestingUserId, ownerUserId, tripId, assetId, provider);
  }

  broadcast(tripId: string, event: string, payload: Record<string, unknown>, socketId?: string): void {
    broadcast(tripId, event, payload, socketId);
  }

  // ── Unified ──────────────────────────────────────────────────────────────
  listTripPhotos(tripId: string, userId: number) {
    return listTripPhotosAsync(tripId, userId);
  }

  addTripPhotos(tripId: string, userId: number, shared: boolean, selections: Selection[], sid: string) {
    return addTripPhotosAsync(tripId, userId, shared, selections, sid);
  }

  setTripPhotoSharing(tripId: string, userId: number, photoId: number, shared: boolean) {
    return setTripPhotoSharingAsync(tripId, userId, photoId, shared);
  }

  removeTripPhoto(tripId: string, userId: number, photoId: number) {
    return removeTripPhotoAsync(tripId, userId, photoId);
  }

  listTripAlbumLinks(tripId: string, userId: number) {
    return listTripAlbumLinksAsync(tripId, userId);
  }

  createTripAlbumLink(
    tripId: string,
    userId: number,
    provider: unknown,
    albumId: unknown,
    albumName: unknown,
    passphrase?: string,
  ) {
    return createTripAlbumLinkAsync(tripId, userId, provider, albumId, albumName, passphrase);
  }

  removeAlbumLink(tripId: string, linkId: string, userId: number) {
    return removeAlbumLinkAsync(tripId, linkId, userId);
  }

  // ── Immich ─────────────────────────────────────────────────────────────────
  immichGetConnectionSettings(userId: number) {
    return getConnectionSettingsAsync(userId);
  }

  immichSaveSettings(
    userId: number,
    immichUrl: string | undefined,
    immichApiKey: string | undefined,
    clientIp: string | null,
  ) {
    return saveImmichSettingsAsync(userId, immichUrl, immichApiKey, clientIp);
  }

  immichSetAutoUpload(userId: number, enabled: boolean): Promise<void> {
    return setImmichAutoUploadAsync(userId, enabled);
  }

  immichGetConnectionStatus(userId: number) {
    return getConnectionStatusAsync(userId);
  }

  immichTestConnection(immichUrl: string, immichApiKey: string) {
    return testConnectionAsync(immichUrl, immichApiKey);
  }

  immichBrowseTimeline(userId: number) {
    return browseTimelineAsync(userId);
  }

  immichSearchPhotos(userId: number, from: string | undefined, to: string | undefined, page: number, size: number) {
    return searchPhotosAsync(userId, from, to, page, size);
  }

  immichIsValidAssetId(assetId: string): boolean {
    return isValidAssetId(assetId);
  }

  immichGetAssetInfo(userId: number, assetId: string, ownerId: number) {
    return getAssetInfoAsync(userId, assetId, ownerId);
  }

  immichStreamAsset(res: Response, userId: number, assetId: string, kind: 'thumbnail' | 'original', ownerId: number) {
    return streamImmichAssetAsync(res, userId, assetId, kind, ownerId);
  }

  immichListAlbums(userId: number) {
    return listAlbumsAsync(userId);
  }

  immichGetAlbumPhotos(userId: number, albumId: string) {
    return getAlbumPhotosAsync(userId, albumId);
  }

  immichSyncAlbumAssets(tripId: string, linkId: string, userId: number, sid: string) {
    return syncAlbumAssetsAsync(tripId, linkId, userId, sid);
  }

  // ── Synology ────────────────────────────────────────────────────────────────
  synologyGetSettings(userId: number) {
    return getSynologySettingsAsync(userId);
  }

  synologyUpdateSettings(userId: number, url: string, username: string, password: string, skipSsl: boolean) {
    return updateSynologySettingsAsync(userId, url, username, password, skipSsl);
  }

  synologyGetStatus(userId: number) {
    return getSynologyStatusAsync(userId);
  }

  synologyTestConnection(
    userId: number,
    url: string,
    username: string,
    password: string,
    otp: string,
    skipSsl: boolean,
  ) {
    return testSynologyConnectionAsync(userId, url, username, password, otp, skipSsl);
  }

  synologyListAlbums(userId: number) {
    return listSynologyAlbumsAsync(userId);
  }

  synologyGetAlbumPhotos(userId: number, albumId: string, passphrase?: string) {
    return getSynologyAlbumPhotosAsync(userId, albumId, passphrase);
  }

  synologySyncAlbumLink(userId: number, tripId: string, linkId: string, sid: string) {
    return syncSynologyAlbumLinkAsync(userId, tripId, linkId, sid);
  }

  synologySearchPhotos(
    userId: number,
    from: string | undefined,
    to: string | undefined,
    offset: number,
    limit: number,
  ) {
    return searchSynologyPhotosAsync(userId, from, to, offset, limit);
  }

  synologyGetAssetInfo(userId: number, photoId: string, ownerId: number, passphrase?: string) {
    return getSynologyAssetInfoAsync(userId, photoId, ownerId, passphrase);
  }

  synologyStreamAsset(
    res: Response,
    userId: number,
    ownerId: number,
    photoId: string,
    kind: 'thumbnail' | 'original',
    size: string,
    passphrase?: string,
  ) {
    return streamSynologyAssetAsync(res, userId, ownerId, photoId, kind, size, passphrase);
  }
}
