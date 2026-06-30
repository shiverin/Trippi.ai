import {
  assertAttachmentUpload,
  assertImageUpload,
  assertZipUpload,
  detectUploadKind,
} from '../../../src/services/uploadValidation';

import { describe, expect, it } from 'vitest';

function file(originalname: string, mimetype: string, buffer: Buffer): Express.Multer.File {
  return { originalname, mimetype, buffer, size: buffer.length } as Express.Multer.File;
}

describe('uploadValidation', () => {
  it('detects common file signatures', () => {
    expect(detectUploadKind(Buffer.from([0xff, 0xd8, 0xff, 0xdb]))).toBe('jpeg');
    expect(detectUploadKind(Buffer.from('%PDF-1.7\n'))).toBe('pdf');
    expect(detectUploadKind(Buffer.from([0x50, 0x4b, 0x03, 0x04]))).toBe('zip');
  });

  it('rejects an image upload whose bytes do not match its extension', async () => {
    await expect(assertImageUpload(file('cover.jpg', 'image/jpeg', Buffer.from('%PDF-1.7')), ['.jpg'])).rejects.toThrow(
      /does not match/,
    );
  });

  it('allows configured document uploads only when the magic bytes match', async () => {
    await expect(
      assertAttachmentUpload(
        file('boarding.pkpass', 'application/octet-stream', Buffer.from([0x50, 0x4b, 0x03, 0x04])),
        'pkpass',
      ),
    ).resolves.toBeUndefined();
    await expect(
      assertAttachmentUpload(file('fake.pdf', 'application/pdf', Buffer.from('not a pdf')), 'pdf'),
    ).rejects.toThrow(/does not match/);
  });

  it('rejects backup zips with spoofed content', async () => {
    await expect(assertZipUpload(file('backup.zip', 'application/zip', Buffer.from('plain text')))).rejects.toThrow(
      /does not match/,
    );
  });
});
