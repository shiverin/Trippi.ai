import { describe, it, expect, vi } from 'vitest';
import { HttpException } from '@nestjs/common';
import { ReservationsController } from '../../../src/nest/reservations/reservations.controller';
import type { ReservationsService } from '../../../src/nest/reservations/reservations.service';
import type { User } from '../../../src/types';

const user = { id: 1, role: 'user', email: 'u@example.test' } as User;
const trip = { id: 5, user_id: 1 };

function makeService(overrides: Partial<ReservationsService> = {}): ReservationsService {
  return {
    verifyTripAccess: vi.fn().mockReturnValue(trip),
    canEdit: vi.fn().mockReturnValue(true),
    broadcast: vi.fn(),
    syncBudgetOnCreate: vi.fn(),
    syncBudgetOnUpdate: vi.fn(),
    notifyBookingChange: vi.fn(),
    ...overrides,
  } as unknown as ReservationsService;
}

async function thrown(fn: () => unknown | Promise<unknown>): Promise<{ status: number; body: unknown }> {
  try {
    await fn();
  } catch (err) {
    expect(err).toBeInstanceOf(HttpException);
    const e = err as HttpException;
    return { status: e.getStatus(), body: e.getResponse() };
  }
  throw new Error('expected throw');
}

describe('ReservationsController (parity with the legacy /api/trips/:tripId/reservations route)', () => {
  it('404 when trip not accessible', async () => {
    const svc = makeService({ verifyTripAccess: vi.fn().mockReturnValue(undefined) });
    expect(await thrown(() => new ReservationsController(svc).list(user, '5'))).toEqual({ status: 404, body: { error: 'Trip not found' } });
  });

  it('GET / returns reservations', async () => {
    const svc = makeService({ list: vi.fn().mockReturnValue([{ id: 1 }]) } as Partial<ReservationsService>);
    expect(await new ReservationsController(svc).list(user, '5')).toEqual({ reservations: [{ id: 1 }] });
  });

  describe('POST /', () => {
    it('403 without permission', async () => {
      const svc = makeService({ canEdit: vi.fn().mockReturnValue(false) });
      expect(await thrown(() => new ReservationsController(svc).create(user, '5', { title: 'Hotel' }))).toEqual({ status: 403, body: { error: 'No permission' } });
    });

    it('400 without a title', async () => {
      expect(await thrown(() => new ReservationsController(makeService()).create(user, '5', {}))).toEqual({ status: 400, body: { error: 'Title is required' } });
    });

    it('creates, runs budget sync, broadcasts accommodation + reservation, notifies', async () => {
      const create = vi.fn().mockReturnValue({ reservation: { id: 9 }, accommodationCreated: true });
      const broadcast = vi.fn(); const syncBudgetOnCreate = vi.fn(); const notifyBookingChange = vi.fn();
      const svc = makeService({ create, broadcast, syncBudgetOnCreate, notifyBookingChange } as Partial<ReservationsService>);
      const body = { title: 'Hotel', type: 'lodging', create_budget_entry: { total_price: 200 } };
      expect(await new ReservationsController(svc).create(user, '5', body, 'sock')).toEqual({ reservation: { id: 9 } });
      expect(broadcast).toHaveBeenCalledWith('5', 'accommodation:created', {}, 'sock');
      expect(syncBudgetOnCreate).toHaveBeenCalledWith('5', 9, 'Hotel', 'lodging', { total_price: 200 }, 'sock');
      expect(broadcast).toHaveBeenCalledWith('5', 'reservation:created', { reservation: { id: 9 } }, 'sock');
      expect(notifyBookingChange).toHaveBeenCalledWith('5', user, 'Hotel', 'lodging');
    });
  });

  describe('PUT /positions', () => {
    it('400 when positions is not an array', async () => {
      expect(await thrown(() => new ReservationsController(makeService()).updatePositions(user, '5', { positions: 'no' }))).toEqual({ status: 400, body: { error: 'positions must be an array' } });
    });

    it('updates positions and broadcasts', async () => {
      const updatePositions = vi.fn(); const broadcast = vi.fn();
      const svc = makeService({ updatePositions, broadcast } as Partial<ReservationsService>);
      const positions = [{ id: 1, day_plan_position: 0 }];
      expect(await new ReservationsController(svc).updatePositions(user, '5', { positions, day_id: 3 }, 'sock')).toEqual({ success: true });
      expect(updatePositions).toHaveBeenCalledWith('5', positions, 3);
      expect(broadcast).toHaveBeenCalledWith('5', 'reservation:positions', { positions, day_id: 3 }, 'sock');
    });
  });

  describe('PUT /:id', () => {
    it('404 when the reservation is missing', async () => {
      const svc = makeService({ getReservation: vi.fn().mockReturnValue(undefined) } as Partial<ReservationsService>);
      expect(await thrown(() => new ReservationsController(svc).update(user, '5', '9', { title: 'X' }))).toEqual({ status: 404, body: { error: 'Reservation not found' } });
    });

    it('updates, syncs budget with current fallbacks, broadcasts + notifies', async () => {
      const getReservation = vi.fn().mockReturnValue({ title: 'Old', type: 'lodging' });
      const update = vi.fn().mockReturnValue({ reservation: { id: 9 }, accommodationChanged: true });
      const broadcast = vi.fn(); const syncBudgetOnUpdate = vi.fn(); const notifyBookingChange = vi.fn();
      const svc = makeService({ getReservation, update, broadcast, syncBudgetOnUpdate, notifyBookingChange } as Partial<ReservationsService>);
      await new ReservationsController(svc).update(user, '5', '9', { create_budget_entry: { total_price: 50 } }, 'sock');
      expect(broadcast).toHaveBeenCalledWith('5', 'accommodation:updated', {}, 'sock');
      expect(syncBudgetOnUpdate).toHaveBeenCalledWith('5', '9', '', undefined, 'Old', 'lodging', { total_price: 50 }, 'sock');
      expect(notifyBookingChange).toHaveBeenCalledWith('5', user, 'Old', 'lodging');
    });
  });

  describe('DELETE /:id', () => {
    it('404 when nothing deleted', async () => {
      const svc = makeService({ remove: vi.fn().mockReturnValue({ deleted: undefined, accommodationDeleted: false, deletedBudgetItemId: null }) } as Partial<ReservationsService>);
      expect(await thrown(() => new ReservationsController(svc).remove(user, '5', '9'))).toEqual({ status: 404, body: { error: 'Reservation not found' } });
    });

    it('broadcasts the accommodation + budget cascade then reservation:deleted', async () => {
      const remove = vi.fn().mockReturnValue({ deleted: { id: 9, title: 'Hotel', type: 'lodging', accommodation_id: 3 }, accommodationDeleted: true, deletedBudgetItemId: 7 });
      const broadcast = vi.fn(); const notifyBookingChange = vi.fn();
      const svc = makeService({ remove, broadcast, notifyBookingChange } as Partial<ReservationsService>);
      expect(await new ReservationsController(svc).remove(user, '5', '9', 'sock')).toEqual({ success: true });
      expect(broadcast).toHaveBeenCalledWith('5', 'accommodation:deleted', { accommodationId: 3 }, 'sock');
      expect(broadcast).toHaveBeenCalledWith('5', 'budget:deleted', { itemId: 7 }, 'sock');
      expect(broadcast).toHaveBeenCalledWith('5', 'reservation:deleted', { reservationId: 9 }, 'sock');
    });
  });
});
