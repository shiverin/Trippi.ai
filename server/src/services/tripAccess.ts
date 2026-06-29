import { canAccessTripAsync } from '../db/asyncDatabase';

/**
 * Returns the trip row if the user is the owner or a member, otherwise undefined.
 * Shared by the domain services so each one exposes the same access check.
 */
export async function verifyTripAccess(tripId: string | number, userId: number) {
  return await canAccessTripAsync(tripId, userId);
}
