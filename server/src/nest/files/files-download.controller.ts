import { FilesService } from './files.service';
import { Controller, Get, HttpException, Param, Req, Res } from '@nestjs/common';
import { openStoredMedia, sendMediaObject, tripFileLegacyKey } from '../../services/mediaStorage';

import type { Request, Response } from 'express';
import path from 'path';

/**
 * GET /api/trips/:tripId/files/:id/download — authenticated file download.
 *
 * Deliberately NOT behind the JwtAuthGuard: it accepts a cookie, a Bearer header
 * OR a one-shot `?token=` query param (so links can be opened directly), all via
 * the legacy authenticateDownload helper. Byte-identical to the legacy route:
 * 401 token, 404 trip/file, 403 path traversal, .pkpass served inline for Wallet.
 */
@Controller('api/trips/:tripId/files')
export class FilesDownloadController {
  constructor(private readonly files: FilesService) {}

  @Get(':id/download')
  async download(
    @Req() req: Request,
    @Res() res: Response,
    @Param('tripId') tripId: string,
    @Param('id') id: string,
  ): Promise<void> {
    const auth = await this.files.authenticateDownload(req);
    if ('error' in auth) {
      throw new HttpException({ error: auth.error }, auth.status);
    }

    const trip = await this.files.verifyTripAccess(tripId, auth.userId);
    if (!trip) {
      throw new HttpException({ error: 'Trip not found' }, 404);
    }

    const file = await this.files.getFileById(id, tripId);
    if (!file) {
      throw new HttpException({ error: 'File not found' }, 404);
    }

    let legacyKey: string;
    let object;
    try {
      legacyKey = tripFileLegacyKey(file.filename);
      object = await openStoredMedia(file.storage_key, legacyKey);
    } catch {
      throw new HttpException({ error: 'Forbidden' }, 403);
    }
    if (!object) {
      throw new HttpException({ error: 'File not found' }, 404);
    }

    // Serve Apple Wallet passes inline with the canonical MIME type so Safari
    // (iOS/macOS) hands them to Wallet instead of downloading as a blob.
    const isPkpass = path.extname(file.original_name || file.filename).toLowerCase() === '.pkpass';
    await sendMediaObject(res, object, {
      contentType: isPkpass ? 'application/vnd.apple.pkpass' : file.mime_type,
      contentDisposition: isPkpass ? `inline; filename="${path.basename(file.original_name || file.filename)}"` : null,
    });
  }
}
