import { asyncDb } from '../../db/asyncDatabase';
import * as svc from '../../services/budgetService';
import { getRates } from '../../services/exchangeRateService';
import { checkPermission } from '../../services/permissions';
import type { User } from '../../types';
import { broadcast } from '../../websocket';
import { Injectable } from '@nestjs/common';

type Trip = NonNullable<Awaited<ReturnType<typeof svc.verifyTripAccess>>>;

/**
 * Thin Nest wrapper around the existing budget service. Trip-access, the
 * 'budget_edit' permission, the SQL, settlement maths and the WebSocket
 * broadcasts all reuse the legacy code unchanged.
 */
@Injectable()
export class BudgetService {
  verifyTripAccess(tripId: string, userId: number) {
    return svc.verifyTripAccess(tripId, userId);
  }

  canEdit(trip: Trip, user: User): boolean {
    return checkPermission('budget_edit', user.role, trip.user_id, user.id, trip.user_id !== user.id);
  }

  broadcast(tripId: string, event: string, payload: Record<string, unknown>, socketId: string | undefined): void {
    broadcast(tripId, event, payload, socketId);
  }

  list(tripId: string) {
    return svc.listBudgetItems(tripId);
  }

  perPersonSummary(tripId: string) {
    return svc.getPerPersonSummary(tripId);
  }

  async settlement(tripId: string, base: string | undefined, tripCurrency: string) {
    const effectiveBase = (base || tripCurrency || 'EUR').toUpperCase();
    const rates = await getRates(effectiveBase);
    return svc.calculateSettlement(tripId, { base: effectiveBase, rates, tripCurrency });
  }

  // Freeze the live FX rate at entry time into budget_items.exchange_rate so a settled
  // position isn't re-opened when live rates drift later (#1335). Only for a foreign
  // currency with no explicit rate; degrades to live rates if the fetch fails. On update
  // it (re)freezes only when the currency changes, so an unrelated edit never moves money.
  private async freezeForeignRate(
    tripId: string,
    data: { currency?: string | null; exchange_rate?: number },
    existingItemId?: string,
  ): Promise<void> {
    if (data.exchange_rate != null) return; // an explicit rate from the caller wins
    const cur = (data.currency || '').toUpperCase();
    if (!cur) return; // currency not being set in this request
    if (existingItemId != null) {
      const existing = await asyncDb
        .prepare('SELECT currency FROM budget_items WHERE id = ?')
        .get<{ currency?: string }>(existingItemId);
      if (existing && (existing.currency || '').toUpperCase() === cur) return; // currency unchanged
    }
    const trip = await asyncDb.prepare('SELECT currency FROM trips WHERE id = ?').get<{ currency?: string }>(tripId);
    const tripCur = (trip?.currency || 'EUR').toUpperCase();
    if (cur === tripCur) return; // same as the trip currency → no conversion to freeze
    const rates = await getRates(tripCur);
    const r = rates?.[cur];
    if (r && r > 0) data.exchange_rate = r;
  }

  async create(tripId: string, data: Parameters<typeof svc.createBudgetItem>[1]) {
    await this.freezeForeignRate(tripId, data);
    return svc.createBudgetItem(tripId, data);
  }

  async update(id: string, tripId: string, data: Parameters<typeof svc.updateBudgetItem>[2]) {
    await this.freezeForeignRate(tripId, data, id);
    return svc.updateBudgetItem(id, tripId, data);
  }

  remove(id: string, tripId: string) {
    return svc.deleteBudgetItem(id, tripId);
  }

  updateMembers(id: string, tripId: string, userIds: number[]) {
    return svc.updateMembers(id, tripId, userIds);
  }

  toggleMemberPaid(id: string, tripId: string, userId: string, paid: boolean) {
    return svc.toggleMemberPaid(id, tripId, userId, paid);
  }

  setPayers(id: string, tripId: string, payers: { user_id: number; amount: number }[]) {
    return svc.setItemPayers(id, tripId, payers);
  }

  listSettlements(tripId: string) {
    return svc.listSettlements(tripId);
  }

  createSettlement(tripId: string, data: { from_user_id: number; to_user_id: number; amount: number }, userId: number) {
    return svc.createSettlement(tripId, data, userId);
  }

  updateSettlement(id: string, tripId: string, data: { from_user_id: number; to_user_id: number; amount: number }) {
    return svc.updateSettlement(id, tripId, data);
  }

  deleteSettlement(id: string, tripId: string) {
    return svc.deleteSettlement(id, tripId);
  }

  reorderItems(tripId: string, orderedIds: number[]) {
    return svc.reorderBudgetItems(tripId, orderedIds);
  }

  reorderCategories(tripId: string, orderedCategories: string[]) {
    return svc.reorderBudgetCategories(tripId, orderedCategories);
  }

  /**
   * Mirrors the legacy PUT /:id side effect: when a price-linked budget item's
   * total_price changes, write it into the reservation's metadata and broadcast
   * reservation:updated. Non-fatal — a failure here never breaks the budget update.
   */
  async syncReservationPrice(
    tripId: string,
    reservationId: number,
    totalPrice: number,
    socketId: string | undefined,
  ): Promise<void> {
    try {
      const reservation = await asyncDb
        .prepare('SELECT id, metadata FROM reservations WHERE id = ? AND trip_id = ?')
        .get<{ id: number; metadata: string | null }>(reservationId, tripId);
      if (!reservation) return;
      const meta = reservation.metadata ? JSON.parse(reservation.metadata) : {};
      meta.price = String(totalPrice);
      await asyncDb.prepare('UPDATE reservations SET metadata = ? WHERE id = ?').run(JSON.stringify(meta), reservation.id);
      const updatedRes = await asyncDb.prepare('SELECT * FROM reservations WHERE id = ?').get(reservation.id);
      broadcast(tripId, 'reservation:updated', { reservation: updatedRes }, socketId);
    } catch (err) {
      console.error('[budget] Failed to sync price to reservation:', err);
    }
  }
}
