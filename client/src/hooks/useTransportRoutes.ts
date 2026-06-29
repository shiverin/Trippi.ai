import type { MapsTransportRouteResult } from '@trippi/shared';
import { useEffect, useMemo, useState } from 'react';
import { mapsApi } from '../api/client';
import type { Reservation } from '../types';

export type TransportRouteMap = Record<number, MapsTransportRouteResult | undefined>;

const ROUTABLE_TRANSPORT_TYPES = new Set(['train', 'bus', 'subway', 'car', 'taxi', 'bicycle', 'transport_other']);
const routeCache = new Map<string, MapsTransportRouteResult>();

function endpointSignature(reservation: Reservation): string {
  return (reservation.endpoints || [])
    .slice()
    .sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0))
    .map((e) => `${e.role}:${e.sequence}:${e.lat},${e.lng}:${e.local_date ?? ''}:${e.local_time ?? ''}`)
    .join('|');
}

function cacheKey(tripId: number | string, reservation: Reservation): string {
  return `${tripId}:${reservation.id}:${reservation.type}:${endpointSignature(reservation)}`;
}

export function useTransportRoutes(
  tripId: number | string | null | undefined,
  reservations: Reservation[],
  visibleConnectionIds: number[]
): TransportRouteMap {
  const candidates = useMemo(() => {
    if (!tripId || !visibleConnectionIds.length) return [];
    const visible = new Set(visibleConnectionIds);
    return reservations
      .filter((r) => visible.has(r.id))
      .filter((r) => ROUTABLE_TRANSPORT_TYPES.has(r.type))
      .filter((r) => (r.endpoints || []).length >= 2)
      .map((reservation) => ({ reservation, key: cacheKey(tripId, reservation) }));
  }, [tripId, reservations, visibleConnectionIds]);

  const signature = useMemo(() => candidates.map((c) => c.key).join('||'), [candidates]);
  const [routes, setRoutes] = useState<TransportRouteMap>({});

  useEffect(() => {
    if (!tripId || candidates.length === 0) {
      setRoutes({});
      return;
    }

    const controller = new AbortController();
    const cached: TransportRouteMap = {};
    const missing = candidates.filter(({ reservation, key }) => {
      const hit = routeCache.get(key);
      if (hit) {
        cached[reservation.id] = hit;
        return false;
      }
      return true;
    });
    setRoutes(cached);

    for (const { reservation, key } of missing) {
      mapsApi
        .transportRoute(tripId, reservation.id, controller.signal)
        .then((route) => {
          if (controller.signal.aborted) return;
          routeCache.set(key, route);
          setRoutes((prev) => ({ ...prev, [reservation.id]: route }));
        })
        .catch((err) => {
          if (controller.signal.aborted) return;
          if (err instanceof Error && err.name === 'CanceledError') return;
          // Existing map fallback geometry still renders when provider fetching fails.
        });
    }

    return () => controller.abort();
  }, [tripId, signature]); // eslint-disable-line react-hooks/exhaustive-deps

  return routes;
}
