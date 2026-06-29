import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the data + side-effect dependencies the service reaches into directly.
const { asyncDbMock } = vi.hoisted(() => {
  const stmt = { get: vi.fn() };
  return { asyncDbMock: { prepare: vi.fn(() => stmt), _stmt: stmt } };
});
vi.mock('../../../src/db/asyncDatabase', () => ({ asyncDb: asyncDbMock }));

const { resolveDbProvider } = vi.hoisted(() => ({ resolveDbProvider: vi.fn(() => 'oracle-async') }));
vi.mock('../../../src/db/providerMode', () => ({ resolveDbProvider }));

const { broadcast } = vi.hoisted(() => ({ broadcast: vi.fn() }));
vi.mock('../../../src/websocket', () => ({ broadcast }));

const { checkPermissionAsync } = vi.hoisted(() => ({ checkPermissionAsync: vi.fn().mockResolvedValue(true) }));
vi.mock('../../../src/services/permissions', () => ({ checkPermissionAsync }));

const { resv } = vi.hoisted(() => ({
  resv: {
    verifyTripAccess: vi.fn(), listReservations: vi.fn(), createReservation: vi.fn(), updatePositions: vi.fn(),
    getReservation: vi.fn(), updateReservation: vi.fn(), deleteReservation: vi.fn(),
    getUpcomingReservations: vi.fn(), getLinkedReservationBudgetItem: vi.fn(), createLinkedBudgetItemForReservation: vi.fn(),
    updateReservationBudgetItem: vi.fn(), deleteReservationBudgetItem: vi.fn(),
  },
}));
vi.mock('../../../src/services/reservationService', () => resv);

import { ReservationsService } from '../../../src/nest/reservations/reservations.service';

function svc() {
  return new ReservationsService();
}

beforeEach(() => {
  vi.clearAllMocks();
  checkPermissionAsync.mockResolvedValue(true);
  resolveDbProvider.mockReturnValue('oracle-async');
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('ReservationsService', () => {
  it('canEdit delegates to checkPermission with reservation_edit', async () => {
    await expect(svc().canEdit({ user_id: 2 } as never, { id: 1, role: 'user' } as never)).resolves.toBe(true);
    expect(checkPermissionAsync).toHaveBeenCalledWith('reservation_edit', 'user', 2, 1, true);
  });

  it('list/create/getReservation/remove delegate to the legacy service', async () => {
    resv.listReservations.mockResolvedValue([{ id: 1 }]);
    await expect(svc().list('5')).resolves.toEqual([{ id: 1 }]);
    await svc().create('5', { title: 'X' } as never);
    expect(resv.createReservation).toHaveBeenCalledWith('5', { title: 'X' });
    await svc().getReservation('9', '5');
    expect(resv.getReservation).toHaveBeenCalledWith('9', '5');
    await svc().remove('9', '5');
    expect(resv.deleteReservation).toHaveBeenCalledWith('9', '5');
  });

  describe('syncBudgetOnCreate', () => {
    it('does nothing without a positive price', async () => {
      await svc().syncBudgetOnCreate('5', 9, 'Hotel', 'lodging', undefined, 'sock');
      await svc().syncBudgetOnCreate('5', 9, 'Hotel', 'lodging', { total_price: 0 }, 'sock');
      expect(resv.createLinkedBudgetItemForReservation).not.toHaveBeenCalled();
    });

    it('links a budget item and broadcasts budget:created', async () => {
      resv.createLinkedBudgetItemForReservation.mockResolvedValue({ id: 7 });
      await svc().syncBudgetOnCreate('5', 9, 'Hotel', 'lodging', { total_price: 200, category: 'Lodging' }, 'sock');
      expect(resv.createLinkedBudgetItemForReservation).toHaveBeenCalledWith('5', 9, { name: 'Hotel', category: 'Lodging', total_price: 200 });
      expect(broadcast).toHaveBeenCalledWith('5', 'budget:created', { item: { id: 7 } }, 'sock');
    });

    it('falls back to type then "Other" for the category and swallows errors', async () => {
      resv.createLinkedBudgetItemForReservation.mockRejectedValue(new Error('boom'));
      await expect(svc().syncBudgetOnCreate('5', 9, 'Hotel', undefined, { total_price: 50 }, 'sock')).resolves.toBeUndefined();
      expect(resv.createLinkedBudgetItemForReservation).toHaveBeenCalledWith('5', 9, { name: 'Hotel', category: 'Other', total_price: 50 });
    });
  });

  describe('syncBudgetOnUpdate', () => {
    it('deletes the linked item when the price is explicitly cleared (total_price 0)', async () => {
      resv.getLinkedReservationBudgetItem.mockResolvedValueOnce({ id: 7 });
      await svc().syncBudgetOnUpdate('5', '9', 'Hotel', 'lodging', 'Hotel', 'lodging', { total_price: 0 }, 'sock');
      expect(resv.deleteReservationBudgetItem).toHaveBeenCalledWith(7, '5');
      expect(broadcast).toHaveBeenCalledWith('5', 'budget:deleted', { itemId: 7 }, 'sock');
    });

    it('leaves the linked item alone when no budget entry is on the payload (no wipe)', async () => {
      await svc().syncBudgetOnUpdate('5', '9', 'Hotel', 'lodging', 'Hotel', 'lodging', undefined, 'sock');
      expect(resv.deleteReservationBudgetItem).not.toHaveBeenCalled();
      expect(resv.updateReservationBudgetItem).not.toHaveBeenCalled();
      expect(resv.createLinkedBudgetItemForReservation).not.toHaveBeenCalled();
    });

    it('syncs the linked expense category when the booking type changes', async () => {
      resv.getLinkedReservationBudgetItem.mockResolvedValueOnce({ id: 7, category: 'other' });
      resv.updateReservationBudgetItem.mockResolvedValue({ id: 7, category: 'flights' });
      await svc().syncBudgetOnUpdate('5', '9', 'X', 'flight', 'X', 'other', undefined, 'sock');
      expect(resv.updateReservationBudgetItem).toHaveBeenCalledWith(7, '5', { category: 'flights' });
      expect(broadcast).toHaveBeenCalledWith('5', 'budget:updated', { item: { id: 7, category: 'flights' } }, 'sock');
    });

    it('updates an existing linked item when a price is provided', async () => {
      resv.getLinkedReservationBudgetItem.mockResolvedValueOnce({ id: 7 }); // existing lookup
      resv.updateReservationBudgetItem.mockResolvedValue({ id: 7 });
      await svc().syncBudgetOnUpdate('5', '9', 'New', 'lodging', 'Old', 'lodging', { total_price: 80 }, 'sock');
      expect(resv.updateReservationBudgetItem).toHaveBeenCalledWith(7, '5', { name: 'New', category: 'lodging', total_price: 80 });
      expect(broadcast).toHaveBeenCalledWith('5', 'budget:updated', { item: { id: 7 } }, 'sock');
    });

    it('creates + links a new item when none exists, using the current title fallback', async () => {
      resv.getLinkedReservationBudgetItem.mockResolvedValueOnce(undefined); // no existing
      resv.createLinkedBudgetItemForReservation.mockResolvedValue({ id: 9, reservation_id: 9 });
      await svc().syncBudgetOnUpdate('5', '9', '', undefined, 'Old title', 'flight', { total_price: 120 }, 'sock');
      expect(resv.createLinkedBudgetItemForReservation).toHaveBeenCalledWith('5', 9, { name: 'Old title', category: 'flight', total_price: 120 });
      expect(broadcast).toHaveBeenCalledWith('5', 'budget:created', { item: { id: 9, reservation_id: 9 } }, 'sock');
    });
  });

  it('notifyBookingChange resolves without throwing (fire-and-forget)', () => {
    expect(() => svc().notifyBookingChange('5', { id: 1, email: 'a@b.c' } as never, 'Hotel', 'lodging')).not.toThrow();
    expect(resolveDbProvider).toHaveBeenCalled();
    expect(asyncDbMock.prepare).not.toHaveBeenCalled();
  });
});
