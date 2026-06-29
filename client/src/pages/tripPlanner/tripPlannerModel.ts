/**
 * Trip planner pure helpers — React/IO-free logic shared by the data hook
 * (useTripPlanner) and kept here so it can be unit-tested in isolation. Part of
 * the FE "page = wiring container + data hook" convention (see PATTERN.md).
 */

import type { Assignment, Place } from '../../types'

type MappablePlace = Pick<Place, 'id' | 'lat' | 'lng'>

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
