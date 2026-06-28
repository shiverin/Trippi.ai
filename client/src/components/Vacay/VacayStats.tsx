import { Briefcase, Pencil } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from '../../i18n';
import { useAuthStore } from '../../store/authStore';
import { useVacayStore } from '../../store/vacayStore';
import type { TranslationFn, VacayStat } from '../../types';

export default function VacayStats() {
  const { t } = useTranslation();
  const { stats, selectedYear, loadStats, updateVacationDays, isFused } = useVacayStore();
  const { user: currentUser } = useAuthStore();

  useEffect(() => {
    loadStats(selectedYear);
  }, [selectedYear]);

  return (
    <div className="rounded-xl border border-edge bg-surface-card p-3">
      <div className="mb-3 flex items-center gap-1.5">
        <Briefcase size={13} className="text-content-faint" />
        <span className="text-[11px] font-medium uppercase tracking-wider text-content-faint">
          {t('vacay.entitlement')} {selectedYear}
        </span>
      </div>

      {stats.length === 0 ? (
        <p className="py-3 text-center text-[11px] text-content-faint">{t('vacay.noData')}</p>
      ) : (
        <div className="space-y-2">
          {stats.map((s) => (
            <StatCard
              key={s.user_id}
              stat={s}
              isMe={s.user_id === currentUser?.id}
              canEdit={s.user_id === currentUser?.id || isFused}
              selectedYear={selectedYear}
              onSave={updateVacationDays}
              t={t}
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface StatCardProps {
  stat: VacayStat;
  isMe: boolean;
  canEdit: boolean;
  selectedYear: number;
  onSave: (userId: number, year: number, days: number) => Promise<void>;
  t: TranslationFn;
}

function StatCard({ stat: s, isMe, canEdit, selectedYear, onSave, t }: StatCardProps) {
  const [editing, setEditing] = useState(false);
  // Holds the entitlement-day value while editing: a number on load, a string
  // once the user types into the number input.
  const [localDays, setLocalDays] = useState<number | string>(s.vacation_days);
  const pct = s.total_available > 0 ? Math.min(100, (s.used / s.total_available) * 100) : 0;

  // Sync local state when stats reload from server
  useEffect(() => {
    if (!editing) setLocalDays(s.vacation_days);
  }, [s.vacation_days, editing]);

  const handleSave = () => {
    setEditing(false);
    const days = parseInt(String(localDays));
    if (!isNaN(days) && days >= 0 && days <= 365 && days !== s.vacation_days) {
      onSave(selectedYear, days, s.user_id);
    }
  };

  return (
    <div className="space-y-2 rounded-lg border border-edge-secondary p-2.5">
      <div className="flex items-center gap-2">
        <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: s.person_color }} />
        <span className="flex-1 truncate text-xs font-semibold text-content">
          {s.person_name}
          {isMe && <span className="text-content-faint"> ({t('vacay.you')})</span>}
        </span>
        <span className="text-[10px] tabular-nums text-content-faint">
          {s.used}/{s.total_available}
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-surface-secondary">
        <div
          className="trippi-bar-fill h-full rounded-full transition-[width] duration-500 ease-[cubic-bezier(0.23,1,0.32,1)]"
          style={{ width: `${pct}%`, backgroundColor: s.person_color }}
        />
      </div>
      <div className="grid grid-cols-3 gap-1.5">
        {/* Days — editable */}
        <div
          className={`group/days rounded-md border px-2 py-2 ${canEdit ? 'border-edge bg-surface-card' : 'border-transparent bg-surface-secondary'}`}
          style={{
            cursor: canEdit ? 'pointer' : 'default',
          }}
          onClick={() => {
            if (canEdit && !editing) setEditing(true);
          }}
        >
          <div className="mb-1 text-[10px] text-content-faint" style={{ height: 14, lineHeight: '14px' }}>
            {t('vacay.entitlementDays')}{' '}
            {canEdit && !editing && (
              <Pencil
                size={9}
                className="inline text-content-faint opacity-0 transition-opacity group-hover/days:opacity-100"
                style={{ verticalAlign: 'middle' }}
              />
            )}
          </div>
          {editing ? (
            <input
              type="number"
              value={localDays}
              onChange={(e) => setLocalDays(e.target.value)}
              onBlur={handleSave}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSave();
                if (e.key === 'Escape') {
                  setEditing(false);
                  setLocalDays(s.vacation_days);
                }
              }}
              autoFocus
              className="m-0 w-full bg-transparent p-0 text-sm font-bold text-content outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
              style={{ height: 18, lineHeight: '18px' }}
            />
          ) : (
            <div className="text-sm font-bold text-content" style={{ height: 18, lineHeight: '18px' }}>
              {s.vacation_days}
            </div>
          )}
        </div>
        {/* Used */}
        <div className="rounded-md bg-surface-secondary px-2 py-2">
          <div className="mb-1 text-[10px] text-content-faint" style={{ height: 14, lineHeight: '14px' }}>
            {t('vacay.used')}
          </div>
          <div className="text-sm font-bold text-content" style={{ height: 18, lineHeight: '18px' }}>
            {s.used}
          </div>
        </div>
        {/* Remaining */}
        <div className="rounded-md bg-surface-secondary px-2 py-2">
          <div className="mb-1 text-[10px] text-content-faint" style={{ height: 14, lineHeight: '14px' }}>
            {t('vacay.remaining')}
          </div>
          <div
            className="text-sm font-bold"
            style={{
              color: s.remaining < 0 ? '#ef4444' : s.remaining <= 3 ? '#f59e0b' : '#22c55e',
              height: 18,
              lineHeight: '18px',
            }}
          >
            {s.remaining}
          </div>
        </div>
      </div>
      {s.carried_over > 0 && (
        <div className="flex items-center gap-1.5 rounded-md border border-[rgba(245,158,11,0.15)] bg-[rgba(245,158,11,0.08)] px-2 py-1">
          <span className="text-[10px] text-[#d97706]">
            +{s.carried_over} {t('vacay.carriedOver', { year: selectedYear - 1 })}
          </span>
        </div>
      )}
    </div>
  );
}
