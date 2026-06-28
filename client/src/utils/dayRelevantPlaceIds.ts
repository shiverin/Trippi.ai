import type { Accommodation, AssignmentsMap, Day, Reservation } from '../types';

type OrderedDay = Day & { day_number?: number | null };

interface DayRelevantPlaceIdsInput {
  selectedDayId: number | null;
  assignments: AssignmentsMap;
  days: Day[];
  accommodations: Accommodation[];
  reservations: Reservation[];
}

const addPlaceId = (ids: Set<number>, id?: number | null) => {
  if (typeof id === 'number' && Number.isFinite(id)) ids.add(id);
};

function buildDayPositionMap(days: Day[]): Map<number, number> {
  return new Map(
    days
      .map((day, index) => ({ day, index }))
      .sort((a, b) => ((a.day as OrderedDay).day_number ?? a.index) - ((b.day as OrderedDay).day_number ?? b.index))
      .map(({ day }, index) => [day.id, index])
  );
}

function includesDay(
  dayPositions: Map<number, number>,
  selectedDayId: number,
  startDayId?: number | null,
  endDayId?: number | null
): boolean {
  if (startDayId == null) return false;
  const resolvedEndDayId = endDayId ?? startDayId;
  if (startDayId === selectedDayId || resolvedEndDayId === selectedDayId) return true;

  const selectedPosition = dayPositions.get(selectedDayId);
  const startPosition = dayPositions.get(startDayId);
  const endPosition = dayPositions.get(resolvedEndDayId);
  if (selectedPosition == null || startPosition == null || endPosition == null) return false;

  const min = Math.min(startPosition, endPosition);
  const max = Math.max(startPosition, endPosition);
  return selectedPosition >= min && selectedPosition <= max;
}

export function getDayRelevantPlaceIds({
  selectedDayId,
  assignments,
  days,
  accommodations,
  reservations,
}: DayRelevantPlaceIdsInput): Set<number> {
  const ids = new Set<number>();
  if (!selectedDayId) return ids;

  for (const assignment of assignments[String(selectedDayId)] || []) {
    addPlaceId(ids, assignment.place?.id ?? assignment.place_id);
  }

  const dayPositions = buildDayPositionMap(days);
  for (const accommodation of accommodations || []) {
    if (includesDay(dayPositions, selectedDayId, accommodation.start_day_id, accommodation.end_day_id)) {
      addPlaceId(ids, accommodation.place_id);
    }
  }

  for (const reservation of reservations || []) {
    if (includesDay(dayPositions, selectedDayId, reservation.day_id, reservation.end_day_id)) {
      addPlaceId(ids, reservation.place_id);
      addPlaceId(ids, reservation.accommodation_place_id);
    }
    if (
      includesDay(
        dayPositions,
        selectedDayId,
        reservation.accommodation_start_day_id,
        reservation.accommodation_end_day_id
      )
    ) {
      addPlaceId(ids, reservation.accommodation_place_id);
    }
  }

  return ids;
}
