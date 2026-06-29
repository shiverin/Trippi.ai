import { canAccessTripAsync } from '../../db/asyncDatabase';
import { checkPermission } from '../../services/permissions';
import * as svc from '../../services/shareService';
import type { User } from '../../types';
import { Injectable } from '@nestjs/common';

type Trip = NonNullable<Awaited<ReturnType<typeof canAccessTripAsync>>>;

/**
 * Thin Nest wrapper around the existing share service. Trip access, the
 * 'share_manage' permission and the token SQL reuse the legacy code unchanged.
 */
@Injectable()
export class ShareService {
  async verifyTripAccess(tripId: string, userId: number): Promise<Trip | undefined> {
    return canAccessTripAsync(tripId, userId);
  }

  canManage(trip: Trip, user: User): boolean {
    return checkPermission('share_manage', user.role, trip.user_id, user.id, trip.user_id !== user.id);
  }

  createOrUpdate(tripId: string, userId: number, permissions: Parameters<typeof svc.createOrUpdateShareLink>[2]) {
    return svc.createOrUpdateShareLink(tripId, userId, permissions);
  }
  get(tripId: string) {
    return svc.getShareLink(tripId);
  }
  remove(tripId: string) {
    return svc.deleteShareLink(tripId);
  }
  getSharedTripData(token: string) {
    return svc.getSharedTripData(token);
  }
  getSharedPlacePhotoPath(token: string, placeId: string) {
    return svc.getSharedPlacePhotoPath(token, placeId);
  }
}
