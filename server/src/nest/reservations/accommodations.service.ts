import { canAccessTripAsync } from '../../db/asyncDatabase';
import * as dayService from '../../services/dayService';
import { checkPermissionAsync } from '../../services/permissions';
import type { User } from '../../types';
import { broadcast } from '../../websocket';
import { Injectable } from '@nestjs/common';

type Trip = { user_id: number };

/**
 * Thin Nest wrapper around the accommodation parts of the existing day service.
 * Accommodations are gated by the 'day_edit' permission (same as days) and the
 * SQL + cascade (linked reservation / budget cleanup on delete) reuse the legacy
 * code unchanged.
 */
@Injectable()
export class AccommodationsService {
  /** Mirrors the requireTripAccess middleware (owner or member), returning the trip. */
  async verifyTripAccess(tripId: string, userId: number): Promise<Trip | undefined> {
    return await canAccessTripAsync(Number(tripId), userId);
  }

  async canEdit(trip: Trip, user: User): Promise<boolean> {
    return checkPermissionAsync('day_edit', user.role, trip.user_id, user.id, trip.user_id !== user.id);
  }

  broadcast(tripId: string, event: string, payload: Record<string, unknown>, socketId: string | undefined): void {
    broadcast(tripId, event, payload, socketId);
  }

  async list(tripId: string) {
    return await dayService.listAccommodations(tripId);
  }

  async validateRefs(tripId: string, placeId?: number, startDayId?: number, endDayId?: number) {
    return await dayService.validateAccommodationRefs(tripId, placeId, startDayId, endDayId);
  }

  async get(id: string, tripId: string) {
    return await dayService.getAccommodation(id, tripId);
  }

  async create(tripId: string, data: Parameters<typeof dayService.createAccommodation>[1]) {
    return await dayService.createAccommodation(tripId, data);
  }

  async update(
    id: string,
    existing: Parameters<typeof dayService.updateAccommodation>[1],
    fields: Parameters<typeof dayService.updateAccommodation>[2],
  ) {
    return await dayService.updateAccommodation(id, existing, fields);
  }

  async remove(id: string) {
    return await dayService.deleteAccommodation(id);
  }
}
