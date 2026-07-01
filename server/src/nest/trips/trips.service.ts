import { asyncDb, canAccessTripAsync } from '../../db/asyncDatabase';
import { logWarn } from '../../services/auditLog';
import { listBudgetItems } from '../../services/budgetService';
import { listDays, listAccommodations } from '../../services/dayService';
import {
  checkActiveTripCapacity,
  checkTripGroupCapacity,
  annotateTripsWithEditLocks,
  throwIfEntitlementDenied,
} from '../../services/entitlementService';
import { listFilesAsync } from '../../services/fileService';
import { listItems as listPackingItems } from '../../services/packingService';
import { checkPermissionAsync } from '../../services/permissions';
import { listPlacesAsync } from '../../services/placeService';
import { listReservations, resyncReservationDays } from '../../services/reservationService';
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

  can(action: string, role: string, ownerId: number | null, userId: number, isMember: boolean): Promise<boolean> {
    return checkPermissionAsync(action, role, ownerId, userId, isMember);
  }

  broadcast(tripId: string, event: string, payload: Record<string, unknown>, socketId: string | undefined): void {
    broadcast(tripId, event, payload, socketId);
  }

  async assertCanCreateActiveTrip(userId: number): Promise<void> {
    throwIfEntitlementDenied(await checkActiveTripCapacity(userId));
  }

  async list(userId: number, archived: number | null) {
    const startedAt = Date.now();
    try {
      if (archived === null) {
        const trips = await asyncDb
          .prepare(
            `
      ${tripSvc.TRIP_SELECT}
      LEFT JOIN trip_members m ON m.trip_id = t.id AND m.user_id = :userId
      WHERE (t.user_id = :userId OR m.user_id IS NOT NULL)
      ORDER BY t.created_at DESC
    `,
          )
          .all<{ id: number; user_id: number }>({ userId });
        return annotateTripsWithEditLocks(trips);
      }
      const trips = await asyncDb
        .prepare(
          `
    ${tripSvc.TRIP_SELECT}
    LEFT JOIN trip_members m ON m.trip_id = t.id AND m.user_id = :userId
    WHERE (t.user_id = :userId OR m.user_id IS NOT NULL) AND t.is_archived = :archived
    ORDER BY t.created_at DESC
  `,
        )
        .all<{ id: number; user_id: number }>({ userId, archived });
      return annotateTripsWithEditLocks(trips);
    } finally {
      const ms = Date.now() - startedAt;
      if (ms >= 1000) {
        logWarn(`[perf] async TripsService.list archived=${archived ?? 'all'} took ${ms}ms`);
      }
    }
  }

  async create(userId: number, data: Parameters<typeof tripSvc.createTrip>[1], maxDays?: number) {
    const rd =
      data.reminder_days !== undefined
        ? Number(data.reminder_days) >= 0 && Number(data.reminder_days) <= 30
          ? Number(data.reminder_days)
          : 3
        : 3;

    return asyncDb.transaction(async () => {
      const result = await asyncDb
        .prepare(
          `
    INSERT INTO trips (user_id, title, description, start_date, end_date, currency, reminder_days)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `,
        )
        .run(
          userId,
          data.title,
          data.description || null,
          data.start_date || null,
          data.end_date || null,
          data.currency || 'EUR',
          rd,
        );

      const tripId = Number(result.lastInsertRowid);
      await this.seedNewTripDays(tripId, data.start_date || null, data.end_date || null, maxDays, data.day_count);

      const trip = await asyncDb
        .prepare(`${tripSvc.TRIP_SELECT} WHERE t.id = :tripId`)
        .get<{ id: number; user_id: number }>({ userId, tripId });
      const [annotatedTrip] = await annotateTripsWithEditLocks(trip ? [trip] : []);
      return { trip: annotatedTrip, tripId, reminderDays: rd };
    })();
  }

  private async seedNewTripDays(
    tripId: number,
    startDate: string | null,
    endDate: string | null,
    maxDays?: number,
    dayCount?: number,
  ): Promise<void> {
    const insert = asyncDb.prepare('INSERT INTO days (trip_id, day_number, date) VALUES (?, ?, ?)');

    if (!startDate || !endDate) {
      const targetCount = Math.min(Math.max(dayCount ?? 7, 1), tripSvc.MAX_TRIP_DAYS);
      for (let i = 1; i <= targetCount; i++) {
        await insert.run(tripId, i, null);
      }
      return;
    }

    const [sy, sm, sd] = startDate.split('-').map(Number);
    const [ey, em, ed] = endDate.split('-').map(Number);
    const startMs = Date.UTC(sy, sm - 1, sd);
    const endMs = Date.UTC(ey, em - 1, ed);
    const numDays = Math.min(Math.floor((endMs - startMs) / tripSvc.MS_PER_DAY) + 1, maxDays ?? tripSvc.MAX_TRIP_DAYS);

    for (let i = 0; i < numDays; i++) {
      const d = new Date(startMs + i * tripSvc.MS_PER_DAY);
      const yyyy = d.getUTCFullYear();
      const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
      const dd = String(d.getUTCDate()).padStart(2, '0');
      await insert.run(tripId, i + 1, `${yyyy}-${mm}-${dd}`);
    }
  }

  async get(tripId: string, userId: number) {
    const trip = await asyncDb
      .prepare(
        `
    ${tripSvc.TRIP_SELECT}
    LEFT JOIN trip_members m ON m.trip_id = t.id AND m.user_id = :userId
    WHERE t.id = :tripId AND (t.user_id = :userId OR m.user_id IS NOT NULL)
  `,
      )
      .get<{ id: number; user_id: number }>({ userId, tripId });
    const [annotatedTrip] = await annotateTripsWithEditLocks(trip ? [trip] : []);
    return annotatedTrip;
  }

  async getRaw(tripId: string) {
    return asyncDb.prepare('SELECT * FROM trips WHERE id = ?').get(tripId);
  }

  async getOwner(tripId: string) {
    return asyncDb.prepare('SELECT user_id FROM trips WHERE id = ?').get<{ user_id: number }>(tripId);
  }

  async update(tripId: string, userId: number, body: Parameters<typeof tripSvc.updateTrip>[2], role: string) {
    const trip = await asyncDb.prepare('SELECT * FROM trips WHERE id = ?').get<{
      id: number;
      user_id: number;
      title: string;
      description: string | null;
      start_date: string | null;
      end_date: string | null;
      currency: string;
      is_archived: number;
      cover_image: string | null;
      reminder_days?: number;
    }>(tripId);
    if (!trip) throw new tripSvc.NotFoundError('Trip not found');

    const { title, description, start_date, end_date, currency, is_archived, cover_image, reminder_days } = body;
    if (start_date && end_date && new Date(end_date) < new Date(start_date)) {
      throw new tripSvc.ValidationError('End date must be after start date');
    }

    const newTitle = title || trip.title;
    const newDesc = description !== undefined ? description : trip.description;
    const newStart = start_date !== undefined ? start_date : trip.start_date;
    const newEnd = end_date !== undefined ? end_date : trip.end_date;
    const newCurrency = currency || trip.currency;
    const newArchived = is_archived !== undefined ? (is_archived ? 1 : 0) : trip.is_archived;
    const newCover = cover_image !== undefined ? cover_image : trip.cover_image;
    const oldReminder = trip.reminder_days ?? 3;
    const newReminder =
      reminder_days !== undefined
        ? Number(reminder_days) >= 0 && Number(reminder_days) <= 30
          ? Number(reminder_days)
          : oldReminder
        : oldReminder;

    await asyncDb
      .prepare(
        `
    UPDATE trips SET title=?, description=?, start_date=?, end_date=?,
      currency=?, is_archived=?, cover_image=?, reminder_days=?, updated_at=CURRENT_TIMESTAMP
    WHERE id=?
  `,
      )
      .run(
        newTitle,
        newDesc,
        newStart || null,
        newEnd || null,
        newCurrency,
        newArchived,
        newCover,
        newReminder,
        tripId,
      );

    const dayCount = body.day_count
      ? Math.min(Math.max(Number(body.day_count) || 7, 1), tripSvc.MAX_TRIP_DAYS)
      : undefined;
    if (newStart !== trip.start_date || newEnd !== trip.end_date || dayCount) {
      await tripSvc.generateDaysAsync(tripId, newStart || null, newEnd || null, undefined, dayCount);
      await resyncReservationDays(tripId);
    }

    const changes: Record<string, unknown> = {};
    if (title && title !== trip.title) changes.title = title;
    if (newStart !== trip.start_date) changes.start_date = newStart;
    if (newEnd !== trip.end_date) changes.end_date = newEnd;
    if (newReminder !== oldReminder) changes.reminder_days = newReminder === 0 ? 'none' : `${newReminder} days`;
    if (is_archived !== undefined && newArchived !== trip.is_archived) changes.archived = !!newArchived;

    const isAdminEdit = role === 'admin' && trip.user_id !== userId;
    let ownerEmail: string | undefined;
    if (Object.keys(changes).length > 0 && isAdminEdit) {
      ownerEmail = (await asyncDb.prepare('SELECT email FROM users WHERE id = ?').get<{ email: string }>(trip.user_id))
        ?.email;
    }

    const updatedTrip = await asyncDb
      .prepare(`${tripSvc.TRIP_SELECT} WHERE t.id = :tripId`)
      .get<{ id: number; user_id: number }>({ userId, tripId });
    const [annotatedTrip] = await annotateTripsWithEditLocks(updatedTrip ? [updatedTrip] : []);
    return { updatedTrip: annotatedTrip, changes, isAdminEdit, ownerEmail, newTitle, newReminder, oldReminder };
  }

  async remove(tripId: string, userId: number, role: string) {
    const trip = await asyncDb.prepare('SELECT title, user_id FROM trips WHERE id = ?').get<{
      title: string;
      user_id: number;
    }>(tripId);
    if (!trip) throw new tripSvc.NotFoundError('Trip not found');

    const isAdminDelete = role === 'admin' && trip.user_id !== userId;
    const ownerEmail = isAdminDelete
      ? (await asyncDb.prepare('SELECT email FROM users WHERE id = ?').get<{ email: string }>(trip.user_id))?.email
      : undefined;

    await asyncDb.transaction(async () => {
      await asyncDb
        .prepare(
          `
    DELETE FROM journey_entries
    WHERE source_trip_id = ? AND type = 'skeleton'
  `,
        )
        .run(tripId);
      await asyncDb
        .prepare(
          `
    UPDATE journey_entries SET source_trip_id = NULL, source_place_id = NULL
    WHERE source_trip_id = ?
  `,
        )
        .run(tripId);
      await asyncDb.prepare('DELETE FROM trips WHERE id = ?').run(tripId);
    })();

    return { tripId: Number(tripId), title: trip.title, ownerId: trip.user_id, isAdminDelete, ownerEmail };
  }

  deleteOldCover(coverImage: string | null | undefined): Promise<void> {
    return tripSvc.deleteOldCoverAsync(coverImage as never);
  }

  async updateCoverImage(tripId: string, url: string): Promise<void> {
    await asyncDb.prepare('UPDATE trips SET cover_image=?, updated_at=CURRENT_TIMESTAMP WHERE id=?').run(url, tripId);
  }

  copy(tripId: string, userId: number, title?: string) {
    return tripSvc.copyTripById(tripId, userId, title);
  }

  /** Re-read a freshly copied trip in list shape (mirrors the route's TRIP_SELECT query). */
  async getCopiedTrip(newTripId: number, userId: number) {
    const trip = await asyncDb
      .prepare(`${tripSvc.TRIP_SELECT} WHERE t.id = :tripId`)
      .get<{ id: number; user_id: number }>({ userId, tripId: newTripId });
    const [annotatedTrip] = await annotateTripsWithEditLocks(trip ? [trip] : []);
    return annotatedTrip;
  }

  async listMembers(tripId: string, ownerId: number) {
    const members = await asyncDb
      .prepare(
        `
    SELECT u.id, u.username, u.email, u.avatar,
      CASE WHEN u.id = ? THEN 'owner' ELSE 'member' END as role,
      m.added_at,
      ib.username as invited_by_username
    FROM trip_members m
    JOIN users u ON u.id = m.user_id
    LEFT JOIN users ib ON ib.id = m.invited_by
    WHERE m.trip_id = ?
    ORDER BY m.added_at ASC
  `,
      )
      .all<{
        id: number;
        username: string;
        email: string;
        avatar: string | null;
        role: string;
        added_at: string;
        invited_by_username: string | null;
      }>(ownerId, tripId);

    const owner = await asyncDb
      .prepare('SELECT id, username, email, avatar FROM users WHERE id = ?')
      .get<Pick<User, 'id' | 'username' | 'email' | 'avatar'>>(ownerId);

    return {
      owner: owner
        ? { ...owner, role: 'owner', avatar_url: owner.avatar ? `/uploads/avatars/${owner.avatar}` : null }
        : null,
      members: members.map((m) => ({ ...m, avatar_url: m.avatar ? `/uploads/avatars/${m.avatar}` : null })),
    };
  }

  async addMember(
    tripId: string,
    identifier: string,
    ownerId: number,
    userId: number,
  ): Promise<tripSvc.AddMemberResult> {
    if (!identifier) throw new tripSvc.ValidationError('Email or username required');
    const cleanIdentifier = identifier.trim();

    const target = await asyncDb
      .prepare('SELECT id, username, email, avatar FROM users WHERE email = ? OR username = ?')
      .get<Pick<User, 'id' | 'username' | 'email' | 'avatar'>>(cleanIdentifier, cleanIdentifier);

    if (!target) throw new tripSvc.NotFoundError('User not found');
    if (target.id === ownerId) throw new tripSvc.ValidationError('Trip owner is already a member');

    const existing = await asyncDb
      .prepare('SELECT id FROM trip_members WHERE trip_id = ? AND user_id = ?')
      .get<{ id: number }>(tripId, target.id);
    if (existing) throw new tripSvc.ValidationError('User already has access');

    throwIfEntitlementDenied(await checkTripGroupCapacity(ownerId, tripId));

    await asyncDb
      .prepare('INSERT INTO trip_members (trip_id, user_id, invited_by) VALUES (?, ?, ?)')
      .run(tripId, target.id, userId);

    const tripInfo = await asyncDb.prepare('SELECT title FROM trips WHERE id = ?').get<{ title: string }>(tripId);

    return {
      member: {
        ...target,
        role: 'member',
        avatar_url: target.avatar ? `/uploads/avatars/${target.avatar}` : null,
      },
      targetUserId: target.id,
      tripTitle: tripInfo?.title || 'Untitled',
    };
  }

  async removeMember(tripId: string, targetId: number): Promise<void> {
    await asyncDb.prepare('DELETE FROM trip_members WHERE trip_id = ? AND user_id = ?').run(tripId, targetId);
  }

  exportICS(tripId: string) {
    return tripSvc.exportICS(tripId);
  }

  /** Aggregates every trip sub-collection for offline caching (legacy /:id/bundle). */
  async bundle(tripId: string, trip: { user_id: number }) {
    const startedAt = Date.now();
    const timed = async <T>(label: string, promise: Promise<T>): Promise<T> => {
      const partStartedAt = Date.now();
      try {
        return await promise;
      } finally {
        const ms = Date.now() - partStartedAt;
        if (ms >= 1000) {
          logWarn(`[perf] trip bundle ${label} trip=${tripId} took ${ms}ms`);
        }
      }
    };
    const [
      { days },
      { owner, members },
      places,
      packingItems,
      todoItems,
      budgetItems,
      reservations,
      files,
      accommodations,
    ] = await Promise.all([
      timed('days', listDays(tripId)),
      timed('members', this.listMembers(tripId, trip.user_id)),
      timed('places', listPlacesAsync(String(tripId), {})),
      timed('packing', listPackingItems(tripId)),
      timed('todos', listTodoItems(tripId)),
      timed('budget', listBudgetItems(tripId)),
      timed('reservations', listReservations(tripId)),
      timed('files', listFilesAsync(tripId, false)),
      timed('accommodations', listAccommodations(tripId)),
    ]);
    const totalMs = Date.now() - startedAt;
    if (totalMs >= 1000) {
      logWarn(`[perf] trip bundle total trip=${tripId} took ${totalMs}ms`);
    }
    return {
      trip,
      days,
      places,
      packingItems,
      todoItems,
      budgetItems,
      reservations,
      files,
      accommodations,
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
