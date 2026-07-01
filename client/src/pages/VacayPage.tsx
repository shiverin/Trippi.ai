import { CalendarDays, ChevronLeft, ChevronRight, SlidersHorizontal } from 'lucide-react';
import React from 'react';
import ReactDOM from 'react-dom';
import PageShell from '../components/Layout/PageShell';
import VacayCalendar from '../components/Vacay/VacayCalendar';
import { useTranslation } from '../i18n';
import { useVacay } from './vacay/useVacay';

export default function VacayPage(): React.ReactElement {
  const { t } = useTranslation();
  // Page = wiring container: vacay store, live sync + UI state live in the hook.
  const {
    years,
    selectedYear,
    setSelectedYear,
  } = useVacay();
  const [showMobileSidebar, setShowMobileSidebar] = React.useState<boolean>(false);

  const selectedYearIndex = years.indexOf(selectedYear);
  const sidebarContent = (
    <div className="rounded-xl border border-edge bg-surface-card p-3">
      <div className="mb-2 flex items-center">
        <span className="text-[11px] font-medium uppercase tracking-wider text-content-faint">{t('vacay.year')}</span>
      </div>
      <div className="mb-2 flex items-center justify-between">
        <button
          onClick={() => {
            if (selectedYearIndex > 0) setSelectedYear(years[selectedYearIndex - 1]);
          }}
          disabled={selectedYearIndex <= 0}
          className="rounded-lg bg-surface-secondary p-1 transition-colors disabled:opacity-20"
          aria-label="Previous year"
        >
          <ChevronLeft size={16} className="text-content-muted" />
        </button>
        <span className="text-xl font-bold tabular-nums text-content">{selectedYear}</span>
        <button
          onClick={() => {
            if (selectedYearIndex < years.length - 1) setSelectedYear(years[selectedYearIndex + 1]);
          }}
          disabled={selectedYearIndex >= years.length - 1}
          className="rounded-lg bg-surface-secondary p-1 transition-colors disabled:opacity-20"
          aria-label="Next year"
        >
          <ChevronRight size={16} className="text-content-muted" />
        </button>
      </div>
      <div className="grid grid-cols-3 gap-1">
        {years.map((y) => (
          <button
            key={y}
            onClick={() => setSelectedYear(y)}
            className={`rounded-lg py-1.5 text-center text-xs font-medium transition-[background-color,color] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] ${y === selectedYear ? 'bg-content text-surface-card' : 'bg-surface-secondary text-content-muted'}`}
          >
            {y}
          </button>
        ))}
      </div>
      <div className="mt-3 border-t border-edge-secondary pt-3">
        <span className="text-[11px] font-medium uppercase tracking-wider text-content-faint">
          {t('vacay.legend')}
        </span>
        <div className="mt-2 flex items-center gap-2">
          <span className="h-3 w-4 rounded bg-[#3b82f6]" />
          <span className="text-[11px] text-content-muted">Trip day</span>
        </div>
      </div>
    </div>
  );

  return (
    <PageShell background="var(--bg-primary)">
      <div className="mx-auto max-w-[1800px] px-3 py-4 sm:px-4 sm:py-6">
        {/* Mobile + tablet header (filter toggle lives here) */}
        <div className="mb-4 flex items-center justify-between lg:hidden">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-surface-secondary">
              <CalendarDays size={18} className="text-content" />
            </div>
            <h1 className="text-lg font-bold text-content">{t('admin.addons.catalog.vacay.name')}</h1>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowMobileSidebar(true)}
              className="flex items-center gap-1.5 rounded-lg bg-surface-secondary px-3 py-1.5 text-sm text-content-muted transition-colors lg:hidden"
              aria-label="Year selector"
            >
              <SlidersHorizontal size={14} />
            </button>
          </div>
        </div>

        {/* Desktop header — unified toolbar (sidebar is always visible at this width) */}
        <div className="hidden lg:block" style={{ marginBottom: 20 }}>
          <div
            className="border border-edge bg-surface-tertiary"
            style={{
              borderRadius: 18,
              boxShadow: '0 1px 3px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04)',
              padding: '14px 16px 14px 22px',
              display: 'flex',
              alignItems: 'center',
              gap: 16,
              flexWrap: 'wrap',
            }}
          >
            <h2
              className="text-content"
              style={{ margin: 0, fontSize: 18, fontWeight: 600, letterSpacing: '-0.01em', flexShrink: 0 }}
            >
              {t('admin.addons.catalog.vacay.name')}
            </h2>
            <div className="bg-edge-faint" style={{ width: 1, height: 22, flexShrink: 0 }} />
            <span className="text-content-muted" style={{ fontSize: 13 }}>
              Trip dates dashboard
            </span>
          </div>
        </div>

        {/* Main layout */}
        <div className="flex items-start gap-4">
          {/* Desktop Sidebar */}
          <div className="sticky top-[70px] hidden w-[240px] shrink-0 flex-col gap-3 lg:flex">{sidebarContent}</div>

          {/* Calendar */}
          <div className="min-w-0 flex-1">
            <VacayCalendar selectedYear={selectedYear} />
          </div>
        </div>
      </div>

      {/* Mobile Sidebar Drawer */}
      {showMobileSidebar &&
        ReactDOM.createPortal(
          <div className="fixed inset-0 lg:hidden" style={{ zIndex: 99980 }}>
            <div className="absolute inset-0 bg-[rgba(0,0,0,0.4)]" onClick={() => setShowMobileSidebar(false)} />
            <div
              className="absolute bottom-0 left-0 top-0 flex w-[280px] flex-col gap-3 overflow-y-auto bg-surface p-3"
              style={{ boxShadow: '4px 0 24px rgba(0,0,0,0.15)', animation: 'slideInLeft 0.2s ease-out' }}
            >
              {sidebarContent}
            </div>
          </div>,
          document.body
        )}

      <style>{`
        @keyframes slideInLeft {
          from { transform: translateX(-100%); }
          to { transform: translateX(0); }
        }
      `}</style>
    </PageShell>
  );
}
