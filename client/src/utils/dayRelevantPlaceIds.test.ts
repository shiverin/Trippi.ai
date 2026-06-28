import { describe, expect, it } from 'vitest';
import { buildAssignment, buildDay, buildPlace, buildReservation } from '../../tests/helpers/factories';
import type { Accommodation } from '../types';
import { getDayRelevantPlaceIds } from './dayRelevantPlaceIds';

describe('getDayRelevantPlaceIds', () => {
  it('includes assignments, accommodations, and reservations for the selected day', () => {
    const day1 = buildDay({ id: 1 });
    const day2 = buildDay({ id: 2 });
    const day3 = buildDay({ id: 3 });
    const activity = buildPlace({ id: 10 });
    const hotel = buildPlace({ id: 11 });
    const airport = buildPlace({ id: 12 });

    const accommodation: Accommodation = {
      id: 1,
      trip_id: 1,
      place_id: hotel.id,
      start_day_id: day1.id,
      end_day_id: day3.id,
    };

    const ids = getDayRelevantPlaceIds({
      selectedDayId: day2.id,
      days: [day1, day2, day3],
      assignments: {
        [String(day2.id)]: [buildAssignment({ day_id: day2.id, place_id: activity.id, place: activity })],
      },
      accommodations: [accommodation],
      reservations: [
        buildReservation({ day_id: day2.id, end_day_id: day2.id, place_id: airport.id }),
        buildReservation({
          day_id: day1.id,
          end_day_id: day3.id,
          accommodation_place_id: hotel.id,
          accommodation_start_day_id: day1.id,
          accommodation_end_day_id: day3.id,
        }),
      ],
    });

    expect([...ids].sort((a, b) => a - b)).toEqual([activity.id, hotel.id, airport.id]);
  });

  it('returns an empty set when no day is selected', () => {
    const ids = getDayRelevantPlaceIds({
      selectedDayId: null,
      days: [buildDay({ id: 1 })],
      assignments: {},
      accommodations: [],
      reservations: [],
    });

    expect(ids.size).toBe(0);
  });
});
