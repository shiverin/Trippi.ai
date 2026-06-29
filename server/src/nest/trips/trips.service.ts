import { asyncDb, canAccessTripAsync } from '../../db/asyncDatabase';
import { logWarn } from '../../services/auditLog';
import { listBudgetItems } from '../../services/budgetService';
import { listDays, listAccommodations } from '../../services/dayService';
import { listFiles } from '../../services/fileService';
import { listItems as listPackingItems } from '../../services/packingService';
import { checkPermission } from '../../services/permissions';
import { listPlaces } from '../../services/placeService';
import { listReservations } from '../../services/reservationService';
import { listItems as listTodoItems } from '../../services/todoService';
import * as tripSvc from '../../services/tripService';
import type { User } from '../../types';
import { broadcast } from '../../websocket';
import { Injectable } from '@nestjs/common';

/**
 * Thin Nest wrapper around the existing trip service + the per-domain list
 * services used to build the offline bundle. Auth (canAccessTrip), permissions,
 * the SQL and the ICS export reuse the legacy code unchanged. Per-field
 * permission checks and audit logging stay in the controller (1:1 with the
 * legacy route).
 */
@Injectable()
export class TripsService {
  async canAccessTrip(tripId: string, userId: number): Promise<{ user_id: number } | undefined> {
    return canAccessTripAsync(tripId, userId);
  }

  can(action: string, role: string, ownerId: number | null, userId: number, isMember: boolean): boolean {
    return checkPermission(action, role, ownerId, userId, isMember);
  }

  broadcast(tripId: string, event: string, payload: Record<string, unknown>, socketId: string | undefined): void {
    broadcast(tripId, event, payload, socketId);
  }

  async list(userId: number, archived: number | null) {
    const startedAt = Date.now();
    try {
      if (archived === null) {
        return asyncDb
          .prepare(
            `
      ${tripSvc.TRIP_SELECT}
      LEFT JOIN trip_members m ON m.trip_id = t.id AND m.user_id = :userId
      WHERE (t.user_id = :userId OR m.user_id IS NOT NULL)
      ORDER BY t.created_at DESC
    `,
          )
          .all({ userId });
      }
      return asyncDb
        .prepare(
          `
    ${tripSvc.TRIP_SELECT}
    LEFT JOIN trip_members m ON m.trip_id = t.id AND m.user_id = :userId
    WHERE (t.user_id = :userId OR m.user_id IS NOT NULL) AND t.is_archived = :archived
    ORDER BY t.created_at DESC
  `,
        )
        .all({ userId, archived });
    } finally {
      const ms = Date.now() - startedAt;
      if (ms >= 1000) {
        logWarn(`[perf] async TripsService.list archived=${archived ?? 'all'} took ${ms}ms`);
      }
    }
  }

  create(userId: number, data: Parameters<typeof tripSvc.createTrip>[1]) {
    return tripSvc.createTrip(userId, data);
  }

  async get(tripId: string, userId: number) {
    return asyncDb
      .prepare(
        `
    ${tripSvc.TRIP_SELECT}
    LEFT JOIN trip_members m ON m.trip_id = t.id AND m.user_id = :userId
    WHERE t.id = :tripId AND (t.user_id = :userId OR m.user_id IS NOT NULL)
  `,
      )
      .get({ userId, tripId });
  }

  getRaw(tripId: string) {
    return tripSvc.getTripRaw(tripId);
  }

  getOwner(tripId: string) {
    return tripSvc.getTripOwner(tripId);
  }

  update(tripId: string, userId: number, body: Parameters<typeof tripSvc.updateTrip>[2], role: string) {
    return tripSvc.updateTrip(tripId, userId, body, role);
  }

  remove(tripId: string, userId: number, role: string) {
    return tripSvc.deleteTrip(tripId, userId, role);
  }

  deleteOldCover(coverImage: string | null | undefined): void {
    tripSvc.deleteOldCover(coverImage as never);
  }

  updateCoverImage(tripId: string, url: string): void {
    tripSvc.updateCoverImage(tripId, url);
  }

  copy(tripId: string, userId: number, title?: string) {
    return tripSvc.copyTripById(tripId, userId, title);
  }

  /** Re-read a freshly copied trip in list shape (mirrors the route's TRIP_SELECT query). */
  async getCopiedTrip(newTripId: number, userId: number) {
    return asyncDb.prepare(`${tripSvc.TRIP_SELECT} WHERE t.id = :tripId`).get({ userId, tripId: newTripId });
  }

  listMembers(tripId: string, ownerId: number) {
    return tripSvc.listMembers(tripId, ownerId);
  }

  addMember(tripId: string, identifier: string, ownerId: number, userId: number) {
    return tripSvc.addMember(tripId, identifier, ownerId, userId);
  }

  removeMember(tripId: string, targetId: number): void {
    tripSvc.removeMember(tripId, targetId);
  }

  exportICS(tripId: string) {
    return tripSvc.exportICS(tripId);
  }

  /** Aggregates every trip sub-collection for offline caching (legacy /:id/bundle). */
  bundle(tripId: string, trip: { user_id: number }) {
    const { days } = listDays(tripId);
    const { owner, members } = this.listMembers(tripId, trip.user_id);
    return {
      trip,
      days,
      places: listPlaces(String(tripId), {}),
      packingItems: listPackingItems(tripId),
      todoItems: listTodoItems(tripId),
      budgetItems: listBudgetItems(tripId),
      reservations: listReservations(tripId),
      files: listFiles(tripId, false),
      accommodations: listAccommodations(tripId),
      members: [owner, ...(members || [])].filter(Boolean),
    };
  }

  /** Fire-and-forget trip-invite notification (mirrors the route's dynamic import). */
  notifyInvite(tripId: string, actor: User, targetUserId: number, tripTitle: string, inviteeEmail: string): void {
    import('../../services/notificationService').then(({ send }) => {
      send({
        event: 'trip_invite',
        actorId: actor.id,
        scope: 'user',
        targetId: targetUserId,
        params: { trip: tripTitle, actor: actor.email, invitee: inviteeEmail, tripId: String(tripId) },
      }).catch(() => {});
    });
  }
}
