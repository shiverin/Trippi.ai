import { useEffect, useState } from 'react';
import { tripsApi } from '../../api/client';
import VacayMonthCard from './VacayMonthCard';

interface VacayCalendarProps {
  selectedYear: number;
}

interface TripDateSource {
  start_date?: string | null;
  end_date?: string | null;
}

let tripListCache: TripDateSource[] | null = null;
let tripListFetchedAt = 0;
let tripListPromise: Promise<TripDateSource[]> | null = null;
const TRIP_LIST_CACHE_TTL_MS = 30_000;

async function loadTripListOnce(): Promise<TripDateSource[]> {
  if (tripListCache && Date.now() - tripListFetchedAt < TRIP_LIST_CACHE_TTL_MS) return tripListCache;
  if (!tripListPromise) {
    tripListPromise = tripsApi
      .list()
      .then((data) => {
        tripListCache = data.trips || [];
        tripListFetchedAt = Date.now();
        return tripListCache;
      })
      .finally(() => {
        tripListPromise = null;
      });
  }
  return tripListPromise;
}

function tripDatesForYear(trips: TripDateSource[], selectedYear: number): Set<string> {
  const dates = new Set<string>();
  for (const trip of trips) {
    if (!trip.start_date || !trip.end_date) continue;
    const start = new Date(trip.start_date + 'T00:00:00');
    const end = new Date(trip.end_date + 'T00:00:00');
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const y = d.getFullYear();
      if (y === selectedYear) {
        dates.add(`${y}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
      }
    }
  }
  return dates;
}

export default function VacayCalendar({ selectedYear }: VacayCalendarProps) {
  const [tripDates, setTripDates] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    if (tripListCache) {
      setTripDates(tripDatesForYear(tripListCache, selectedYear));
    }
    (async () => {
      try {
        const trips = await loadTripListOnce();
        const dates = tripDatesForYear(trips, selectedYear);
        if (!cancelled) setTripDates(dates);
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedYear]);

  return (
    <div
      className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
      style={{ paddingBottom: 'calc(var(--bottom-nav-h, 0px) + 24px)' }}
    >
      {Array.from({ length: 12 }, (_, i) => (
        <VacayMonthCard key={i} year={selectedYear} month={i} tripDates={tripDates} />
      ))}
    </div>
  );
}
