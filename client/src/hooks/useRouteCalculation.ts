import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { calculateRouteWithLegs } from '../components/Map/RouteCalculator';
import { useSettingsStore } from '../store/settingsStore';
import type { TripStoreState } from '../store/tripStore';
import { useTripStore } from '../store/tripStore';
import type { Accommodation, Category, RouteResult, RouteSegment, Waypoint } from '../types';
import { getTransportRouteEndpoints } from '../utils/dayMerge';
import { getDayBookendHotels } from '../utils/dayOrder';

const TRANSPORT_TYPES = [
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
];

const NO_ACCOMMODATIONS: Accommodation[] = [];

/**
 * Manages route calculation state for a selected day. Extracts geo-coded waypoints from
 * day assignments, draws a straight-line route immediately, then upgrades it to real OSRM
 * road geometry with per-segment durations. Aborts in-flight requests when the day changes.
 */
export function useRouteCalculation(
  tripStore: TripStoreState,
  selectedDayId: number | null,
  enabled: boolean = true,
  profile: 'driving' | 'walking' | 'cycling' = 'driving',
  accommodations: Accommodation[] = NO_ACCOMMODATIONS,
  visibleDayRouteIds: number[] = [],
  visibleAssignmentRouteIds: Record<string, boolean> = {},
  categories: Category[] = []
) {
  const [route, setRoute] = useState<[number, number][][] | null>(null);
  const [routeInfo, setRouteInfo] = useState<RouteResult | null>(null);
  const [routeSegments, setRouteSegments] = useState<RouteSegment[]>([]);
  const [routeableAssignmentRouteIds, setRouteableAssignmentRouteIds] = useState<Record<string, boolean>>({});
  const routeAbortRef = useRef<AbortController | null>(null);
  const reservationsForSignature = useTripStore((s) => s.reservations);
  // Draw the day's accommodation bookend legs (hotel → first stop, last stop →
  // hotel) unless the user turned the setting off — same gate as the sidebar.
  const optimizeFromAccommodation = useSettingsStore((s) => s.settings.optimize_from_accommodation);
  // Recompute when the user flips km↔mi so leg distances (formatted at compute time)
  // refresh instead of showing stale cached text (#1300).
  const distanceUnit = useSettingsStore((s) => s.settings.distance_unit);

  const updateRouteForDay = useCallback(
    async (_dayId: number | null) => {
      if (routeAbortRef.current) routeAbortRef.current.abort();

      // Read directly from store (not a render-phase ref) so callers after optimistic
      // updates or non-optimistic deletes always see the latest assignments.
      const currentAssignments = useTripStore.getState().assignments || {};
      const allReservations = useTripStore.getState().reservations || [];
      const allDays = useTripStore.getState().days || [];
      const visibleDaySet = new Set(visibleDayRouteIds);
      const visibleAssignmentSet = new Set(
        Object.entries(visibleAssignmentRouteIds)
          .filter(([, visible]) => visible === true)
          .map(([id]) => id)
      );
      const transportCategoryIds = new Set(
        categories
          .filter((category) => category.name?.trim().toLowerCase() === 'transport')
          .map((category) => category.id)
      );

      type Entry =
        | { kind: 'place'; lat: number; lng: number; pos: number }
        | { kind: 'transport-place'; pos: number; assignmentId: number }
        | {
            kind: 'transport';
            from: { lat: number; lng: number } | null;
            to: { lat: number; lng: number } | null;
            pos: number;
          };
      type RunEntry =
        | { kind: 'point'; lat: number; lng: number }
        | { kind: 'transport-place'; assignmentId: number };
      type LegRequest = { dayId: number; from: Waypoint; to: Waypoint; assignmentId?: number | null };

      const dayOrder = (id: number | null | undefined): number | null => {
        if (id == null) return null;
        const d = allDays.find((x) => x.id === id);
        return d ? ((d as any).day_number ?? allDays.indexOf(d)) : null;
      };
      const hotelPt = (a?: Accommodation) =>
        a && a.place_lat != null && a.place_lng != null ? { lat: a.place_lat, lng: a.place_lng } : null;

      const buildLegRequestsForDay = (dayId: number): LegRequest[] => {
        const da = (currentAssignments[String(dayId)] || []).slice().sort((a, b) => a.order_index - b.order_index);
        const thisOrder = dayOrder(dayId);
        const dayTransports =
          thisOrder == null
            ? []
            : allReservations.filter((r) => {
                if (!TRANSPORT_TYPES.includes(r.type)) return false;
                const startId = r.day_id;
                if (startId == null) return false;
                const endId = r.end_day_id ?? startId;
                if (startId === endId) {
                  if (startId !== dayId) return false;
                } else {
                  const startOrder = dayOrder(startId);
                  const endOrder = dayOrder(endId);
                  if (startOrder == null || endOrder == null) return false;
                  if (thisOrder < startOrder || thisOrder > endOrder) return false;
                }
                const pos = r.day_positions?.[dayId] ?? r.day_positions?.[String(dayId)] ?? r.day_plan_position;
                return pos != null;
              });

        const assignmentEntries: Entry[] = da.flatMap((assignment): Entry[] => {
          const place = assignment.place;
          const isTransportPlace = !!place?.category_id && transportCategoryIds.has(place.category_id);
          if (isTransportPlace) {
            return [{ kind: 'transport-place', pos: assignment.order_index, assignmentId: assignment.id }];
          }
          if (place?.lat && place?.lng) {
            return [{ kind: 'place', lat: place.lat, lng: place.lng, pos: assignment.order_index }];
          }
          return [];
        });

        const entries: Entry[] = [
          ...assignmentEntries,
          ...dayTransports.map((r) => {
            const { from, to } = getTransportRouteEndpoints(r, dayId);
            return {
              kind: 'transport' as const,
              from,
              to,
              pos: (r.day_positions?.[dayId] ?? r.day_positions?.[String(dayId)] ?? r.day_plan_position) as number,
            };
          }),
        ].sort((a, b) => a.pos - b.pos);

        const runs: RunEntry[][] = [];
        let currentRun: RunEntry[] = [];
        for (const entry of entries) {
          if (entry.kind === 'place') {
            currentRun.push({ kind: 'point', lat: entry.lat, lng: entry.lng });
          } else if (entry.kind === 'transport-place') {
            currentRun.push({ kind: 'transport-place', assignmentId: entry.assignmentId });
          } else if (entry.from || entry.to) {
            if (entry.from) currentRun.push({ kind: 'point', lat: entry.from.lat, lng: entry.from.lng });
            if (currentRun.length >= 2) runs.push(currentRun);
            currentRun = [];
            if (entry.to) currentRun.push({ kind: 'point', lat: entry.to.lat, lng: entry.to.lng });
          }
        }
        if (currentRun.length >= 2) runs.push(currentRun);

        const day = allDays.find((d) => d.id === dayId);
        const bookends =
          day && optimizeFromAccommodation !== false ? getDayBookendHotels(day, allDays, accommodations) : null;
        const flatPts: { lat: number; lng: number }[] = [];
        for (const entry of entries) {
          if (entry.kind === 'place') flatPts.push({ lat: entry.lat, lng: entry.lng });
          else if (entry.kind === 'transport') {
            if (entry.from) flatPts.push(entry.from);
            if (entry.to) flatPts.push(entry.to);
          }
        }

        const contributes = (entry: Entry) =>
          entry.kind === 'place' || (entry.kind === 'transport' && (!!entry.from || !!entry.to));
        const firstStop = entries.find(contributes);
        const lastStop = [...entries].reverse().find(contributes);
        const drawMorning = firstStop?.kind === 'place' || !!bookends?.morningIsSleptHere;
        const drawEvening = lastStop?.kind === 'place' || !!bookends?.eveningIsOvernight;
        const legRequests: LegRequest[] = [];
        const addRunLegs = (run: RunEntry[]) => {
          let previous: Waypoint | null = null;
          let pendingAssignmentId: number | null = null;
          for (const item of run) {
            if (item.kind === 'transport-place') {
              pendingAssignmentId = item.assignmentId;
              continue;
            }
            const point = { lat: item.lat, lng: item.lng };
            if (previous) {
              legRequests.push({ dayId, from: previous, to: point, assignmentId: pendingAssignmentId });
            }
            previous = point;
            pendingAssignmentId = null;
          }
        };

        const firstLocatedIndex = entries.findIndex(contributes);
        const reverseLocatedIndex = [...entries].reverse().findIndex(contributes);
        const lastLocatedIndex = reverseLocatedIndex === -1 ? -1 : entries.length - 1 - reverseLocatedIndex;
        const firstPreLocatedTransport =
          firstLocatedIndex > 0
            ? [...entries.slice(0, firstLocatedIndex)]
                .reverse()
                .find((entry): entry is Extract<Entry, { kind: 'transport-place' }> => entry.kind === 'transport-place')
            : null;
        const lastPostLocatedTransport =
          lastLocatedIndex >= 0
            ? entries
                .slice(lastLocatedIndex + 1)
                .find((entry): entry is Extract<Entry, { kind: 'transport-place' }> => entry.kind === 'transport-place')
            : null;

        const morningHotel = drawMorning ? hotelPt(bookends?.morning) : null;
        const eveningHotel = drawEvening ? hotelPt(bookends?.evening) : null;
        if (morningHotel && flatPts[0]) {
          legRequests.push({
            dayId,
            from: morningHotel,
            to: flatPts[0],
            assignmentId: firstPreLocatedTransport?.assignmentId ?? null,
          });
        }
        runs.forEach(addRunLegs);
        if (eveningHotel && flatPts[flatPts.length - 1]) {
          legRequests.push({
            dayId,
            from: flatPts[flatPts.length - 1],
            to: eveningHotel,
            assignmentId: lastPostLocatedTransport?.assignmentId ?? null,
          });
        }

        if (legRequests.length === 0 && drawMorning && drawEvening) {
          const morning = hotelPt(bookends?.morning);
          const evening = hotelPt(bookends?.evening);
          if (morning && evening && (morning.lat !== evening.lat || morning.lng !== evening.lng)) {
            legRequests.push({ dayId, from: morning, to: evening });
          }
        }
        return legRequests;
      };

      const allLegRequests = allDays.flatMap((day) => buildLegRequestsForDay(day.id));
      const nextRouteableAssignmentIds: Record<string, boolean> = {};
      allLegRequests.forEach((leg) => {
        if (leg.assignmentId != null) nextRouteableAssignmentIds[String(leg.assignmentId)] = true;
      });
      setRouteableAssignmentRouteIds(nextRouteableAssignmentIds);

      if (!enabled) {
        setRoute(null);
        setRouteSegments([]);
        return;
      }

      const visibleLegRequests = allLegRequests.filter((leg) => {
        if (leg.assignmentId != null) return visibleAssignmentSet.has(String(leg.assignmentId));
        return visibleDaySet.has(leg.dayId);
      });
      const straightLines = (): [number, number][][] =>
        visibleLegRequests.map((leg) => [
          [leg.from.lat, leg.from.lng] as [number, number],
          [leg.to.lat, leg.to.lng] as [number, number],
        ]);

      if (visibleLegRequests.length === 0) {
        setRoute(null);
        setRouteSegments([]);
        return;
      }

      setRoute(straightLines());

      const controller = new AbortController();
      routeAbortRef.current = controller;
      try {
        const polylines: [number, number][][] = [];
        const allLegs: RouteSegment[] = [];
        for (const leg of visibleLegRequests) {
          const run = [leg.from, leg.to];
          try {
            const result = await calculateRouteWithLegs(run, { signal: controller.signal, profile });
            polylines.push(
              result.coordinates.length >= 2 ? result.coordinates : run.map((point) => [point.lat, point.lng] as [number, number])
            );
            allLegs.push(...result.legs);
          } catch (err) {
            if (err instanceof Error && err.name === 'AbortError') throw err;
            polylines.push(run.map((point) => [point.lat, point.lng] as [number, number]));
          }
        }
        if (!controller.signal.aborted) {
          setRoute(polylines);
          setRouteSegments(allLegs);
        }
      } catch (err: unknown) {
        if (!(err instanceof Error) || err.name !== 'AbortError') setRouteSegments([]);
      }
    },
    [
      enabled,
      profile,
      accommodations,
      optimizeFromAccommodation,
      distanceUnit,
      visibleDayRouteIds,
      visibleAssignmentRouteIds,
      categories,
    ]
  );

  // Stable signatures so route recalc fires when any visible/all-day route input changes.
  const assignmentsSignature = useMemo(
    () =>
      Object.entries(tripStore.assignments || {})
        .flatMap(([dayId, dayAssignments]) =>
          (dayAssignments || []).map((assignment) => {
            const place = assignment.place;
            return [
              dayId,
              assignment.id,
              assignment.order_index,
              place?.id ?? '',
              place?.category_id ?? '',
              place?.lat ?? '',
              place?.lng ?? '',
            ].join(':');
          })
        )
        .sort()
        .join('|'),
    [tripStore.assignments]
  );
  const transportSignature = useMemo(() => {
    return reservationsForSignature
      .filter((r) => TRANSPORT_TYPES.includes(r.type))
      .map((r) => {
        const positions = Object.entries(r.day_positions || {})
          .map(([dayId, pos]) => `${dayId}:${pos}`)
          .sort()
          .join(',');
        // Include endpoints so adding/moving a departure/arrival location re-routes.
        const eps = (r.endpoints || []).map((e) => `${e.role}@${e.lat ?? ''},${e.lng ?? ''}`).join(';');
        return `${r.id}:${r.day_id ?? ''}:${r.end_day_id ?? ''}:${r.reservation_time ?? ''}:${r.day_plan_position ?? ''}:${positions}:${eps}`;
      })
      .sort()
      .join('|');
  }, [reservationsForSignature]);

  useEffect(() => {
    updateRouteForDay(selectedDayId);
  }, [assignmentsSignature, selectedDayId, transportSignature, updateRouteForDay]);

  return { route, routeSegments, routeInfo, setRoute, setRouteInfo, updateRouteForDay, routeableAssignmentRouteIds };
}
