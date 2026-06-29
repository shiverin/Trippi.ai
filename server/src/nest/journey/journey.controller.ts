import { getAllowedExtensionsAsync } from '../../services/fileService';
import type { User } from '../../types';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { JourneyAddonGuard } from './journey-addon.guard';
import { JourneyService } from './journey.service';
import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpException,
  Param,
  Patch,
  Post,
  Put,
  UploadedFile,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor, FilesInterceptor } from '@nestjs/platform-express';

import { diskStorage } from 'multer';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const uploadsBase = path.join(__dirname, '../../../uploads/journey');
const IMAGE_UPLOAD = {
  storage: diskStorage({
    destination: (_req, _file, cb) => {
      if (!fs.existsSync(uploadsBase)) fs.mkdirSync(uploadsBase, { recursive: true });
      cb(null, uploadsBase);
    },
    filename: (_req, file, cb) =>
      cb(null, `${crypto.randomUUID()}${path.extname(file.originalname).toLowerCase() || '.jpg'}`),
  }),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (_req: unknown, file: Express.Multer.File, cb: (err: Error | null, accept: boolean) => void) => {
    if (!file.mimetype.startsWith('image/') || file.mimetype.includes('svg')) {
      const err: Error & { statusCode?: number } = new Error('Only image files are allowed');
      err.statusCode = 400;
      return cb(err, false);
    }
    const ext = path.extname(file.originalname).toLowerCase().replace('.', '');
    void getAllowedExtensionsAsync()
      .then((allowedCsv) => {
        const allowed = allowedCsv.split(',').map((e) => e.trim().toLowerCase());
        if (!allowed.includes('*') && !allowed.includes(ext)) {
          const err: Error & { statusCode?: number } = new Error(`File type .${ext} is not allowed`);
          err.statusCode = 400;
          return cb(err, false);
        }
        cb(null, true);
      })
      .catch((err) => cb(err instanceof Error ? err : new Error('File type validation failed'), false));
  },
};

/**
 * /api/journeys — cross-trip travel narrative (journeys, entries, photo gallery
 * + provider mirroring, contributors, preferences, share links).
 *
 * Byte-identical to the legacy Express route (server/src/routes/journey.ts):
 * the Journey-addon gate (404) runs before auth, the service owns access
 * control (null/false → 403/404), create routes answer 201 while cover/trips/
 * share-link/reorder/patch answer 200 and the two unlink/gallery-delete routes
 * answer 204. Static prefixes (/suggestions, /available-trips, /entries, /photos)
 * are declared before /:id so they win over the param.
 */
@Controller('api/journeys')
@UseGuards(JourneyAddonGuard, JwtAuthGuard)
export class JourneyController {
  constructor(private readonly journey: JourneyService) {}

  // ── Static prefix routes (before /:id) ──────────────────────────────────
  @Get()
  async list(@CurrentUser() user: User) {
    return { journeys: await this.journey.listJourneys(user.id) };
  }

  @Post()
  async create(@CurrentUser() user: User, @Body() body: { title?: string; subtitle?: string; trip_ids?: unknown[] }) {
    if (!body.title || typeof body.title !== 'string' || !body.title.trim()) {
      throw new HttpException({ error: 'Title is required' }, 400);
    }
    return await this.journey.createJourney(user.id, {
      title: body.title.trim(),
      subtitle: body.subtitle,
      trip_ids: Array.isArray(body.trip_ids) ? body.trip_ids.map(Number) : [],
    });
  }

  @Get('suggestions')
  async suggestions(@CurrentUser() user: User) {
    return { trips: await this.journey.getSuggestions(user.id) };
  }

  @Get('available-trips')
  async availableTrips(@CurrentUser() user: User) {
    return { trips: await this.journey.listUserTrips(user.id) };
  }

  // ── Entries (prefix /entries — before /:id) ─────────────────────────────
  @Patch('entries/:entryId')
  async updateEntry(
    @CurrentUser() user: User,
    @Param('entryId') entryId: string,
    @Body() body: Record<string, unknown>,
    @Headers('x-socket-id') socketId?: string,
  ) {
    const result = await this.journey.updateEntry(Number(entryId), user.id, body, socketId);
    if (!result) {
      throw new HttpException({ error: 'Entry not found' }, 404);
    }
    return result;
  }

  @Delete('entries/:entryId')
  async deleteEntry(
    @CurrentUser() user: User,
    @Param('entryId') entryId: string,
    @Headers('x-socket-id') socketId?: string,
  ) {
    if (!(await this.journey.deleteEntry(Number(entryId), user.id, socketId))) {
      throw new HttpException({ error: 'Entry not found' }, 404);
    }
    return { success: true };
  }

  @Post('entries/:entryId/photos')
  @UseInterceptors(FilesInterceptor('photos', undefined, IMAGE_UPLOAD))
  async uploadEntryPhotos(
    @CurrentUser() user: User,
    @Param('entryId') entryId: string,
    @UploadedFiles() files: Express.Multer.File[] | undefined,
    @Body() body: { caption?: string },
  ) {
    if (!files?.length) {
      throw new HttpException({ error: 'No files uploaded' }, 400);
    }
    const results: unknown[] = [];
    for (const file of files) {
      const relativePath = `journey/${file.filename}`;
      const photo = await this.journey.addPhoto(Number(entryId), user.id, relativePath, undefined, body?.caption);
      if (!photo) continue;
      // Mirror to Immich only when the user explicitly opted in (#730).
      if (await this.journey.immichAutoUploadEnabled(user.id)) {
        try {
          const immichId = await this.journey.uploadToImmich(user.id, relativePath, file.originalname);
          if (immichId) {
            await this.journey.setPhotoProvider(photo.id, 'immich', immichId, user.id);
            Object.assign(photo, { provider: 'immich', asset_id: immichId, owner_id: user.id });
          }
        } catch {
          // best-effort mirror; the local photo is already saved
        }
      }
      results.push(photo);
    }
    if (!results.length) {
      throw new HttpException({ error: 'Not allowed' }, 403);
    }
    return { photos: results };
  }

  @Post('entries/:entryId/provider-photos')
  async providerPhotos(
    @CurrentUser() user: User,
    @Param('entryId') entryId: string,
    @Body()
    body: { provider?: string; asset_id?: string; asset_ids?: unknown[]; caption?: string; passphrase?: string },
  ) {
    const pp = body.passphrase && typeof body.passphrase === 'string' ? body.passphrase : undefined;
    if (Array.isArray(body.asset_ids) && body.provider) {
      const added: unknown[] = [];
      for (const id of body.asset_ids) {
        const photo = await this.journey.addProviderPhoto(
          Number(entryId),
          user.id,
          body.provider,
          String(id),
          body.caption,
          pp,
        );
        if (photo) added.push(photo);
      }
      return { photos: added, added: added.length };
    }
    if (!body.provider || !body.asset_id) {
      throw new HttpException({ error: 'provider and asset_id required' }, 400);
    }
    const photo = await this.journey.addProviderPhoto(
      Number(entryId),
      user.id,
      body.provider,
      body.asset_id,
      body.caption,
      pp,
    );
    if (!photo) {
      throw new HttpException({ error: 'Not allowed or duplicate' }, 403);
    }
    return photo;
  }

  @Post('entries/:entryId/link-photo')
  async linkPhoto(
    @CurrentUser() user: User,
    @Param('entryId') entryId: string,
    @Body() body: { journey_photo_id?: unknown; photo_id?: unknown },
  ) {
    const journeyPhotoId = body.journey_photo_id ?? body.photo_id;
    if (!journeyPhotoId) {
      throw new HttpException({ error: 'journey_photo_id required' }, 400);
    }
    const result = await this.journey.linkPhotoToEntry(Number(entryId), Number(journeyPhotoId), user.id);
    if (!result) {
      throw new HttpException({ error: 'Not allowed' }, 403);
    }
    return result;
  }

  @Delete('entries/:entryId/photos/:journeyPhotoId')
  @HttpCode(204)
  async unlinkPhoto(
    @CurrentUser() user: User,
    @Param('entryId') entryId: string,
    @Param('journeyPhotoId') journeyPhotoId: string,
  ): Promise<void> {
    if (!(await this.journey.unlinkPhotoFromEntry(Number(entryId), Number(journeyPhotoId), user.id))) {
      throw new HttpException({ error: 'Not found or not allowed' }, 404);
    }
  }

  @Patch('photos/:photoId')
  async updatePhoto(
    @CurrentUser() user: User,
    @Param('photoId') photoId: string,
    @Body() body: Record<string, unknown>,
  ) {
    const result = await this.journey.updatePhoto(Number(photoId), user.id, body);
    if (!result) {
      throw new HttpException({ error: 'Photo not found' }, 404);
    }
    return result;
  }

  @Delete('photos/:photoId')
  async deletePhoto(@CurrentUser() user: User, @Param('photoId') photoId: string) {
    const photo = await this.journey.deletePhoto(Number(photoId), user.id);
    if (!photo) {
      throw new HttpException({ error: 'Photo not found' }, 404);
    }
    if (photo.file_path) {
      try {
        fs.unlinkSync(path.join(__dirname, '../../../uploads', photo.file_path));
      } catch {
        /* file already gone */
      }
    }
    return { success: true };
  }

  // ── Gallery (prefix /:id/gallery — before /:id) ─────────────────────────
  @Post(':id/gallery/photos')
  @UseInterceptors(FilesInterceptor('photos', undefined, IMAGE_UPLOAD))
  async uploadGalleryPhotos(
    @CurrentUser() user: User,
    @Param('id') id: string,
    @UploadedFiles() files: Express.Multer.File[] | undefined,
  ) {
    if (!files?.length) {
      throw new HttpException({ error: 'No files uploaded' }, 400);
    }
    const filePaths = files.map((f) => ({ path: `journey/${f.filename}` }));
    const photos = await this.journey.uploadGalleryPhotos(Number(id), user.id, filePaths);
    if (!photos.length) {
      throw new HttpException({ error: 'Not allowed' }, 403);
    }
    return { photos };
  }

  @Post(':id/gallery/provider-photos')
  async galleryProviderPhotos(
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Body() body: { provider?: string; asset_id?: string; asset_ids?: unknown[]; passphrase?: string },
  ) {
    const pp = body.passphrase && typeof body.passphrase === 'string' ? body.passphrase : undefined;
    if (Array.isArray(body.asset_ids) && body.provider) {
      const added: unknown[] = [];
      for (const aid of body.asset_ids) {
        const photo = await this.journey.addProviderPhotoToGallery(
          Number(id),
          user.id,
          body.provider,
          String(aid),
          undefined,
          pp,
        );
        if (photo) added.push(photo);
      }
      return { photos: added, added: added.length };
    }
    if (!body.provider || !body.asset_id) {
      throw new HttpException({ error: 'provider and asset_id required' }, 400);
    }
    const photo = await this.journey.addProviderPhotoToGallery(
      Number(id),
      user.id,
      body.provider,
      body.asset_id,
      undefined,
      pp,
    );
    if (!photo) {
      throw new HttpException({ error: 'Not allowed or duplicate' }, 403);
    }
    return photo;
  }

  @Delete(':id/gallery/:journeyPhotoId')
  @HttpCode(204)
  async deleteGalleryPhoto(@CurrentUser() user: User, @Param('journeyPhotoId') journeyPhotoId: string): Promise<void> {
    const photo = await this.journey.deleteGalleryPhoto(Number(journeyPhotoId), user.id);
    if (!photo) {
      throw new HttpException({ error: 'Photo not found or not allowed' }, 404);
    }
    if (photo.file_path) {
      try {
        fs.unlinkSync(path.join(__dirname, '../../../uploads', photo.file_path));
      } catch {
        /* file already gone */
      }
    }
  }

  // ── Journeys /:id ───────────────────────────────────────────────────────
  @Get(':id')
  async get(@CurrentUser() user: User, @Param('id') id: string) {
    const data = await this.journey.getJourneyFull(Number(id), user.id);
    if (!data) {
      throw new HttpException({ error: 'Journey not found' }, 404);
    }
    return data;
  }

  @Patch(':id')
  async update(@CurrentUser() user: User, @Param('id') id: string, @Body() body: Record<string, unknown>) {
    const result = await this.journey.updateJourney(Number(id), user.id, body);
    if (!result) {
      throw new HttpException({ error: 'Journey not found' }, 404);
    }
    return result;
  }

  @Post(':id/cover')
  @HttpCode(200) // Express answers cover with res.json (200).
  @UseInterceptors(FileInterceptor('cover', IMAGE_UPLOAD))
  async cover(
    @CurrentUser() user: User,
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File | undefined,
  ) {
    if (!file) {
      throw new HttpException({ error: 'No file uploaded' }, 400);
    }
    const result = await this.journey.updateJourney(Number(id), user.id, { cover_image: `journey/${file.filename}` });
    if (!result) {
      throw new HttpException({ error: 'Journey not found' }, 404);
    }
    return result;
  }

  @Delete(':id')
  async remove(@CurrentUser() user: User, @Param('id') id: string) {
    if (!(await this.journey.deleteJourney(Number(id), user.id))) {
      throw new HttpException({ error: 'Journey not found' }, 404);
    }
    return { success: true };
  }

  // ── Journey trips ───────────────────────────────────────────────────────
  @Post(':id/trips')
  @HttpCode(200) // Express answers with res.json (200).
  async addTrip(@CurrentUser() user: User, @Param('id') id: string, @Body() body: { trip_id?: unknown }) {
    if (!body.trip_id) {
      throw new HttpException({ error: 'trip_id required' }, 400);
    }
    if (!(await this.journey.addTripToJourney(Number(id), Number(body.trip_id), user.id))) {
      throw new HttpException({ error: 'Not allowed' }, 403);
    }
    return { success: true };
  }

  @Delete(':id/trips/:tripId')
  async removeTrip(@CurrentUser() user: User, @Param('id') id: string, @Param('tripId') tripId: string) {
    if (!(await this.journey.removeTripFromJourney(Number(id), Number(tripId), user.id))) {
      throw new HttpException({ error: 'Not allowed' }, 403);
    }
    return { success: true };
  }

  // ── Entries under journey ───────────────────────────────────────────────
  @Get(':id/entries')
  async listEntries(@CurrentUser() user: User, @Param('id') id: string) {
    const entries = await this.journey.listEntries(Number(id), user.id);
    if (!entries) {
      throw new HttpException({ error: 'Journey not found' }, 404);
    }
    return { entries };
  }

  @Post(':id/entries')
  async createEntry(
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Body() body: Record<string, unknown> & { entry_date?: unknown },
    @Headers('x-socket-id') socketId?: string,
  ) {
    if (!body.entry_date) {
      throw new HttpException({ error: 'entry_date is required' }, 400);
    }
    const entry = await this.journey.createEntry(Number(id), user.id, body, socketId);
    if (!entry) {
      throw new HttpException({ error: 'Journey not found' }, 404);
    }
    return entry;
  }

  @Put(':id/entries/reorder')
  async reorderEntries(
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Body() body: { orderedIds?: unknown },
    @Headers('x-socket-id') socketId?: string,
  ) {
    const orderedIds = body.orderedIds;
    if (!Array.isArray(orderedIds) || !orderedIds.every((v) => Number.isFinite(Number(v)))) {
      throw new HttpException({ error: 'orderedIds must be an array of numbers' }, 400);
    }
    if (!(await this.journey.reorderEntries(Number(id), user.id, orderedIds.map(Number), socketId))) {
      throw new HttpException({ error: 'Not allowed' }, 403);
    }
    return { success: true };
  }

  // ── Contributors ────────────────────────────────────────────────────────
  @Post(':id/contributors')
  async addContributor(
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Body() body: { user_id?: unknown; role?: 'editor' | 'viewer' },
  ) {
    if (!body.user_id) {
      throw new HttpException({ error: 'user_id required' }, 400);
    }
    if (!(await this.journey.addContributor(Number(id), user.id, Number(body.user_id), body.role || 'viewer'))) {
      throw new HttpException({ error: 'Not allowed' }, 403);
    }
    return { success: true };
  }

  @Patch(':id/contributors/:userId')
  async updateContributor(
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Param('userId') userId: string,
    @Body() body: { role?: 'editor' | 'viewer' },
  ) {
    if (
      !(await this.journey.updateContributorRole(Number(id), user.id, Number(userId), body.role as 'editor' | 'viewer'))
    ) {
      throw new HttpException({ error: 'Not allowed' }, 403);
    }
    return { success: true };
  }

  @Delete(':id/contributors/:userId')
  async removeContributor(@CurrentUser() user: User, @Param('id') id: string, @Param('userId') userId: string) {
    if (!(await this.journey.removeContributor(Number(id), user.id, Number(userId)))) {
      throw new HttpException({ error: 'Not allowed' }, 403);
    }
    return { success: true };
  }

  // ── User Preferences ────────────────────────────────────────────────────
  @Patch(':id/preferences')
  async preferences(@CurrentUser() user: User, @Param('id') id: string, @Body() body: Record<string, unknown>) {
    const result = await this.journey.updateJourneyPreferences(Number(id), user.id, body);
    if (!result) {
      throw new HttpException({ error: 'Not allowed' }, 403);
    }
    return result;
  }

  // ── Share Link ──────────────────────────────────────────────────────────
  @Get(':id/share-link')
  async getShareLink(@CurrentUser() user: User, @Param('id') id: string) {
    return { link: await this.journey.getJourneyShareLink(Number(id), user.id) };
  }

  @Post(':id/share-link')
  @HttpCode(200) // Express answers with res.json (200).
  async setShareLink(
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Body() body: { share_timeline?: boolean; share_gallery?: boolean; share_map?: boolean },
  ) {
    const result = await this.journey.createOrUpdateJourneyShareLink(Number(id), user.id, {
      share_timeline: body.share_timeline,
      share_gallery: body.share_gallery,
      share_map: body.share_map,
    });
    if (!result) {
      throw new HttpException({ error: 'Not allowed' }, 403);
    }
    return result;
  }

  @Delete(':id/share-link')
  async deleteShareLink(@CurrentUser() user: User, @Param('id') id: string) {
    if (!(await this.journey.deleteJourneyShareLink(Number(id), user.id))) {
      throw new HttpException({ error: 'Not allowed' }, 403);
    }
    return { success: true };
  }
}
