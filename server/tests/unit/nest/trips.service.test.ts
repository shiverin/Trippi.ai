import { TripsService } from '../../../src/nest/trips/trips.service';

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { asyncDbMock, asyncStmt, canAccessTripAsync } = vi.hoisted(() => {
  const stmt = {
    get: vi.fn(() => ({ id: 42 })),
    all: vi.fn(() => []),
    run: vi.fn(() => ({ changes: 1, lastInsertRowid: 42 })),
  };
  return {
    asyncDbMock: { prepare: vi.fn(() => stmt), transaction: vi.fn((fn) => fn) },
    asyncStmt: stmt,
    canAccessTripAsync: vi.fn(() => ({ user_id: 1 })),
  };
});
vi.mock('../../../src/db/asyncDatabase', () => ({ asyncDb: asyncDbMock, canAccessTripAsync }));

const { broadcast } = vi.hoisted(() => ({ broadcast: vi.fn() }));
vi.mock('../../../src/websocket', () => ({ broadcast }));
const { checkPermission } = vi.hoisted(() => ({ checkPermission: vi.fn(() => true) }));
vi.mock('../../../src/services/permissions', () => ({
  checkPermission,
  checkPermissionAsync: checkPermission,
}));

const { tripSvc } = vi.hoisted(() => ({
  tripSvc: {
    listTrips: vi.fn(),
    createTrip: vi.fn(),
    getTrip: vi.fn(),
    updateTrip: vi.fn(),
    deleteTrip: vi.fn(),
    getTripRaw: vi.fn(),
    getTripOwner: vi.fn(),
    deleteOldCover: vi.fn(),
    deleteOldCoverAsync: vi.fn(),
    updateCoverImage: vi.fn(),
    listMembers: vi.fn(() => ({ owner: { id: 1 }, members: [] })),
    addMember: vi.fn(),
    removeMember: vi.fn(),
    exportICS: vi.fn(),
	    copyTripById: vi.fn(),
	    TRIP_SELECT: 'SELECT * FROM trips t',
	    MAX_TRIP_DAYS: 365,
	    MS_PER_DAY: 86400000,
	  },
	}));
vi.mock('../../../src/services/tripService', () => tripSvc);
vi.mock('../../../src/services/dayService', () => ({ listDays: () => ({ days: [1] }), listAccommodations: () => [] }));
vi.mock('../../../src/services/placeService', () => ({ listPlaces: () => [], listPlacesAsync: () => [] }));
vi.mock('../../../src/services/packingService', () => ({ listItems: () => [] }));
vi.mock('../../../src/services/todoService', () => ({ listItems: () => [] }));
vi.mock('../../../src/services/budgetService', () => ({ listBudgetItems: () => [] }));
vi.mock('../../../src/services/reservationService', () => ({ listReservations: () => [] }));
vi.mock('../../../src/services/fileService', () => ({ listFiles: () => [], listFilesAsync: () => [] }));

function svc() {
  return new TripsService();
}
beforeEach(() => vi.clearAllMocks());

describe('TripsService (wrapper delegation + bundle/copy/notify helpers)', () => {
  it('delegates the simple wrappers to tripService', async () => {
    const s = svc();
    await s.list(1, 0);
    expect(asyncDbMock.prepare).toHaveBeenCalledWith(
      expect.stringContaining('WHERE (t.user_id = :userId OR m.user_id IS NOT NULL) AND t.is_archived = :archived'),
    );
    expect(asyncStmt.all).toHaveBeenCalledWith({ userId: 1, archived: 0 });
    await s.create(1, { title: 'T' } as never);
    expect(asyncDbMock.transaction).toHaveBeenCalled();
    expect(asyncDbMock.prepare).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO trips'));
    expect(asyncStmt.run).toHaveBeenCalledWith(1, 'T', null, null, null, 'EUR', 3);
    await s.get('9', 1);
    expect(asyncDbMock.prepare).toHaveBeenCalledWith(expect.stringContaining('WHERE t.id = :tripId'));
    await s.getRaw('9');
    expect(asyncDbMock.prepare).toHaveBeenCalledWith('SELECT * FROM trips WHERE id = ?');
    await s.getOwner('9');
    expect(asyncDbMock.prepare).toHaveBeenCalledWith('SELECT user_id FROM trips WHERE id = ?');
    await s.update('9', 1, { title: 'Updated' } as never, 'user');
    expect(asyncDbMock.prepare).toHaveBeenCalledWith(expect.stringContaining('UPDATE trips SET'));
    await s.remove('9', 1, 'user');
    expect(asyncDbMock.prepare).toHaveBeenCalledWith('DELETE FROM trips WHERE id = ?');
    await s.deleteOldCover('/old.jpg');
    expect(tripSvc.deleteOldCoverAsync).toHaveBeenCalledWith('/old.jpg');
    await s.updateCoverImage('9', '/n.jpg');
    expect(asyncDbMock.prepare).toHaveBeenCalledWith('UPDATE trips SET cover_image=?, updated_at=CURRENT_TIMESTAMP WHERE id=?');
    s.copy('9', 1, 'C');
    expect(tripSvc.copyTripById).toHaveBeenCalledWith('9', 1, 'C');
    await s.listMembers('9', 1);
    expect(asyncDbMock.prepare).toHaveBeenCalledWith(expect.stringContaining('SELECT u.id, u.username, u.email, u.avatar'));
    s.addMember('9', 'b@x.y', 1, 1);
    expect(tripSvc.addMember).toHaveBeenCalledWith('9', 'b@x.y', 1, 1);
    s.removeMember('9', 2);
    expect(tripSvc.removeMember).toHaveBeenCalledWith('9', 2);
    s.exportICS('9');
    expect(tripSvc.exportICS).toHaveBeenCalledWith('9');
  });

  it('canAccessTrip delegates to the async db helper', async () => {
    canAccessTripAsync.mockResolvedValueOnce({ user_id: 7 });
    await expect(svc().canAccessTrip('9', 7)).resolves.toEqual({ user_id: 7 });
    expect(canAccessTripAsync).toHaveBeenCalledWith('9', 7);
  });

  it('can() delegates to checkPermission; broadcast forwards', () => {
    svc().can('trip_edit', 'user', 1, 1, false);
    expect(checkPermission).toHaveBeenCalledWith('trip_edit', 'user', 1, 1, false);
    svc().broadcast('9', 'trip:updated', { a: 1 }, 'sock');
    expect(broadcast).toHaveBeenCalledWith('9', 'trip:updated', { a: 1 }, 'sock');
  });

  it('getCopiedTrip re-reads via the TRIP_SELECT query', async () => {
    await expect(svc().getCopiedTrip(42, 1)).resolves.toEqual({ id: 42 });
    expect(asyncDbMock.prepare).toHaveBeenCalledWith(expect.stringContaining('SELECT * FROM trips t'));
  });

  it('bundle aggregates every sub-collection + the member list', async () => {
    const result = await svc().bundle('9', { user_id: 1 });
    expect(result).toMatchObject({ trip: { user_id: 1 }, days: [1], places: [], members: [{ id: 42 }] });
  });

  it('bundle tolerates a null member list', async () => {
    asyncStmt.get.mockResolvedValueOnce(null);
    const result = await svc().bundle('9', { user_id: 1 });
    expect(result).toMatchObject({ members: [] });
  });

  it('notifyInvite is fire-and-forget (no throw)', () => {
    expect(() => svc().notifyInvite('9', { id: 1, email: 'a@b.c' } as never, 2, 'T', 'b@x.y')).not.toThrow();
  });
});
