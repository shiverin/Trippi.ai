import { afterEach, describe, expect, it } from 'vitest';
import crypto from 'node:crypto';

import {
  deleteStoredMedia,
  getLocalMediaStorage,
  getMediaConfig,
  getMediaStorage,
  normalizeMediaKey,
  readStoredMediaBuffer,
  resetMediaStorageForTests,
  storeUploadedMedia,
  uploadUrlToMediaKey,
} from '../../../src/services/mediaStorage';

const ORIGINAL_ENV = {
  TRIPPI_MEDIA_BACKEND: process.env.TRIPPI_MEDIA_BACKEND,
  TRIPPI_MEDIA_DELIVERY: process.env.TRIPPI_MEDIA_DELIVERY,
  TRIPPI_GCS_BUCKET: process.env.TRIPPI_GCS_BUCKET,
  TRIPPI_GCS_PREFIX: process.env.TRIPPI_GCS_PREFIX,
};

function restoreEnv() {
  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  resetMediaStorageForTests();
}

afterEach(() => restoreEnv());

describe('mediaStorage', () => {
  it('defaults to local backend and backend delivery', () => {
    delete process.env.TRIPPI_MEDIA_BACKEND;
    delete process.env.TRIPPI_MEDIA_DELIVERY;
    delete process.env.TRIPPI_GCS_BUCKET;
    resetMediaStorageForTests();

    expect(getMediaConfig()).toMatchObject({ backend: 'local', delivery: 'backend', gcsPrefix: 'prod' });
    expect(getMediaStorage().backend).toBe('local');
  });

  it('validates production GCS configuration', () => {
    process.env.TRIPPI_MEDIA_BACKEND = 'gcs';
    delete process.env.TRIPPI_GCS_BUCKET;
    resetMediaStorageForTests();

    expect(() => getMediaConfig()).toThrow(/TRIPPI_GCS_BUCKET/);

    process.env.TRIPPI_GCS_BUCKET = 'trippi-media';
    process.env.TRIPPI_GCS_PREFIX = '/prod/uploads/';
    resetMediaStorageForTests();

    expect(getMediaConfig()).toMatchObject({ backend: 'gcs', gcsBucket: 'trippi-media', gcsPrefix: 'prod/uploads' });
  });

  it('rejects unsupported delivery modes and unsafe media keys', () => {
    process.env.TRIPPI_MEDIA_DELIVERY = 'signed-url';
    resetMediaStorageForTests();
    expect(() => getMediaConfig()).toThrow(/TRIPPI_MEDIA_DELIVERY/);

    expect(() => normalizeMediaKey('../secret.jpg')).toThrow(/Invalid media key/);
    expect(uploadUrlToMediaKey('/uploads/journey/photo.jpg')).toBe('journey/photo.jpg');
  });

  it('stores, reads, and deletes local media bytes', async () => {
    process.env.TRIPPI_MEDIA_BACKEND = 'local';
    resetMediaStorageForTests();
    const key = `test-media/${crypto.randomUUID()}.txt`;
    const body = Buffer.from('hello trippi media');

    try {
      const metadata = await getMediaStorage().putObject({ key, body, contentType: 'text/plain' });

      expect(metadata).toMatchObject({
        storage_backend: 'local',
        storage_key: key,
        storage_content_type: 'text/plain',
        storage_size: body.length,
      });
      expect((await readStoredMediaBuffer(metadata.storage_key))?.toString()).toBe('hello trippi media');
    } finally {
      await deleteStoredMedia(key);
    }
    expect(await getLocalMediaStorage().exists(key)).toBe(false);
  });

  it('keeps legacy local fallback for rows without current storage bytes', async () => {
    process.env.TRIPPI_MEDIA_BACKEND = 'local';
    resetMediaStorageForTests();
    const key = `test-media/${crypto.randomUUID()}.jpg`;

    try {
      await getLocalMediaStorage().putObject({
        key,
        body: Buffer.from('legacy local bytes'),
        contentType: 'image/jpeg',
      });

      expect((await readStoredMediaBuffer('test-media/missing.jpg', key))?.toString()).toBe('legacy local bytes');
    } finally {
      await deleteStoredMedia(null, key);
    }
  });

  it('stores buffered multer uploads with stable metadata', async () => {
    process.env.TRIPPI_MEDIA_BACKEND = 'local';
    resetMediaStorageForTests();
    const file = {
      originalname: 'cover.jpg',
      mimetype: 'image/jpeg',
      buffer: Buffer.from('jpeg-bytes'),
      size: 10,
    } as Express.Multer.File;
    let storedKey: string | null = null;

    try {
      const stored = await storeUploadedMedia('covers', file, '.jpg');
      storedKey = stored.key;

      expect(stored.filename).toMatch(/\.jpg$/);
      expect(stored.metadata).toMatchObject({
        storage_backend: 'local',
        storage_key: stored.key,
        storage_content_type: 'image/jpeg',
      });
      expect((await readStoredMediaBuffer(stored.key))?.toString()).toBe('jpeg-bytes');
    } finally {
      await deleteStoredMedia(storedKey);
    }
  });
});
