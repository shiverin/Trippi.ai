import { useEffect, useState } from 'react';
import { tripsApi } from '../../api/client';
import VacayMonthCard from './VacayMonthCard';

interface VacayCalendarProps {
  selectedYear: number;
}

export default function VacayCalendar({ selectedYear }: VacayCalendarProps) {
  const [tripDates, setTripDates] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await tripsApi.list();
        const dates = new Set<string>();
        for (const trip of data.trips || []) {
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
