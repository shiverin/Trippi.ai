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
    const fn =
      (svc as typeof svc & { createOrUpdateShareLinkAsync?: typeof svc.createOrUpdateShareLink })
        .createOrUpdateShareLinkAsync ?? svc.createOrUpdateShareLink;
    return fn(tripId, userId, permissions);
  }
  get(tripId: string) {
    const fn = (svc as typeof svc & { getShareLinkAsync?: typeof svc.getShareLink }).getShareLinkAsync ?? svc.getShareLink;
    return fn(tripId);
  }
  remove(tripId: string) {
    const fn =
      (svc as typeof svc & { deleteShareLinkAsync?: typeof svc.deleteShareLink }).deleteShareLinkAsync ??
      svc.deleteShareLink;
    return fn(tripId);
  }
  getSharedTripData(token: string) {
    const fn =
      (svc as typeof svc & { getSharedTripDataAsync?: typeof svc.getSharedTripData }).getSharedTripDataAsync ??
      svc.getSharedTripData;
    return fn(token);
  }
  getSharedPlacePhotoPath(token: string, placeId: string) {
    const fn =
      (svc as typeof svc & { getSharedPlacePhotoPathAsync?: typeof svc.getSharedPlacePhotoPath })
        .getSharedPlacePhotoPathAsync ?? svc.getSharedPlacePhotoPath;
    return fn(token, placeId);
  }
}
