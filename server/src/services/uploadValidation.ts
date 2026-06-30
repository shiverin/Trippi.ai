import { BLOCKED_EXTENSIONS } from './uploadPolicy';
import { HttpException } from '@nestjs/common';

import fs from 'node:fs/promises';
import path from 'node:path';

type DetectedKind = 'jpeg' | 'png' | 'gif' | 'webp' | 'heic' | 'pdf' | 'zip' | 'ole' | 'text' | 'unknown';

const IMAGE_EXT_KIND: Record<string, DetectedKind> = {
  '.jpg': 'jpeg',
  '.jpeg': 'jpeg',
  '.png': 'png',
  '.gif': 'gif',
  '.webp': 'webp',
  '.heic': 'heic',
  '.heif': 'heic',
};

const DOCUMENT_EXT_KIND: Record<string, DetectedKind> = {
  '.pdf': 'pdf',
  '.doc': 'ole',
  '.xls': 'ole',
  '.docx': 'zip',
  '.xlsx': 'zip',
  '.pkpass': 'zip',
};

export class UploadValidationError extends HttpException {
  constructor(message: string) {
    super({ error: message }, 400);
    this.message = message;
  }
}

function invalid(message: string): never {
  throw new UploadValidationError(message);
}

type MinimalUploadFile = Partial<
  Pick<Express.Multer.File, 'originalname' | 'filename' | 'mimetype' | 'buffer' | 'path'>
>;

function extOf(file: MinimalUploadFile): string {
  return path.extname(file.originalname || file.filename || '').toLowerCase();
}

function hasReadableBytes(file: MinimalUploadFile): boolean {
  return Buffer.isBuffer(file.buffer) || typeof file.path === 'string';
}

async function readHead(file: MinimalUploadFile, bytes = 560): Promise<Buffer> {
  if (file.buffer) return file.buffer.subarray(0, bytes);
  if (file.path) {
    const handle = await fs.open(file.path, 'r');
    try {
      const buffer = Buffer.alloc(bytes);
      const { bytesRead } = await handle.read(buffer, 0, bytes, 0);
      return buffer.subarray(0, bytesRead);
    } finally {
      await handle.close();
    }
  }
  return Buffer.alloc(0);
}

function hasAscii(buffer: Buffer, offset: number, value: string): boolean {
  return buffer.subarray(offset, offset + value.length).toString('ascii') === value;
}

function isProbablyText(buffer: Buffer): boolean {
  if (buffer.length === 0) return true;
  if (buffer.includes(0)) return false;
  let suspicious = 0;
  for (const byte of buffer) {
    if (byte === 9 || byte === 10 || byte === 13) continue;
    if (byte >= 32) continue;
    suspicious += 1;
  }
  return suspicious / buffer.length < 0.05;
}

export function detectUploadKind(buffer: Buffer): DetectedKind {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'jpeg';
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return 'png';
  }
  if (buffer.length >= 6 && (hasAscii(buffer, 0, 'GIF87a') || hasAscii(buffer, 0, 'GIF89a'))) return 'gif';
  if (buffer.length >= 12 && hasAscii(buffer, 0, 'RIFF') && hasAscii(buffer, 8, 'WEBP')) return 'webp';
  if (buffer.length >= 12 && hasAscii(buffer, 4, 'ftyp')) {
    const brand = buffer.subarray(8, 12).toString('ascii');
    if (['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'mif1', 'msf1'].includes(brand)) return 'heic';
  }
  if (buffer.length >= 5 && hasAscii(buffer, 0, '%PDF-')) return 'pdf';
  if (
    buffer.length >= 4 &&
    buffer[0] === 0x50 &&
    buffer[1] === 0x4b &&
    [0x03, 0x05, 0x07].includes(buffer[2]) &&
    [0x04, 0x06, 0x08].includes(buffer[3])
  ) {
    return 'zip';
  }
  if (
    buffer.length >= 8 &&
    buffer[0] === 0xd0 &&
    buffer[1] === 0xcf &&
    buffer[2] === 0x11 &&
    buffer[3] === 0xe0 &&
    buffer[4] === 0xa1 &&
    buffer[5] === 0xb1 &&
    buffer[6] === 0x1a &&
    buffer[7] === 0xe1
  ) {
    return 'ole';
  }
  if (isProbablyText(buffer)) return 'text';
  return 'unknown';
}

export async function assertImageUpload(file: MinimalUploadFile, allowedExts: string[]): Promise<void> {
  const ext = extOf(file);
  const normalizedAllowed = allowedExts.map((value) => (value.startsWith('.') ? value : `.${value}`).toLowerCase());
  if (!normalizedAllowed.includes(ext)) invalid(`File type ${ext || '(none)'} is not allowed`);
  if (!hasReadableBytes(file)) return;
  if (!file.mimetype?.startsWith('image/')) invalid('Only image files are allowed');

  const expected = IMAGE_EXT_KIND[ext];
  if (!expected) invalid(`File type ${ext || '(none)'} is not allowed`);
  const detected = detectUploadKind(await readHead(file));
  if (detected !== expected) {
    invalid(`Uploaded file content does not match ${ext}`);
  }
}

export async function assertAttachmentUpload(file: MinimalUploadFile, allowedCsv: string): Promise<void> {
  const ext = extOf(file);
  if (!ext || BLOCKED_EXTENSIONS.includes(ext) || file.mimetype?.includes('svg')) invalid('File type not allowed');

  const allowed = allowedCsv.split(',').map((value) => value.trim().toLowerCase());
  const wildcard = allowed.includes('*');
  if (!wildcard && !allowed.includes(ext.slice(1))) invalid('File type not allowed');
  if (!hasReadableBytes(file)) return;

  const detected = detectUploadKind(await readHead(file));
  const imageKind = IMAGE_EXT_KIND[ext];
  if (imageKind) {
    if (detected !== imageKind) invalid(`Uploaded file content does not match ${ext}`);
    return;
  }

  const documentKind = DOCUMENT_EXT_KIND[ext];
  if (documentKind) {
    if (detected !== documentKind) invalid(`Uploaded file content does not match ${ext}`);
    return;
  }

  if (ext === '.txt' || ext === '.csv') {
    if (detected !== 'text') invalid(`Uploaded file content does not match ${ext}`);
    return;
  }

  if (!wildcard && detected === 'unknown') invalid('Unsupported file content');
}

export async function assertZipUpload(file: MinimalUploadFile): Promise<void> {
  if (extOf(file) !== '.zip') invalid('Only ZIP files allowed');
  if (!hasReadableBytes(file)) return;
  if (detectUploadKind(await readHead(file)) !== 'zip') invalid('Uploaded file content does not match .zip');
}

export async function assertBookingImportUpload(file: MinimalUploadFile, acceptedExts: Set<string>): Promise<void> {
  const ext = extOf(file);
  if (!acceptedExts.has(ext)) {
    invalid(`Unsupported file type: ${file.originalname}`);
  }
  if (!hasReadableBytes(file)) return;
  const detected = detectUploadKind(await readHead(file));
  if (ext === '.pdf' && detected !== 'pdf') invalid(`Uploaded file content does not match ${ext}`);
  if (ext === '.pkpass' && detected !== 'zip') invalid(`Uploaded file content does not match ${ext}`);
  if (['.eml', '.html', '.htm', '.txt'].includes(ext) && detected !== 'text') {
    invalid(`Uploaded file content does not match ${ext}`);
  }
}

export async function assertXmlOrZipUpload(file: MinimalUploadFile, acceptedExts: Set<string>): Promise<void> {
  const ext = extOf(file);
  if (!acceptedExts.has(ext)) invalid(`Unsupported file type: ${file.originalname}`);
  if (!hasReadableBytes(file)) return;
  const detected = detectUploadKind(await readHead(file));
  if (ext === '.kmz') {
    if (detected !== 'zip') invalid('Uploaded file content does not match KMZ');
    return;
  }
  if (detected !== 'text') invalid(`Uploaded file content does not match ${ext}`);
}
