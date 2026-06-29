import { asyncDb } from '../../db/asyncDatabase';
import { resolveDbProvider } from '../../db/providerMode';
import { checkPermissionAsync } from '../../services/permissions';
import * as svc from '../../services/reservationService';
import type { User } from '../../types';
import { broadcast } from '../../websocket';
import { Injectable } from '@nestjs/common';
import { typeToCostCategory } from '@trippi/shared';

type Trip = NonNullable<Awaited<ReturnType<typeof svc.verifyTripAccess>>>;
type BudgetEntry = { total_price?: number; category?: string } | undefined;

/**
 * Thin Nest wrapper around the existing reservation service. Trip-access, the
 * 'reservation_edit' permission, the SQL and the WebSocket broadcasts reuse the
 * legacy code unchanged. The legacy route's budget side effects (auto-create /
 * update / delete a linked budget item) and the booking notification are
 * encapsulated here so the controller stays thin — behaviour is 1:1.
 */
@Injectable()
export class ReservationsService {
  async verifyTripAccess(tripId: string, userId: number) {
    return await svc.verifyTripAccess(tripId, userId);
  }

  async canEdit(trip: Trip, user: User): Promise<boolean> {
    return checkPermissionAsync('reservation_edit', user.role, trip.user_id, user.id, trip.user_id !== user.id);
  }

  broadcast(tripId: string, event: string, payload: Record<string, unknown>, socketId: string | undefined): void {
    broadcast(tripId, event, payload, socketId);
  }

  async list(tripId: string) {
    return await svc.listReservations(tripId);
  }

  // Cross-trip "upcoming reservations" feed (dashboard widget). Reuses the legacy
  // query unchanged; the default limit (6) matches the legacy inline handler.
  async listUpcoming(userId: number) {
    return await svc.getUpcomingReservations(userId);
  }

  async create(tripId: string, data: Parameters<typeof svc.createReservation>[1]) {
    return await svc.createReservation(tripId, data);
  }

  async updatePositions(tripId: string, positions: Parameters<typeof svc.updatePositions>[1], dayId: unknown) {
    await svc.updatePositions(tripId, positions, dayId as Parameters<typeof svc.updatePositions>[2]);
  }

  async getReservation(id: string, tripId: string) {
    return await svc.getReservation(id, tripId);
  }

  async update(
    id: string,
    tripId: string,
    data: Parameters<typeof svc.updateReservation>[2],
    current: Parameters<typeof svc.updateReservation>[3],
  ) {
    return await svc.updateReservation(id, tripId, data, current);
  }

  async remove(id: string, tripId: string) {
    return await svc.deleteReservation(id, tripId);
  }

  /** POST side effect: auto-create a linked budget item when a price is provided. */
  async syncBudgetOnCreate(
    tripId: string,
    reservationId: number,
    title: string,
    type: string | undefined,
    entry: BudgetEntry,
    socketId: string | undefined,
  ): Promise<void> {
    if (!entry || !(Number(entry.total_price) > 0)) return;
    try {
      const item = await svc.createLinkedBudgetItemForReservation(tripId, reservationId, {
        name: title,
        category: entry.category || type || 'Other',
        total_price: Number(entry.total_price),
      });
      broadcast(tripId, 'budget:created', { item }, socketId);
    } catch (err) {
      console.error('[reservations] Failed to create budget entry:', err);
    }
  }

  /** PUT side effect: drop the linked budget item when the price is cleared, else create/update it. */
  async syncBudgetOnUpdate(
    tripId: string,
    id: string,
    title: string,
    type: string | undefined,
    currentTitle: string,
    currentType: string | undefined,
    entry: BudgetEntry,
    socketId: string | undefined,
  ): Promise<void> {
    // When the booking type changes, keep a linked expense's category in sync —
    // but only if it still carries the auto-derived category (so a manual pick in
    // the Costs editor is preserved). Runs regardless of create_budget_entry.
    if (type && currentType && type !== currentType) {
      const linked = await svc.getLinkedReservationBudgetItem(tripId, id);
      if (linked) {
        const oldCat = typeToCostCategory(currentType);
        const newCat = typeToCostCategory(type);
        if (oldCat !== newCat && linked.category === oldCat) {
          const updated = await svc.updateReservationBudgetItem(linked.id, tripId, { category: newCat });
          broadcast(tripId, 'budget:updated', { item: updated }, socketId);
        }
      }
    }

    // No budget entry on the payload — the booking edit isn't touching its linked
    // expense, so leave any linked item alone. Expenses are managed from the
    // booking's Costs section / the Costs tab, not by re-saving the booking.
    if (!entry) return;

    if (!(Number(entry.total_price) > 0)) {
      // Explicit clear (total_price 0/empty) — drop the linked item.
      const linked = await svc.getLinkedReservationBudgetItem(tripId, id);
      if (linked) {
        await svc.deleteReservationBudgetItem(linked.id, tripId);
        broadcast(tripId, 'budget:deleted', { itemId: linked.id }, socketId);
      }
      return;
    }

    try {
      const itemName = title || currentTitle;
      const category = entry.category || type || currentType || 'Other';
      const existing = await svc.getLinkedReservationBudgetItem(tripId, id);
      if (existing) {
        const updated = await svc.updateReservationBudgetItem(existing.id, tripId, {
          name: itemName,
          category,
          total_price: Number(entry.total_price),
        });
        broadcast(tripId, 'budget:updated', { item: updated }, socketId);
      } else {
        const item = await svc.createLinkedBudgetItemForReservation(tripId, Number(id), {
          name: itemName,
          category,
          total_price: Number(entry.total_price),
        });
        broadcast(tripId, 'budget:created', { item }, socketId);
      }
    } catch (err) {
      console.error('[reservations] Failed to create/update budget entry:', err);
    }
  }

  /** Fire-and-forget booking-change notification, mirroring the legacy dynamic import. */
  notifyBookingChange(tripId: string, actor: User, booking: string, type: string): void {
    if (resolveDbProvider() === 'oracle-async') return;
    void import('../../services/notificationService')
      .then(async ({ send }) => {
        const tripInfo = await asyncDb.prepare('SELECT title FROM trips WHERE id = ?').get<{ title: string }>(tripId);
        send({
          event: 'booking_change',
          actorId: actor.id,
          scope: 'trip',
          targetId: Number(tripId),
          params: {
            trip: tripInfo?.title || 'Untitled',
            actor: actor.email,
            booking,
            type: type || 'booking',
            tripId: String(tripId),
          },
        }).catch(() => {});
      })
      .catch(() => {});
  }
}
