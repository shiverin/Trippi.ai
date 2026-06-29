import { describe, it, expect, vi, beforeEach } from 'vitest';

// The wrapper delegates to shared helpers; mock them so no real DB is loaded.
const { canAccessTripAsync } = vi.hoisted(() => ({ canAccessTripAsync: vi.fn() }));
vi.mock('../../../src/db/asyncDatabase', () => ({ canAccessTripAsync }));

const { checkPermission } = vi.hoisted(() => ({ checkPermission: vi.fn() }));
vi.mock('../../../src/services/permissions', () => ({ checkPermission }));

const { share } = vi.hoisted(() => ({
  share: {
    createOrUpdateShareLink: vi.fn(),
    createOrUpdateShareLinkAsync: vi.fn(),
    getShareLink: vi.fn(),
    getShareLinkAsync: vi.fn(),
    deleteShareLink: vi.fn(),
    deleteShareLinkAsync: vi.fn(),
    getSharedTripData: vi.fn(),
    getSharedTripDataAsync: vi.fn(),
    getSharedPlacePhotoPath: vi.fn(),
    getSharedPlacePhotoPathAsync: vi.fn(),
  },
}));
vi.mock('../../../src/services/shareService', () => share);

import { ShareService } from '../../../src/nest/share/share.service';
import type { User } from '../../../src/types';

function svc() {
  return new ShareService();
}

beforeEach(() => vi.clearAllMocks());

describe('ShareService', () => {
  it('verifyTripAccess delegates to canAccessTripAsync', async () => {
    canAccessTripAsync.mockResolvedValue({ id: 5, user_id: 2 });
    await expect(svc().verifyTripAccess('5', 2)).resolves.toEqual({ id: 5, user_id: 2 });
    expect(canAccessTripAsync).toHaveBeenCalledWith('5', 2);
  });

  it('canManage forwards the ownership flag when the user owns the trip', () => {
    checkPermission.mockReturnValue(true);
    const trip = { user_id: 1 } as never;
    const user = { id: 1, role: 'user' } as User;
    expect(svc().canManage(trip, user)).toBe(true);
    expect(checkPermission).toHaveBeenCalledWith('share_manage', 'user', 1, 1, false);
  });

  it('canManage marks the user as a guest when they do not own the trip', () => {
    checkPermission.mockReturnValue(false);
    const trip = { user_id: 2 } as never;
    const user = { id: 1, role: 'user' } as User;
    expect(svc().canManage(trip, user)).toBe(false);
    expect(checkPermission).toHaveBeenCalledWith('share_manage', 'user', 2, 1, true);
  });

  it('createOrUpdate delegates to the legacy share service', () => {
    share.createOrUpdateShareLinkAsync.mockReturnValue({ token: 't', created: true });
    const perms = { share_map: true };
    expect(svc().createOrUpdate('5', 2, perms)).toEqual({ token: 't', created: true });
    expect(share.createOrUpdateShareLinkAsync).toHaveBeenCalledWith('5', 2, perms);
  });

  it('get / remove / getSharedTripData / getSharedPlacePhotoPath delegate', () => {
    share.getShareLinkAsync.mockReturnValue({ token: 't' });
    expect(svc().get('5')).toEqual({ token: 't' });
    expect(share.getShareLinkAsync).toHaveBeenCalledWith('5');

    svc().remove('5');
    expect(share.deleteShareLinkAsync).toHaveBeenCalledWith('5');

    share.getSharedTripDataAsync.mockReturnValue({ trip: { id: 9 } });
    expect(svc().getSharedTripData('tok')).toEqual({ trip: { id: 9 } });
    expect(share.getSharedTripDataAsync).toHaveBeenCalledWith('tok');

    share.getSharedPlacePhotoPathAsync.mockReturnValue('/cache/p1.jpg');
    expect(svc().getSharedPlacePhotoPath('tok', 'p1')).toBe('/cache/p1.jpg');
    expect(share.getSharedPlacePhotoPathAsync).toHaveBeenCalledWith('tok', 'p1');
  });
});
