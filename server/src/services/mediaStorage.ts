import { Storage } from '@google-cloud/storage';

import type { Response } from 'express';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export type MediaBackend = 'local' | 'gcs';
export type MediaDelivery = 'backend';

export interface MediaConfig {
  backend: MediaBackend;
  delivery: MediaDelivery;
  gcsBucket?: string;
  gcsPrefix: string;
  uploadsRoot: string;
}

export interface StoredMediaMetadata {
  storage_backend: MediaBackend;
  storage_key: string;
  storage_etag?: string | null;
  storage_size?: number | null;
  storage_content_type?: string | null;
}

export interface MediaObjectInput {
  key: string;
  body: Buffer | NodeJS.ReadableStream;
  contentType?: string | null;
  cacheControl?: string | null;
}

export interface MediaObject {
  stream: NodeJS.ReadableStream;
  contentType?: string | null;
  size?: number | null;
  etag?: string | null;
}

export interface MediaStorage {
  readonly backend: MediaBackend;
  putObject(input: MediaObjectInput): Promise<StoredMediaMetadata>;
  getObjectStream(key: string): Promise<MediaObject | null>;
  getObjectBuffer(key: string): Promise<Buffer | null>;
  exists(key: string): Promise<boolean>;
  deleteObject(key: string): Promise<void>;
}

const UPLOADS_ROOT = path.join(__dirname, '../../uploads');

let configuredStorage: MediaStorage | null = null;
let localStorage: MediaStorage | null = null;
let gcsClient: Storage | null = null;

export function getMediaConfig(): MediaConfig {
  const rawBackend = (process.env.TRIPPI_MEDIA_BACKEND || 'local').trim().toLowerCase();
  const backend: MediaBackend = rawBackend === 'gcs' ? 'gcs' : 'local';
  const rawDelivery = (process.env.TRIPPI_MEDIA_DELIVERY || 'backend').trim().toLowerCase();
  if (rawDelivery !== 'backend') {
    throw new Error('TRIPPI_MEDIA_DELIVERY currently supports only "backend"');
  }
  const gcsBucket = process.env.TRIPPI_GCS_BUCKET?.trim();
  if (backend === 'gcs' && !gcsBucket) {
    throw new Error('TRIPPI_GCS_BUCKET is required when TRIPPI_MEDIA_BACKEND=gcs');
  }
  return {
    backend,
    delivery: 'backend',
    gcsBucket,
    gcsPrefix: normalizePrefix(process.env.TRIPPI_GCS_PREFIX || 'prod'),
    uploadsRoot: UPLOADS_ROOT,
  };
}

export function resetMediaStorageForTests(): void {
  configuredStorage = null;
  localStorage = null;
  gcsClient = null;
}

export function getMediaStorage(): MediaStorage {
  if (configuredStorage) return configuredStorage;
  const config = getMediaConfig();
  configuredStorage = config.backend === 'gcs' ? new GcsMediaStorage(config) : getLocalMediaStorage();
  return configuredStorage;
}

export function getLocalMediaStorage(): MediaStorage {
  localStorage ||= new LocalMediaStorage(UPLOADS_ROOT);
  return localStorage;
}

export function normalizeMediaKey(input: string): string {
  const normalized = input.replace(/\\/g, '/').replace(/^\/+/, '');
  const clean = path.posix.normalize(normalized);
  if (!clean || clean === '.' || clean.startsWith('../') || clean.includes('/../') || path.posix.isAbsolute(clean)) {
    throw new Error('Invalid media key');
  }
  return clean;
}

export function mediaFilename(originalName: string, fallbackExt = ''): string {
  const ext = path.extname(originalName || '').toLowerCase() || fallbackExt;
  return `${crypto.randomUUID()}${ext}`;
}

export function mediaKey(namespace: 'avatars' | 'covers' | 'journey' | 'exports' | 'files', filename: string): string {
  return normalizeMediaKey(`${namespace}/${path.basename(filename)}`);
}

export function tripFileLegacyKey(filename: string): string {
  const key = normalizeMediaKey(filename);
  return key.startsWith('files/') ? key : `files/${path.basename(key)}`;
}

export function uploadUrlToMediaKey(url: string | null | undefined): string | null {
  if (!url) return null;
  let value = url;
  try {
    if (/^https?:\/\//i.test(value)) value = new URL(value).pathname;
  } catch {
    return null;
  }
  if (value.startsWith('/uploads/')) return normalizeMediaKey(value.slice('/uploads/'.length));
  if (value.startsWith('uploads/')) return normalizeMediaKey(value.slice('uploads/'.length));
  if (/^(avatars|covers|journey|exports|files)\//.test(value)) return normalizeMediaKey(value);
  return null;
}

export async function storeUploadedMedia(
  namespace: 'avatars' | 'covers' | 'journey' | 'exports' | 'files',
  file: Pick<Express.Multer.File, 'originalname' | 'mimetype' | 'buffer' | 'size'>,
  fallbackExt = '',
): Promise<{ filename: string; key: string; metadata: StoredMediaMetadata }> {
  if (!file.buffer) throw new Error('Uploaded file was not buffered');
  const filename = mediaFilename(file.originalname, fallbackExt);
  const key = mediaKey(namespace, filename);
  const metadata = await getMediaStorage().putObject({
    key,
    body: file.buffer,
    contentType: file.mimetype || 'application/octet-stream',
  });
  return { filename, key, metadata };
}

export async function putMediaBuffer(
  namespace: 'avatars' | 'covers' | 'journey' | 'exports' | 'files',
  filename: string,
  buffer: Buffer,
  contentType: string,
): Promise<StoredMediaMetadata> {
  return getMediaStorage().putObject({
    key: mediaKey(namespace, filename),
    body: buffer,
    contentType,
  });
}

export async function openStoredMedia(
  storageKey: string | null | undefined,
  legacyLocalKey?: string | null,
): Promise<MediaObject | null> {
  if (storageKey) {
    const primary = await getMediaStorage().getObjectStream(storageKey);
    if (primary) return primary;
  }
  if (legacyLocalKey) return getLocalMediaStorage().getObjectStream(legacyLocalKey);
  return null;
}

export async function openMediaWithLocalFallback(key: string): Promise<MediaObject | null> {
  const normalized = normalizeMediaKey(key);
  const primary = await getMediaStorage().getObjectStream(normalized);
  if (primary) return primary;
  if (getMediaConfig().backend !== 'local') return getLocalMediaStorage().getObjectStream(normalized);
  return null;
}

export async function readMediaBufferWithLocalFallback(key: string): Promise<Buffer | null> {
  const normalized = normalizeMediaKey(key);
  const primary = await getMediaStorage().getObjectBuffer(normalized);
  if (primary) return primary;
  if (getMediaConfig().backend !== 'local') return getLocalMediaStorage().getObjectBuffer(normalized);
  return null;
}

export async function readStoredMediaBuffer(
  storageKey: string | null | undefined,
  legacyLocalKey?: string | null,
): Promise<Buffer | null> {
  if (storageKey) {
    const primary = await getMediaStorage().getObjectBuffer(storageKey);
    if (primary) return primary;
  }
  if (legacyLocalKey) return getLocalMediaStorage().getObjectBuffer(legacyLocalKey);
  return null;
}

export async function deleteStoredMedia(
  storageKey: string | null | undefined,
  legacyLocalKey?: string | null,
): Promise<void> {
  if (storageKey) {
    await getMediaStorage().deleteObject(storageKey);
    if (!legacyLocalKey || getMediaConfig().backend === 'local') return;
  }
  if (legacyLocalKey) {
    await getLocalMediaStorage().deleteObject(legacyLocalKey);
  }
}

export async function deleteMediaBestEffort(storageKey: string | null | undefined, legacyLocalKey?: string | null) {
  try {
    await deleteStoredMedia(storageKey, legacyLocalKey);
  } catch (err) {
    console.warn('[media] best-effort delete failed:', err instanceof Error ? err.message : err);
  }
}

export async function sendMediaObject(
  res: Response,
  object: MediaObject,
  opts: { contentType?: string | null; contentDisposition?: string | null; cacheControl?: string | null } = {},
): Promise<void> {
  if (opts.contentType || object.contentType) res.setHeader('Content-Type', opts.contentType || object.contentType!);
  if (opts.contentDisposition) res.setHeader('Content-Disposition', opts.contentDisposition);
  if (opts.cacheControl) res.setHeader('Cache-Control', opts.cacheControl);
  if (object.size != null) res.setHeader('Content-Length', String(object.size));
  if (object.etag) res.setHeader('ETag', object.etag);
  await pipeline(object.stream, res);
}

export async function sendMediaBuffer(
  res: Response,
  buffer: Buffer,
  opts: { contentType?: string | null; cacheControl?: string | null } = {},
): Promise<void> {
  if (opts.contentType) res.setHeader('Content-Type', opts.contentType);
  if (opts.cacheControl) res.setHeader('Cache-Control', opts.cacheControl);
  res.setHeader('Content-Length', String(buffer.length));
  res.send(buffer);
}

function normalizePrefix(prefix: string): string {
  const normalized = prefix.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  if (!normalized || normalized === '.') return '';
  const clean = path.posix.normalize(normalized);
  if (clean.startsWith('../') || clean.includes('/../') || path.posix.isAbsolute(clean)) {
    throw new Error('Invalid TRIPPI_GCS_PREFIX');
  }
  return clean;
}

function bufferFrom(input: Buffer | NodeJS.ReadableStream): NodeJS.ReadableStream {
  return Buffer.isBuffer(input) ? Readable.from(input) : input;
}

function localPathFor(root: string, key: string): string {
  const normalized = normalizeMediaKey(key);
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, normalized);
  if (resolved !== resolvedRoot && !resolved.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new Error('Invalid media key');
  }
  return resolved;
}

class LocalMediaStorage implements MediaStorage {
  readonly backend = 'local' as const;

  constructor(private readonly root: string) {}

  async putObject(input: MediaObjectInput): Promise<StoredMediaMetadata> {
    const key = normalizeMediaKey(input.key);
    const filePath = localPathFor(this.root, key);
    await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
    if (Buffer.isBuffer(input.body)) {
      await fs.promises.writeFile(filePath, input.body);
    } else {
      await pipeline(input.body, fs.createWriteStream(filePath));
    }
    const stat = await fs.promises.stat(filePath);
    return {
      storage_backend: this.backend,
      storage_key: key,
      storage_size: stat.size,
      storage_content_type: input.contentType || null,
      storage_etag: null,
    };
  }

  async getObjectStream(key: string): Promise<MediaObject | null> {
    const filePath = localPathFor(this.root, key);
    try {
      const stat = await fs.promises.stat(filePath);
      if (!stat.isFile()) return null;
      return { stream: fs.createReadStream(filePath), size: stat.size };
    } catch {
      return null;
    }
  }

  async getObjectBuffer(key: string): Promise<Buffer | null> {
    const filePath = localPathFor(this.root, key);
    try {
      return await fs.promises.readFile(filePath);
    } catch {
      return null;
    }
  }

  async exists(key: string): Promise<boolean> {
    const filePath = localPathFor(this.root, key);
    try {
      const stat = await fs.promises.stat(filePath);
      return stat.isFile();
    } catch {
      return false;
    }
  }

  async deleteObject(key: string): Promise<void> {
    const filePath = localPathFor(this.root, key);
    await fs.promises.rm(filePath, { force: true });
  }
}

class GcsMediaStorage implements MediaStorage {
  readonly backend = 'gcs' as const;
  private readonly bucketName: string;
  private readonly prefix: string;

  constructor(config: MediaConfig) {
    if (!config.gcsBucket) throw new Error('TRIPPI_GCS_BUCKET is required when TRIPPI_MEDIA_BACKEND=gcs');
    this.bucketName = config.gcsBucket;
    this.prefix = config.gcsPrefix;
  }

  private objectName(key: string): string {
    const normalized = normalizeMediaKey(key);
    return this.prefix ? `${this.prefix}/${normalized}` : normalized;
  }

  private bucket() {
    gcsClient ||= new Storage();
    return gcsClient.bucket(this.bucketName);
  }

  async putObject(input: MediaObjectInput): Promise<StoredMediaMetadata> {
    const key = normalizeMediaKey(input.key);
    const file = this.bucket().file(this.objectName(key));
    const stream = file.createWriteStream({
      resumable: false,
      metadata: {
        contentType: input.contentType || undefined,
        cacheControl: input.cacheControl || undefined,
      },
    });
    await pipeline(bufferFrom(input.body), stream);
    const [metadata] = await file.getMetadata();
    return {
      storage_backend: this.backend,
      storage_key: key,
      storage_etag: metadata.etag || null,
      storage_size: metadata.size ? Number(metadata.size) : null,
      storage_content_type: metadata.contentType || input.contentType || null,
    };
  }

  async getObjectStream(key: string): Promise<MediaObject | null> {
    const file = this.bucket().file(this.objectName(key));
    const [exists] = await file.exists();
    if (!exists) return null;
    const [metadata] = await file.getMetadata();
    return {
      stream: file.createReadStream(),
      contentType: metadata.contentType || null,
      size: metadata.size ? Number(metadata.size) : null,
      etag: metadata.etag || null,
    };
  }

  async getObjectBuffer(key: string): Promise<Buffer | null> {
    const file = this.bucket().file(this.objectName(key));
    const [exists] = await file.exists();
    if (!exists) return null;
    const [buffer] = await file.download();
    return buffer;
  }

  async exists(key: string): Promise<boolean> {
    const [exists] = await this.bucket().file(this.objectName(key)).exists();
    return exists;
  }

  async deleteObject(key: string): Promise<void> {
    await this.bucket().file(this.objectName(key)).delete({ ignoreNotFound: true });
  }
}
