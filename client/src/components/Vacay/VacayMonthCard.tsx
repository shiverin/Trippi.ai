import { useMemo } from 'react';
import { useTranslation } from '../../i18n';

const WEEKDAY_KEYS = [
  'vacay.mon',
  'vacay.tue',
  'vacay.wed',
  'vacay.thu',
  'vacay.fri',
  'vacay.sat',
  'vacay.sun',
] as const;

interface VacayMonthCardProps {
  year: number;
  month: number;
  tripDates?: Set<string>;
  weekStart?: number;
}

export default function VacayMonthCard({
  year,
  month,
  tripDates,
  weekStart = 1,
}: VacayMonthCardProps) {
  const { t, locale } = useTranslation();

  const WEEKDAY_KEYS_SUNDAY = [
    'vacay.sun',
    'vacay.mon',
    'vacay.tue',
    'vacay.wed',
    'vacay.thu',
    'vacay.fri',
    'vacay.sat',
  ] as const;
  const orderedKeys = weekStart === 0 ? WEEKDAY_KEYS_SUNDAY : WEEKDAY_KEYS;
  const weekdays = orderedKeys.map((k) => t(k));
  const monthName = useMemo(
    () => new Intl.DateTimeFormat(locale, { month: 'long' }).format(new Date(year, month, 1)),
    [locale, year, month]
  );

  const weeks = useMemo(() => {
    const firstDay = new Date(year, month, 1);
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    let startDow = firstDay.getDay() - weekStart;
    if (startDow < 0) startDow += 7;
    const cells = [];
    for (let i = 0; i < startDow; i++) cells.push(null);
    for (let d = 1; d <= daysInMonth; d++) cells.push(d);
    while (cells.length % 7 !== 0) cells.push(null);
    const w = [];
    for (let i = 0; i < cells.length; i += 7) w.push(cells.slice(i, i + 7));
    return w;
  }, [year, month, weekStart]);

  const pad = (n) => String(n).padStart(2, '0');

  const todayStr = useMemo(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }, []);

  return (
    <div className="overflow-hidden rounded-xl border border-edge bg-surface-card">
      <div className="border-b border-edge-secondary px-3 py-2">
        <span className="text-xs font-semibold capitalize text-content">{monthName}</span>
      </div>

      <div className="grid grid-cols-7 border-b border-edge-secondary">
        {weekdays.map((wd, i) => {
          // Map column index back to JS day (0=Sun..6=Sat) to check if it's a weekend column
          const jsDay = (i + weekStart) % 7;
          const isWeekendCol = [0, 6].includes(jsDay);
          return (
            <div
              key={`${wd}-${i}`}
              className={`py-1 text-center text-[10px] font-medium ${isWeekendCol ? 'text-content-faint' : 'text-content-muted'}`}
            >
              {wd}
            </div>
          );
        })}
      </div>

      <div>
        {weeks.map((week, wi) => (
          <div key={wi} className="grid grid-cols-7">
            {week.map((day, di) => {
              if (day === null) return <div key={di} style={{ height: 28 }} />;

              const dateStr = `${year}-${pad(month + 1)}-${pad(day)}`;
              const dayOfWeek = new Date(year, month, day).getDay();
              const weekend = [0, 6].includes(dayOfWeek);
              const isTripDay = tripDates?.has(dateStr) ?? false;
              const isToday = dateStr === todayStr;

              return (
                <div
                  key={di}
                  title={isTripDay ? 'Trip day' : undefined}
                  className="relative flex items-center justify-center"
                  style={{
                    height: 28,
                    background: weekend ? 'var(--bg-secondary)' : 'transparent',
                    borderTop: '1px solid var(--border-secondary)',
                    borderRight: '1px solid var(--border-secondary)',
                    cursor: 'default',
                  }}
                >
                  {isTripDay && (
                    <div className="absolute inset-0.5 rounded bg-[#3b82f6]" style={{ opacity: 0.82 }} />
                  )}

                  <span
                    className="relative z-[1] text-[11px]"
                    style={{
                      fontWeight: isTripDay ? 700 : 500,
                      color: isTripDay || isToday ? '#fff' : weekend ? 'var(--text-faint)' : 'var(--text-primary)',
                      ...(isToday
                        ? {
                            display: 'inline-flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            width: 18,
                            height: 18,
                            borderRadius: '50%',
                            background: isTripDay ? 'rgba(15,23,42,0.35)' : '#3b82f6',
                          }
                        : {}),
                    }}
                  >
                    {day}
                  </span>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
