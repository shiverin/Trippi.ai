import { describe, it, expect } from 'vitest'
import {
  bookingRouteReservationIds,
  buildDisplayedPinOrderMap,
  hasValidPlaceCoordinates,
  resolvePoolAssignmentId,
  visibleBookingRouteIds,
} from './tripPlannerModel'
import { buildAssignment, buildPlace, buildReservation } from '../../../tests/helpers/factories'

describe('resolvePoolAssignmentId', () => {
  it('returns the lone assignment id when the place is assigned to exactly one day', () => {
    const place = buildPlace({ id: 7 })
    const assignment = buildAssignment({ id: 42, day_id: 3, place })
    const assignments = { 3: [assignment], 4: [buildAssignment({ id: 99, day_id: 4 })] }
    expect(resolvePoolAssignmentId(assignments, 7)).toBe(42)
  })

  it('returns null when the place is not assigned to any day', () => {
    const assignments = { 3: [buildAssignment({ id: 99, day_id: 3 })] }
    expect(resolvePoolAssignmentId(assignments, 7)).toBeNull()
  })

  it('returns null when the place is assigned to multiple days (ambiguous time)', () => {
    const assignments = {
      3: [buildAssignment({ id: 1, day_id: 3, place: buildPlace({ id: 7 }) })],
      4: [buildAssignment({ id: 2, day_id: 4, place: buildPlace({ id: 7 }) })],
    }
    expect(resolvePoolAssignmentId(assignments, 7)).toBeNull()
  })
})

describe('hasValidPlaceCoordinates', () => {
  it('treats numeric zero coordinates as valid', () => {
    expect(hasValidPlaceCoordinates(buildPlace({ lat: 0, lng: 0 }))).toBe(true)
  })

  it('rejects missing coordinates', () => {
    expect(hasValidPlaceCoordinates(buildPlace({ lat: null, lng: 103.8 }))).toBe(false)
    expect(hasValidPlaceCoordinates(buildPlace({ lat: 1.3, lng: null }))).toBe(false)
  })
})

describe('buildDisplayedPinOrderMap', () => {
  it('numbers selected-day pins contiguously after hidden and ungeocoded stops are skipped', () => {
    const first = buildPlace({ id: 10, lat: 31.2, lng: 121.5 })
    const hidden = buildPlace({ id: 20, lat: 31.3, lng: 121.6 })
    const second = buildPlace({ id: 30, lat: 31.4, lng: 121.7 })
    const ungeocoded = buildPlace({ id: 40, lat: null, lng: null })
    const extraVisible = buildPlace({ id: 50, lat: 31.5, lng: 121.8 })

    const orderMap = buildDisplayedPinOrderMap({
      selectedDayId: 5,
      assignments: {
        5: [
          buildAssignment({ day_id: 5, order_index: 0, place: first }),
          buildAssignment({ day_id: 5, order_index: 1, place: hidden }),
          buildAssignment({ day_id: 5, order_index: 2, place: second }),
          buildAssignment({ day_id: 5, order_index: 3, place: ungeocoded }),
        ],
      },
      mapPlaces: [first, second, ungeocoded, extraVisible],
    })

    expect(orderMap).toEqual({
      10: [1],
      30: [2],
      50: [3],
    })
  })

  it('assigns one badge per displayed pin when a place appears multiple times in the timeline', () => {
    const place = buildPlace({ id: 10, lat: 31.2, lng: 121.5 })

    const orderMap = buildDisplayedPinOrderMap({
      selectedDayId: 5,
      assignments: {
        5: [
          buildAssignment({ day_id: 5, order_index: 0, place }),
          buildAssignment({ day_id: 5, order_index: 3, place }),
        ],
      },
      mapPlaces: [place],
    })

    expect(orderMap).toEqual({ 10: [1] })
  })

  it('numbers all visible pins in map order when no day is selected', () => {
    const first = buildPlace({ id: 10, lat: 0, lng: 0 })
    const hidden = buildPlace({ id: 20, lat: null, lng: 103.8 })
    const second = buildPlace({ id: 30, lat: 1.3, lng: 103.9 })

    const orderMap = buildDisplayedPinOrderMap({
      selectedDayId: null,
      assignments: {},
      mapPlaces: [first, hidden, second],
    })

    expect(orderMap).toEqual({
      10: [1],
      30: [2],
    })
  })
})

describe('booking route visibility', () => {
  const endpoints = [
    { role: 'from', sequence: 0, lat: 1, lng: 1, name: 'A' },
    { role: 'to', sequence: 1, lat: 2, lng: 2, name: 'B' },
  ] as any

  it('returns no visible route ids when the global toggle is off', () => {
    const reservations = [buildReservation({ id: 1, type: 'flight', endpoints })]
    expect(visibleBookingRouteIds(reservations, false, {})).toEqual([])
  })

  it('returns every eligible transport id when the global toggle is on', () => {
    const reservations = [
      buildReservation({ id: 1, type: 'flight', endpoints, day_id: 10 }),
      buildReservation({ id: 2, type: 'train', endpoints, day_id: 20 }),
      buildReservation({ id: 3, type: 'subway', endpoints, day_id: 30 }),
      buildReservation({ id: 4, type: 'car', endpoints, day_id: 40 }),
      buildReservation({ id: 5, type: 'ferry', endpoints, day_id: 50 }),
    ]
    expect(visibleBookingRouteIds(reservations, true, {})).toEqual([1, 2, 3, 4, 5])
  })

  it('removes hidden per-transport exceptions while global stays on', () => {
    const reservations = [
      buildReservation({ id: 1, type: 'flight', endpoints }),
      buildReservation({ id: 2, type: 'bus', endpoints }),
    ]
    expect(visibleBookingRouteIds(reservations, true, { 2: true })).toEqual([1])
  })

  it('ignores non-transport and endpoint-less reservations', () => {
    const reservations = [
      buildReservation({ id: 1, type: 'hotel', endpoints }),
      buildReservation({ id: 2, type: 'train', endpoints: [endpoints[0]] }),
      buildReservation({ id: 3, type: 'car', endpoints }),
    ]
    expect(bookingRouteReservationIds(reservations)).toEqual([3])
  })
})
