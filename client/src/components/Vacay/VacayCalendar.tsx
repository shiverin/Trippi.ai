import { Building2, MousePointer2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { tripsApi } from '../../api/client';
import { useTranslation } from '../../i18n';
import { useVacayStore } from '../../store/vacayStore';
import { isWeekend } from './holidays';
import VacayMonthCard from './VacayMonthCard';

export default function VacayCalendar() {
  const { t } = useTranslation();
  const {
    selectedYear,
    selectedUserId,
    entries,
    companyHolidays,
    toggleEntry,
    toggleCompanyHoliday,
    plan,
    users,
    holidays,
  } = useVacayStore();
  const [companyMode, setCompanyMode] = useState(false);
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

  const companyHolidaySet = useMemo(() => {
    const s = new Set<string>();
    companyHolidays.forEach((h) => s.add(h.date));
    return s;
  }, [companyHolidays]);

  const entryMap = useMemo(() => {
    const map = {};
    entries.forEach((e) => {
      if (!map[e.date]) map[e.date] = [];
      map[e.date].push(e);
    });
    return map;
  }, [entries]);

  const blockWeekends = plan?.block_weekends !== false;
  const weekendDays: number[] = plan?.weekend_days ? String(plan.weekend_days).split(',').map(Number) : [0, 6];
  const companyHolidaysEnabled = plan?.company_holidays_enabled !== false;

  const handleCellClick = useCallback(
    async (dateStr) => {
      if (companyMode) {
        if (!companyHolidaysEnabled) return;
        await toggleCompanyHoliday(dateStr);
        return;
      }
      if (blockWeekends && isWeekend(dateStr, weekendDays)) return;
      if (companyHolidaysEnabled && companyHolidaySet.has(dateStr)) return;
      await toggleEntry(dateStr, selectedUserId || undefined);
    },
    [
      companyMode,
      toggleEntry,
      toggleCompanyHoliday,
      companyHolidaySet,
      blockWeekends,
      companyHolidaysEnabled,
      selectedUserId,
    ]
  );

  const selectedUser = users.find((u) => u.id === selectedUserId);

  return (
    <div>
      <div
        className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
        style={{ paddingBottom: 'calc(var(--bottom-nav-h, 0px) + 80px)' }}
      >
        {Array.from({ length: 12 }, (_, i) => (
          <VacayMonthCard
            key={i}
            year={selectedYear}
            month={i}
            holidays={holidays}
            companyHolidaySet={companyHolidaySet}
            companyHolidaysEnabled={companyHolidaysEnabled}
            entryMap={entryMap}
            onCellClick={handleCellClick}
            companyMode={companyMode}
            blockWeekends={blockWeekends}
            weekendDays={weekendDays}
            tripDates={tripDates}
            weekStart={plan?.week_start ?? 1}
          />
        ))}
      </div>

      {/* Floating toolbar — lift above the mobile bottom nav (z-60). On desktop --bottom-nav-h is 0px. */}
      <div
        className="sticky mt-3 flex items-center justify-center px-2 sm:mt-4"
        style={{ bottom: 'calc(var(--bottom-nav-h, 0px) + 12px)', zIndex: 61 }}
      >
        <div
          className="flex items-center gap-1.5 rounded-xl border border-edge bg-surface-card px-2 py-1.5 sm:gap-2 sm:px-3 sm:py-2"
          style={{ boxShadow: '0 8px 32px rgba(0,0,0,0.12)' }}
        >
          <button
            onClick={() => setCompanyMode(false)}
            className={`flex items-center gap-1 rounded-lg border px-2 py-1.5 text-[11px] font-medium transition-[background-color,color,border-color] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] sm:gap-1.5 sm:px-3 sm:text-xs ${!companyMode ? 'border-transparent bg-content text-surface-card' : 'border-edge bg-transparent text-content-muted'}`}
          >
            <MousePointer2 size={13} />
            {selectedUser && (
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: selectedUser.color }} />
            )}
            {selectedUser ? selectedUser.username : t('vacay.modeVacation')}
          </button>
          {companyHolidaysEnabled && (
            <button
              onClick={() => setCompanyMode(true)}
              className={`flex items-center gap-1 rounded-lg border px-2 py-1.5 text-[11px] font-medium transition-[background-color,color,border-color] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] sm:gap-1.5 sm:px-3 sm:text-xs ${companyMode ? 'border-transparent bg-[#d97706] text-[#fff]' : 'border-edge bg-transparent text-content-muted'}`}
            >
              <Building2 size={13} />
              {t('vacay.modeCompany')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
