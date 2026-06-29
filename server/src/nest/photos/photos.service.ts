import { canAccessTrippiPhotoAsync } from '../../services/memories/helpersService';
import { streamPhotoAsync, getPhotoInfoAsync } from '../../services/memories/photoResolverService';
import { Injectable } from '@nestjs/common';

import type { Response } from 'express';

/**
 * Thin Nest wrapper around the async photo resolver/helper request paths.
 * Access control, streaming and provider-specific info lookups stay in the
 * shared services.
 */
@Injectable()
export class PhotosService {
  canAccess(userId: number, photoId: number): Promise<boolean> {
    return canAccessTrippiPhotoAsync(userId, photoId);
  }

  stream(res: Response, userId: number, photoId: number, kind: 'thumbnail' | 'original') {
    return streamPhotoAsync(res, userId, photoId, kind);
  }

  info(userId: number, photoId: number) {
    return getPhotoInfoAsync(userId, photoId);
  }
}
