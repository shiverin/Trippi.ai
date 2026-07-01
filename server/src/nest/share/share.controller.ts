import type { User } from '../../types';
import { isContentSafetyError } from '../../services/contentSafetyService';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ShareService } from './share.service';
import { Body, Controller, Delete, Get, HttpException, Param, Post, Res, UseGuards } from '@nestjs/common';

import type { Response } from 'express';
import { createReadStream } from 'node:fs';

/**
 * /api/trips/:tripId/share-link — manage a trip's public read-only share token.
 *
 * Byte-identical to the legacy Express route (server/src/routes/share.ts): trip
 * access (404), the 'share_manage' permission (403), and the create-vs-update
 * status split (201 on first creation, 200 on a subsequent update).
 */
@Controller('api/trips/:tripId/share-link')
@UseGuards(JwtAuthGuard)
export class TripShareController {
  constructor(private readonly share: ShareService) {}

  private async requireManage(tripId: string, user: User): Promise<void> {
    const trip = await this.share.verifyTripAccess(tripId, user.id);
    if (!trip) {
      throw new HttpException({ error: 'Trip not found' }, 404);
    }
    if (!this.share.canManage(trip, user)) {
      throw new HttpException({ error: 'No permission' }, 403);
    }
  }

  @Post()
  async create(
    @CurrentUser() user: User,
    @Param('tripId') tripId: string,
    @Body()
    body: {
      share_map?: boolean;
      share_bookings?: boolean;
      share_packing?: boolean;
      share_budget?: boolean;
      share_collab?: boolean;
      profile_visible?: boolean;
    },
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.requireManage(tripId, user);
    let result: Awaited<ReturnType<ShareService['createOrUpdate']>>;
    try {
      result = await this.share.createOrUpdate(tripId, user.id, {
        share_map: body.share_map,
        share_bookings: body.share_bookings,
        share_packing: body.share_packing,
        share_budget: body.share_budget,
        share_collab: body.share_collab,
        profile_visible: body.profile_visible,
      });
    } catch (err) {
      if (isContentSafetyError(err)) {
        throw new HttpException({ error: err.message, code: err.code, issues: err.issues }, err.status);
      }
      throw err;
    }
    // 201 only on first creation; an update answers 200, mirroring the legacy route.
    res.status(result.created ? 201 : 200);
    return { token: result.token };
  }

  @Get()
  async get(@CurrentUser() user: User, @Param('tripId') tripId: string) {
    if (!(await this.share.verifyTripAccess(tripId, user.id))) {
      throw new HttpException({ error: 'Trip not found' }, 404);
    }
    const info = await this.share.get(tripId);
    return info ? info : { token: null };
  }

  @Delete()
  async remove(@CurrentUser() user: User, @Param('tripId') tripId: string) {
    await this.requireManage(tripId, user);
    await this.share.remove(tripId);
    return { success: true };
  }
}

/**
 * GET /api/shared/:token — public, unauthenticated read-only trip snapshot.
 * Deliberately NOT behind a guard; an invalid/expired token answers 404.
 */
@Controller('api/shared')
export class SharedController {
  constructor(private readonly share: ShareService) {}

  /**
   * Public, token-scoped place-photo proxy. The shared payload rewrites place
   * image URLs to this route so thumbnails load without a session cookie (the
   * /api/maps bytes endpoint is JwtAuthGuard'd). The service validates the token
   * and that the place belongs to its trip; a miss streams nothing and answers
   * 404. Declared before the bare ':token' read route. Streaming mirrors
   * MapsController.placePhotoBytes (cached photos are always JPEG).
   */
  @Get(':token/place-photo/:placeId/bytes')
  async placePhotoBytes(
    @Param('token') token: string,
    @Param('placeId') placeId: string,
    @Res() res: Response,
  ): Promise<void> {
    const fp = await this.share.getSharedPlacePhotoPath(token, placeId);
    if (!fp) {
      res.status(404).json({ error: 'Photo not cached' });
      return;
    }
    res.set('Cache-Control', 'public, max-age=2592000, immutable');
    res.type('image/jpeg');
    const stream = createReadStream(fp);
    stream.on('error', () => {
      if (!res.headersSent) res.status(404).json({ error: 'Photo not cached' });
    });
    stream.pipe(res);
  }

  @Get(':token')
  async read(@Param('token') token: string) {
    const data = await this.share.getSharedTripData(token);
    if (!data) {
      throw new HttpException({ error: 'Invalid or expired link' }, 404);
    }
    return data;
  }
}
