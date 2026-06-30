/**
 * Trip planner pure helpers — React/IO-free logic shared by the data hook
 * (useTripPlanner) and kept here so it can be unit-tested in isolation. Part of
 * the FE "page = wiring container + data hook" convention (see PATTERN.md).
 */

import type { Assignment, Place, Reservation } from '../../types'

type MappablePlace = Pick<Place, 'id' | 'lat' | 'lng'>

export function plannedPlaceIds(assignments: Record<string | number, Assignment[]>): Set<number> {
  return new Set(
    Object.values(assignments)
      .flat()
      .map((assignment) => assignment.place?.id ?? assignment.place_id)
      .filter((placeId): placeId is number => typeof placeId === 'number'),
  )
}

export const BOOKING_ROUTE_TRANSPORT_TYPES = new Set([
  'flight',
  'train',
  'subway',
  'bus',
  'car',
  'taxi',
  'bicycle',
  'cruise',
  'ferry',
  'transport_other',
])

type RouteableReservation = Pick<Reservation, 'id' | 'type' | 'endpoints'> & {
  __leg?: { index?: number }
}

export function hasValidPlaceCoordinates(place: Pick<Place, 'lat' | 'lng'> | null | undefined): boolean {
  return (
    typeof place?.lat === 'number' &&
    Number.isFinite(place.lat) &&
    typeof place?.lng === 'number' &&
    Number.isFinite(place.lng)
  )
}

export function buildDisplayedPinOrderMap({
  selectedDayId,
  assignments,
  mapPlaces,
}: {
  selectedDayId: number | null | undefined
  assignments: Record<string | number, Assignment[]>
  mapPlaces: MappablePlace[]
}): Record<number, number[]> {
  const displayedPlaces = mapPlaces.filter(hasValidPlaceCoordinates)
  const displayedIds = new Set(displayedPlaces.map((place) => place.id))
  const map: Record<number, number[]> = {}
  let nextBadgeNumber = 1

  const numberDisplayedPin = (placeId: number | null | undefined) => {
    if (placeId == null || !displayedIds.has(placeId) || map[placeId]) return
    map[placeId] = [nextBadgeNumber]
    nextBadgeNumber += 1
  }

  if (selectedDayId) {
    const dayAssignments = assignments[String(selectedDayId)] || []
    const sorted = [...dayAssignments].sort((a, b) => a.order_index - b.order_index)
    for (const assignment of sorted) {
      numberDisplayedPin(assignment.place?.id)
    }
  }

  for (const place of displayedPlaces) {
    numberDisplayedPin(place.id)
  }

  return map
}

/**
 * Resolve the day-assignment to use when a place is edited from the Places pool,
 * where no day is in context. Times live per day-assignment (#1247), so we can
 * only hydrate/persist a place's time when it is assigned to exactly one day.
 * Returns that assignment's id, or null when the place has 0 or 2+ assignments
 * (ambiguous — the modal then hides the time fields).
 */
export function resolvePoolAssignmentId(
  assignments: Record<string | number, Assignment[]>,
  placeId: number,
): number | null {
  const matches = Object.values(assignments)
    .flat()
    .filter((a) => a.place?.id === placeId)
  return matches.length === 1 ? matches[0].id : null
}

export function bookingRouteReservationIds(reservations: RouteableReservation[]): number[] {
  const seen = new Set<number>()
  const ids: number[] = []

  for (const reservation of reservations) {
    if (reservation.__leg && reservation.__leg.index !== 0) continue
    if (!BOOKING_ROUTE_TRANSPORT_TYPES.has(reservation.type)) continue
    if ((reservation.endpoints || []).length < 2) continue
    const id = Number(reservation.id)
    if (!Number.isFinite(id) || seen.has(id)) continue
    seen.add(id)
    ids.push(id)
  }

  return ids
}

export function visibleBookingRouteIds(
  reservations: RouteableReservation[],
  globalShown: boolean,
  hiddenById: Record<string, boolean>,
  shownById: Record<string, boolean> = {},
): number[] {
  return bookingRouteReservationIds(reservations).filter((id) =>
    globalShown ? !hiddenById[String(id)] : shownById[String(id)] === true,
  )
}
