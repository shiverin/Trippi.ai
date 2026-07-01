import {
  Archive,
  AlertCircle,
  ArrowRight,
  Calendar,
  Check,
  Clock,
  Copy,
  Edit2,
  Hotel,
  LayoutGrid,
  List,
  ListTodo,
  Lock,
  MapPin,
  Plane,
  Plus,
  RefreshCw,
  Ticket,
  Trash2,
  Utensils,
  X,
} from 'lucide-react';
import React, { useEffect, useState } from 'react';
import { referralsApi } from '../api/client';
import UpgradePlansModal from '../components/Billing/UpgradePlansModal';
import DemoBanner from '../components/Layout/DemoBanner';
import MobileTopBar from '../components/Layout/MobileTopBar';
import Navbar from '../components/Layout/Navbar';
import TripFormModal from '../components/Trips/TripFormModal';
import ConfirmDialog from '../components/shared/ConfirmDialog';
import CopyTripDialog from '../components/shared/CopyTripDialog';
import PlaceAvatar from '../components/shared/PlaceAvatar';
import { LockedState } from '../components/shared/PremiumGate';
import { useToast } from '../components/shared/Toast';
import { formatLimit, isLimitReached, useEntitlements } from '../hooks/useEntitlements';
import { useTranslation } from '../i18n';
import { useSettingsStore } from '../store/settingsStore';
import '../styles/dashboard.css';
import { formatTime, splitReservationDateTime } from '../utils/formatters';
import { resolveMediaUrl } from '../utils/mediaUrl';
import {
  type DashboardTrip,
  type DashboardTodo,
  type HeroBundle,
  type UpcomingReservation,
  MS_PER_DAY,
  daysUntil,
  getTripStatus,
} from './dashboard/dashboardModel';
import { useDashboard } from './dashboard/useDashboard';
import type { ReferralExpiryWarning } from '../types';

const GRADIENTS = [
  'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
  'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)',
  'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)',
  'linear-gradient(135deg, #43e97b 0%, #38f9d7 100%)',
  'linear-gradient(135deg, #fa709a 0%, #fee140 100%)',
  'linear-gradient(135deg, #a18cd1 0%, #fbc2eb 100%)',
  'linear-gradient(135deg, #ffecd2 0%, #fcb69f 100%)',
  'linear-gradient(135deg, #96fbc4 0%, #f9f586 100%)',
];
function tripGradient(id: number): string {
  return GRADIENTS[id % GRADIENTS.length];
}

// Day + short month for the boarding pass / cards, e.g. { d: '10', m: 'Sep' }.
function splitDate(dateStr: string | null | undefined, locale: string): { d: string; m: string } | null {
  if (!dateStr) return null;
  const date = new Date(dateStr + 'T00:00:00Z');
  if (isNaN(date.getTime())) return null; // malformed date — render a dash, never crash
  return {
    d: date.toLocaleDateString(locale, { day: 'numeric', timeZone: 'UTC' }),
    m: date.toLocaleDateString(locale, { month: 'short', timeZone: 'UTC' }),
  };
}

function buddyColor(seed: number): string {
  const pairs = [
    ['#6366f1', '#8b5cf6'],
    ['#10b981', '#059669'],
    ['#f59e0b', '#d97706'],
    ['#ec4899', '#be185d'],
    ['#0ea5e9', '#2563eb'],
    ['#14b8a6', '#0d9488'],
  ];
  const [a, b] = pairs[seed % pairs.length];
  return `linear-gradient(135deg, ${a}, ${b})`;
}

function initials(name: string | null | undefined): string {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

const RES_ICON: Record<string, React.ReactElement> = {
  flight: <Plane size={16} />,
  hotel: <Hotel size={16} />,
  restaurant: <Utensils size={16} />,
};
const RES_TYPE_CLASS: Record<string, string> = { flight: 'flight', hotel: 'hotel', restaurant: 'food' };

// Mobile gets a different boarding-pass treatment (separate card under the hero).
function useIsMobile(): boolean {
  const [mobile, setMobile] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(max-width: 720px)').matches
  );
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 720px)');
    const onChange = () => setMobile(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return mobile;
}

export default function DashboardPage(): React.ReactElement {
  // Page = wiring container: all state, data loading and mutations live in the
  // useDashboard data hook; this component only renders what it returns.
  const {
    demoMode,
    locale,
    t,
    navigate,
    spotlight,
    heroBundle,
    upcoming,
    pendingTodos,
    gridTrips,
    ownedLifetimeTripCount,
    isLoading,
    loadError,
    retryLoad,
    tripFilter,
    setTripFilter,
    viewMode,
    toggleViewMode,
    showForm,
    setShowForm,
    editingTrip,
    setEditingTrip,
    deleteTrip,
    setDeleteTrip,
    copyTrip,
    setCopyTrip,
    setTrips,
    handleCreate,
    handleUpdate,
    confirmDelete,
    handleArchive,
    handleUnarchive,
    confirmCopy,
    completeDashboardTodo,
    overlaysDisabled,
  } = useDashboard();
  const toast = useToast();
  const entitlementState = useEntitlements();
  const lifetimeTripLimit = entitlementState.entitlements?.limits.activeTrips;
  const lifetimeTripLocked = isLimitReached(lifetimeTripLimit, ownedLifetimeTripCount);
  const [upgradePlansOpen, setUpgradePlansOpen] = useState(false);
  const [expiryWarning, setExpiryWarning] = useState<ReferralExpiryWarning | null>(null);

  const openCreateTrip = () => {
    if (lifetimeTripLocked) return;
    setEditingTrip(null);
    setShowForm(true);
  };

  const startUpgrade = (planId?: string) => {
    entitlementState.startUpgrade(planId).catch((err) => {
      toast.info(err instanceof Error ? err.message : 'Upgrade checkout is not available yet.');
    });
  };

  const openUpgradePlans = () => setUpgradePlansOpen(true);

  const openTripEdit = (trip: DashboardTrip) => {
    if (trip.edit_locked) {
      openUpgradePlans();
      return;
    }
    setEditingTrip(trip);
    setShowForm(true);
  };

  useEffect(() => {
    if (overlaysDisabled) return;
    referralsApi
      .expiryWarning()
      .then((warning) => {
        if (warning.show) setExpiryWarning(warning);
      })
      .catch(() => {});
  }, [overlaysDisabled]);

  const dismissExpiryWarning = () => {
    const activeUntil = expiryWarning?.active_until;
    setExpiryWarning(null);
    if (activeUntil) referralsApi.dismissExpiryWarning(activeUntil).catch(() => {});
  };

  useEffect(() => {
    void import('./TripPlannerPage');
  }, []);

  const openDashboardTodo = (todo: DashboardTodo) => {
    sessionStorage.setItem(`trip-tab-${todo.trip_id}`, 'listen');
    sessionStorage.setItem(`trip-lists-subtab-${todo.trip_id}`, 'todo');
    navigate(`/trips/${todo.trip_id}`);
  };

  return (
    <>
      {/* Navbar lives outside .trippi-dash so it keeps the app-wide font + button
          styling instead of inheriting the dashboard scope's font and the
          `.trippi-dash button` reset (which shifted the bell icon + menu items). */}
      <Navbar />
      <div className="trippi-dash trek-dash trek-dash-shell">
        {demoMode && !overlaysDisabled && <DemoBanner />}
        <div className="trek-dash-scroll">
          <MobileTopBar />
          <main className="page">
            <div className="page-main">
              {loadError && (
                <div className="dash-error" role="alert">
                  <span className="dash-error-txt">{t('dashboard.loadErrorBanner')}</span>
                  <button className="dash-error-retry" onClick={retryLoad}>
                    <RefreshCw size={15} />
                    {t('dashboard.retry')}
                  </button>
                </div>
              )}
              {spotlight && (
                <div className="spotlight-stack">
                  <BoardingPassHero
                    trip={spotlight}
                    bundle={heroBundle}
                    locale={locale}
                    onOpen={() => navigate(`/trips/${spotlight.id}`)}
                    onEdit={() => openTripEdit(spotlight)}
                    onCopy={() => setCopyTrip(spotlight)}
                    onArchive={() =>
                      spotlight.is_archived ? handleUnarchive(spotlight.id) : handleArchive(spotlight.id)
                    }
                    onDelete={() => setDeleteTrip(spotlight)}
                  />
                </div>
              )}
              <section className="trips-section">
                <div className="sec-head">
                  <h3 className="sec-title">{t('dashboard.title')}</h3>
                  <div className="sec-tools">
                    <div className="seg">
                      <button className={tripFilter === 'planned' ? 'on' : ''} onClick={() => setTripFilter('planned')}>
                        {t('dashboard.filter.planned')}
                      </button>
                      <button className={tripFilter === 'archive' ? 'on' : ''} onClick={() => setTripFilter('archive')}>
                        {t('dashboard.archived')}
                      </button>
                      <button
                        className={tripFilter === 'completed' ? 'on' : ''}
                        onClick={() => setTripFilter('completed')}
                      >
                        {t('dashboard.mobile.completed')}
                      </button>
                    </div>
                    <button
                      className="tool-action"
                      aria-label={t('dashboard.aria.toggleView')}
                      onClick={toggleViewMode}
                      style={{ width: 38, height: 38, borderRadius: 11 }}
                    >
                      {viewMode === 'grid' ? <List size={17} /> : <LayoutGrid size={17} />}
                    </button>
                  </div>
                </div>

                {gridTrips.length === 0 && !isLoading && !loadError && (
                  <div className="trips-empty">
                    <h4>{t('dashboard.emptyTitle')}</h4>
                    <p>{t('dashboard.emptyText')}</p>
                  </div>
                )}

                <div className={`trips${viewMode === 'list' ? ' list-view' : ''}`}>
                  {gridTrips.map((trip) => (
                    <TripCard
                      key={trip.id}
                      trip={trip}
                      locale={locale}
                      onOpen={() => navigate(`/trips/${trip.id}`)}
                      onEdit={() => openTripEdit(trip)}
                      onCopy={() => setCopyTrip(trip)}
                      onArchive={() => (trip.is_archived ? handleUnarchive(trip.id) : handleArchive(trip.id))}
                      onDelete={() => setDeleteTrip(trip)}
                    />
                  ))}
                  {!isLoading &&
                    (tripFilter === 'planned' || gridTrips.length === 0) &&
                    (lifetimeTripLocked ? (
                      <div className="add-trip-card is-locked">
                        <LockedState
                          compact
                          title="Trip limit reached"
                          detail={`${ownedLifetimeTripCount}/${formatLimit(lifetimeTripLimit)} lifetime`}
                          description={`Your ${entitlementState.entitlements?.planKey ?? 'current'} plan includes this many trips for the lifetime of the account.`}
                          upgradeAvailable={!!entitlementState.billing?.checkoutAvailable}
                          upgradePending={entitlementState.checkoutLoading}
                          onUpgrade={openUpgradePlans}
                          testId="active-trip-locked-state"
                        />
                      </div>
                    ) : (
                      <button className="add-trip-card" onClick={openCreateTrip}>
                        <div>
                          <div className="circ">
                            <Plus size={20} />
                          </div>
                          <div className="ttl">{t('dashboard.newTrip')}</div>
                          <div className="sub">{t('dashboard.newTripSub')}</div>
                        </div>
                      </button>
                    ))}
                </div>
              </section>
            </div>

            <aside className="page-sidebar">
              <UpcomingTool items={upcoming} locale={locale} onOpen={(tripId) => navigate(`/trips/${tripId}`)} />
              <TodoTool
                items={pendingTodos}
                locale={locale}
                onOpen={openDashboardTodo}
                onComplete={completeDashboardTodo}
              />
            </aside>
          </main>
        </div>

        <button
          className="fab-new-trip"
          onClick={lifetimeTripLocked ? openUpgradePlans : openCreateTrip}
          aria-label={t('dashboard.newTrip')}
          title={lifetimeTripLocked ? 'Trip limit reached' : t('dashboard.newTrip')}
        >
          <Plus size={22} strokeWidth={2.4} />
          <span className="fab-label">{t('dashboard.newTrip')}</span>
        </button>

        {showForm && (
          <TripFormModal
            isOpen={showForm}
            trip={editingTrip}
            onClose={() => {
              setShowForm(false);
              setEditingTrip(null);
            }}
            onSave={editingTrip ? handleUpdate : handleCreate}
            onCoverUpdate={(tripId, coverUrl) =>
              setTrips((prev) => prev.map((t) => (t.id === tripId ? { ...t, cover_image: coverUrl } : t)))
            }
          />
        )}
        {deleteTrip && (
          <ConfirmDialog
            isOpen={!!deleteTrip}
            title={t('common.delete')}
            message={t('dashboard.confirm.delete', { title: deleteTrip.title })}
            confirmLabel={t('common.delete')}
            onConfirm={confirmDelete}
            onClose={() => setDeleteTrip(null)}
            danger
          />
        )}
        {copyTrip && (
          <CopyTripDialog
            isOpen={!!copyTrip}
            tripTitle={copyTrip.title}
            onConfirm={confirmCopy}
            onClose={() => setCopyTrip(null)}
          />
        )}
        <UpgradePlansModal
          open={upgradePlansOpen}
          billing={entitlementState.billing}
          access={entitlementState.access}
          checkoutLoading={entitlementState.checkoutLoading}
          onClose={() => setUpgradePlansOpen(false)}
          onSelect={startUpgrade}
        />
        {expiryWarning?.show && (
          <ReferralExpiryOverlay
            warning={expiryWarning}
            onDismiss={dismissExpiryWarning}
            onUpgrade={() => {
              setExpiryWarning(null);
              openUpgradePlans();
            }}
          />
        )}
      </div>
    </>
  );
}

// ── Boarding-pass hero ───────────────────────────────────────────────────────
function BoardingPassHero({
  trip,
  bundle,
  locale,
  onOpen,
  onEdit,
  onCopy,
  onArchive,
  onDelete,
}: {
  trip: DashboardTrip;
  bundle: HeroBundle | null;
  locale: string;
  onOpen: () => void;
  onEdit: () => void;
  onCopy: () => void;
  onArchive: () => void;
  onDelete: () => void;
}): React.ReactElement {
  const { t } = useTranslation();
  const mobile = useIsMobile();
  const stop = (e: React.MouseEvent, fn: () => void) => {
    e.stopPropagation();
    fn();
  };
  const status = getTripStatus(trip);
  const start = splitDate(trip.start_date, locale);
  const end = splitDate(trip.end_date, locale);
  const coverImageUrl = resolveMediaUrl(trip.cover_image);
  const editLocked = !!trip.edit_locked;

  // Countdown cell — plain text in the same style as the trip-dates cell:
  // days remaining while the trip runs, days until departure before it starts.
  const until = daysUntil(trip.start_date);
  const ongoing = status === 'ongoing';
  let countdownTop = '';
  let countdownNumber = '';
  let countdownLabel = '';
  if (ongoing && trip.end_date) {
    const todayMid = new Date();
    todayMid.setHours(0, 0, 0, 0);
    const endMid = new Date(trip.end_date + 'T00:00:00');
    const daysLeft = Math.max(0, Math.round((endMid.getTime() - todayMid.getTime()) / MS_PER_DAY));
    countdownTop = t('dashboard.status.ongoing');
    countdownNumber = String(daysLeft);
    countdownLabel =
      daysLeft === 0
        ? t('dashboard.hero.lastDay')
        : daysLeft === 1
          ? t('dashboard.hero.dayLeft')
          : t('dashboard.hero.daysLeft');
  } else if (until !== null && until >= 0) {
    countdownTop = t('dashboard.hero.startsIn');
    countdownNumber = String(until);
    countdownLabel = until === 1 ? t('dashboard.hero.dayUnitOne') : t('dashboard.hero.dayUnitMany');
  }

  const members = bundle?.members || [];
  const places = bundle?.places || [];
  const buddyCount = trip.shared_count != null ? trip.shared_count + 1 : members.length;
  const placeCount = trip.place_count || places.length;

  const badge =
    status === 'ongoing'
      ? t('dashboard.hero.badgeLive')
      : status === 'today'
        ? t('dashboard.hero.badgeToday')
        : status === 'tomorrow'
          ? t('dashboard.hero.badgeTomorrow')
          : status === 'future'
            ? t('dashboard.hero.badgeNext')
            : t('dashboard.hero.badgeRecent');

  const passCells = (
    <>
      <div className="pass-cell buddies">
        <div className="pass-label">{t('dashboard.members')}</div>
        <div className="buddies-avatars">
          {members.slice(0, 4).map((m, i) =>
            m.avatar_url ? (
              <img
                key={m.id}
                className="buddy-avatar"
                src={m.avatar_url}
                alt={m.username}
                style={{ objectFit: 'cover' }}
              />
            ) : (
              <div key={m.id} className="buddy-avatar" style={{ background: buddyColor(i) }}>
                {initials(m.username)}
              </div>
            )
          )}
          {members.length > 4 && <div className="buddy-more">+{members.length - 4}</div>}
          {members.length === 0 && (
            <div className="buddy-avatar" style={{ background: buddyColor(0) }}>
              {initials(trip.owner_username)}
            </div>
          )}
        </div>
        <div className="date-month">
          {buddyCount === 1
            ? t('dashboard.hero.travelerOne', { count: buddyCount })
            : t('dashboard.hero.travelerMany', { count: buddyCount })}
        </div>
      </div>

      <div className="pass-cell dates-combined">
        <div className="pass-label">{t('dashboard.hero.tripDates')}</div>
        <div className="dates-row">
          {start ? (
            <div className="date-block">
              <div className="date-num mono">{start.d}</div>
              <div className="date-month">{start.m}</div>
            </div>
          ) : (
            <div className="date-block">
              <div className="date-num">—</div>
            </div>
          )}
          <div className="date-arrow">
            <ArrowRight />
          </div>
          {end ? (
            <div className="date-block">
              <div className="date-num mono">{end.d}</div>
              <div className="date-month">{end.m}</div>
            </div>
          ) : (
            <div className="date-block">
              <div className="date-num">—</div>
            </div>
          )}
        </div>
      </div>

      <div className="pass-cell countdown">
        {countdownNumber && (
          <>
            <div className="pass-label">{countdownTop}</div>
            <div className="date-num mono">{countdownNumber}</div>
            <div className="date-month">{countdownLabel}</div>
          </>
        )}
      </div>

      <div className="pass-cell places">
        <div className="pass-label">{t('dashboard.places')}</div>
        <div className="places-preview">
          {places.slice(0, 3).map((p) => (
            <div key={p.id} className="place-av">
              <PlaceAvatar
                place={p}
                size={mobile ? 24 : 32}
                category={{ color: p.category_color ?? undefined, icon: p.category_icon ?? undefined }}
              />
            </div>
          ))}
          {places.length === 0 && (
            <div className="place-more">
              <MapPin size={15} />
            </div>
          )}
          {places.length > 3 && <div className="place-more">+{places.length - 3}</div>}
        </div>
        <div className="date-month">
          {placeCount === 1
            ? t('dashboard.hero.destinationOne', { count: placeCount })
            : t('dashboard.hero.destinationMany', { count: placeCount })}
        </div>
      </div>
    </>
  );

  return (
    <>
      <section className="hero-trip" onClick={onOpen}>
        <div className="bg" style={{ background: tripGradient(trip.id) }} />
        {coverImageUrl && (
          <img
            className="bg"
            src={coverImageUrl}
            alt={trip.title}
            onError={(event) => {
              event.currentTarget.style.display = 'none';
            }}
          />
        )}
        <div className="scrim" />
        <div className="hero-content">
          <div className="hero-top">
            <div className="hero-badge">
              {status === 'ongoing' && <span className="pulse" />}
              {badge}
            </div>
            {editLocked && (
              <div className="hero-badge" style={{ background: 'rgba(17,24,39,0.72)' }}>
                <Lock size={13} />
                {t('dashboard.locked.readOnly')}
              </div>
            )}
            <div className="hero-tools">
              <button className="hero-tool" aria-label={t('common.edit')} onClick={(e) => stop(e, onEdit)}>
                {editLocked ? <Lock size={16} /> : <Edit2 size={16} />}
              </button>
              <button className="hero-tool" aria-label={t('dashboard.aria.duplicate')} onClick={(e) => stop(e, onCopy)}>
                <Copy size={16} />
              </button>
              <button
                className="hero-tool"
                aria-label={trip.is_archived ? t('dashboard.restore') : t('dashboard.archive')}
                onClick={(e) => stop(e, onArchive)}
              >
                <Archive size={16} />
              </button>
              <button className="hero-tool" aria-label={t('common.delete')} onClick={(e) => stop(e, onDelete)}>
                <Trash2 size={16} />
              </button>
            </div>
          </div>

          <div className="hero-title-block">
            <h2 className="hero-title">{trip.title}</h2>
          </div>

          {!mobile && (
            <div
              className="hero-pass"
              onClick={(e) => {
                e.stopPropagation();
                onOpen();
              }}
            >
              {passCells}
            </div>
          )}
        </div>
      </section>
      {mobile && (
        <section className="pass-card" onClick={onOpen}>
          {passCells}
        </section>
      )}
    </>
  );
}

// ── Trip card ────────────────────────────────────────────────────────────────
function TripCard({
  trip,
  locale,
  onOpen,
  onEdit,
  onCopy,
  onArchive,
  onDelete,
}: {
  trip: DashboardTrip;
  locale: string;
  onOpen: () => void;
  onEdit: () => void;
  onCopy: () => void;
  onArchive: () => void;
  onDelete: () => void;
}): React.ReactElement {
  const { t } = useTranslation();
  const status = getTripStatus(trip);
  const start = splitDate(trip.start_date, locale);
  const end = splitDate(trip.end_date, locale);
  const until = daysUntil(trip.start_date);
  const coverImageUrl = resolveMediaUrl(trip.cover_image);
  const editLocked = !!trip.edit_locked;

  const statusClass =
    status === 'ongoing'
      ? ''
      : status === 'past'
        ? 'completed'
        : status === 'future' || status === 'today' || status === 'tomorrow'
          ? 'upcoming'
          : 'idea';
  const statusLabel =
    status === 'ongoing'
      ? t('dashboard.mobile.liveNow')
      : status === 'today'
        ? t('dashboard.status.today')
        : status === 'tomorrow'
          ? t('dashboard.status.tomorrow')
          : status === 'future' && until !== null
            ? until > 60
              ? t('dashboard.mobile.inMonths', { count: Math.round(until / 30) })
              : t('dashboard.mobile.inDays', { count: until })
            : status === 'past'
              ? t('dashboard.mobile.completed')
              : t('dashboard.card.idea');

  const stop = (e: React.MouseEvent, fn: () => void) => {
    e.stopPropagation();
    fn();
  };

  return (
    <article className="trip-card" onClick={onOpen}>
      <div className="trip-actions">
        <button className="trip-action-btn" aria-label={t('common.edit')} onClick={(e) => stop(e, onEdit)}>
          {editLocked ? <Lock size={16} /> : <Edit2 size={16} />}
        </button>
        <button
          className="trip-action-btn"
          aria-label={t('dashboard.aria.duplicate')}
          onClick={(e) => stop(e, onCopy)}
        >
          <Copy size={16} />
        </button>
        <button
          className="trip-action-btn"
          aria-label={trip.is_archived ? t('dashboard.restore') : t('dashboard.archive')}
          onClick={(e) => stop(e, onArchive)}
        >
          <Archive size={16} />
        </button>
        <button className="trip-action-btn" aria-label={t('common.delete')} onClick={(e) => stop(e, onDelete)}>
          <Trash2 size={16} />
        </button>
      </div>
      <div className="trip-cover" style={{ background: tripGradient(trip.id) }}>
        {coverImageUrl && (
          <img
            src={coverImageUrl}
            alt={trip.title}
            onError={(event) => {
              event.currentTarget.style.display = 'none';
            }}
          />
        )}
        <div className={`trip-status ${statusClass}`}>
          <span className="indicator" /> {statusLabel}
        </div>
        {editLocked && (
          <div
            className="trip-status"
            style={{ top: 46, background: 'rgba(17,24,39,0.72)', color: '#fff' }}
          >
            <Lock size={12} /> {t('dashboard.locked.readOnly')}
          </div>
        )}
        <div className="trip-cover-content">
          <h3 className="trip-name">{trip.title}</h3>
        </div>
      </div>
      <div className="trip-body">
        <div className="trip-dates">
          {start && end ? (
            <>
              <span className="date-num">
                {start.m} {start.d}
              </span>
              <span className="date-arrow">
                <ArrowRight size={11} />
              </span>
              <span className="date-num">
                {end.m} {end.d}
              </span>
            </>
          ) : (
            <span>{t('dashboard.hero.noDates')}</span>
          )}
        </div>
        <div className="trip-meta" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
          <div>
            <span className="n mono">{trip.day_count ?? 0}</span>
            <span className="k">{t('dashboard.days')}</span>
          </div>
          <div>
            <span className="n mono">{trip.place_count ?? 0}</span>
            <span className="k">{t('dashboard.places')}</span>
          </div>
          <div>
            <span className="n mono">{trip.shared_count ?? 0}</span>
            <span className="k">{trip.shared_count === 1 ? t('dashboard.card.buddyOne') : t('dashboard.members')}</span>
          </div>
        </div>
      </div>
    </article>
  );
}

function ReferralExpiryOverlay({
  warning,
  onDismiss,
  onUpgrade,
}: {
  warning: ReferralExpiryWarning;
  onDismiss: () => void;
  onUpgrade: () => void;
}): React.ReactElement {
  const { t } = useTranslation();
  return (
    <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/45 p-4 backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-2xl border border-edge bg-surface-card p-5 shadow-2xl">
        <div className="flex items-start gap-3">
          <span className="grid h-10 w-10 flex-shrink-0 place-items-center rounded-xl bg-amber-100 text-amber-700">
            <AlertCircle className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-semibold text-content">{t('dashboard.expiry.title')}</h2>
            <p className="mt-1 text-sm leading-6 text-content-muted">{t('dashboard.expiry.body')}</p>
          </div>
          <button className="rounded-lg p-2 text-content-muted hover:bg-surface-secondary" onClick={onDismiss}>
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="mt-4 max-h-56 space-y-2 overflow-auto">
          {warning.trips.slice(0, 8).map((trip) => (
            <div key={trip.id} className="rounded-lg border border-edge bg-surface-secondary px-3 py-2">
              <div className="truncate text-sm font-medium text-content">{trip.title}</div>
              <div className="text-xs text-content-muted">
                {trip.start_date || t('dashboard.hero.noDates')}
                {trip.end_date ? ` - ${trip.end_date}` : ''}
              </div>
            </div>
          ))}
        </div>
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <button className="rounded-lg border border-edge px-3 py-2 text-sm font-semibold text-content-secondary" onClick={onDismiss}>
            {t('dashboard.expiry.dismiss')}
          </button>
          <button className="rounded-lg bg-accent px-3 py-2 text-sm font-semibold text-accent-text" onClick={onUpgrade}>
            {t('dashboard.expiry.upgrade')}
          </button>
        </div>
      </div>
    </div>
  );
}

type TodoDueStatus = 'overdue' | 'today' | 'upcoming' | 'none';

function getTodoDueStatus(dueDate: string | null | undefined): TodoDueStatus {
  if (!dueDate) return 'none';
  const today = new Date().toISOString().slice(0, 10);
  if (dueDate < today) return 'overdue';
  if (dueDate === today) return 'today';
  return 'upcoming';
}

function formatDueChip(dueDate: string | null | undefined, locale: string, t: ReturnType<typeof useTranslation>['t']) {
  if (!dueDate) return t('dashboard.todos.noDate');
  const status = getTodoDueStatus(dueDate);
  if (status === 'overdue') return t('dashboard.todos.overdue');
  if (status === 'today') return t('dashboard.todos.today');
  const date = new Date(`${dueDate}T00:00:00Z`).toLocaleDateString(locale, {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
  return t('dashboard.todos.due', { date });
}

// ── Dashboard to-do tool ─────────────────────────────────────────────────────
function TodoTool({
  items,
  locale,
  onOpen,
  onComplete,
}: {
  items: DashboardTodo[];
  locale: string;
  onOpen: (todo: DashboardTodo) => void;
  onComplete: (todo: DashboardTodo) => void;
}): React.ReactElement {
  const { t } = useTranslation();
  return (
    <div className="tool todo-tool">
      <div className="tool-head">
        <div className="tool-title">
          <ListTodo size={14} /> {t('dashboard.todos.title')}
        </div>
        {items.length > 0 && <div className="todo-count">{t('dashboard.todos.count', { count: items.length })}</div>}
      </div>
      {items.length === 0 ? (
        <div className="todo-empty">{t('dashboard.todos.empty')}</div>
      ) : (
        <div className="todo-list">
          {items.map((todo) => {
            const dateStr = todo.due_date ? splitDate(todo.due_date, locale) : null;
            const status = getTodoDueStatus(todo.due_date);
            const priority = todo.priority && todo.priority > 0 ? todo.priority : null;
            return (
              <div
                className={`todo-item ${status}`}
                key={todo.id}
                role="button"
                tabIndex={0}
                onClick={() => onOpen(todo)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    onOpen(todo);
                  }
                }}
              >
                <button
                  type="button"
                  className="todo-check"
                  aria-label={t('dashboard.todos.completeAria', { task: todo.name })}
                  onClick={(event) => {
                    event.stopPropagation();
                    onComplete(todo);
                  }}
                >
                  <Check size={13} />
                </button>
                <div className={`todo-date ${status}`}>
                  {status === 'overdue' ? (
                    <AlertCircle size={16} />
                  ) : (
                    <>
                      <div className="d mono">{dateStr?.d ?? '--'}</div>
                      <div className="m">{dateStr?.m ?? t('dashboard.todos.noDateShort')}</div>
                    </>
                  )}
                </div>
                <div className="todo-info">
                  <div className="todo-name">{todo.name}</div>
                  <div className="todo-trip">{todo.trip_title || t('dashboard.todos.untitledTrip')}</div>
                  <div className="todo-meta">
                    <span className={`todo-chip due ${status}`}>{formatDueChip(todo.due_date, locale, t)}</span>
                    {todo.category && <span className="todo-chip">{todo.category}</span>}
                    {priority && (
                      <span className={`todo-chip priority p${priority}`}>
                        {t('dashboard.todos.priority', { priority })}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Upcoming reservations tool ───────────────────────────────────────────────
function UpcomingTool({
  items,
  locale,
  onOpen,
}: {
  items: UpcomingReservation[];
  locale: string;
  onOpen: (tripId: number) => void;
}): React.ReactElement {
  const { t } = useTranslation();
  const timeFormat = useSettingsStore((s) => s.settings.time_format);
  return (
    <div className="tool">
      <div className="tool-head">
        <div className="tool-title">
          <Calendar size={14} /> {t('dashboard.upcoming.title')}
        </div>
      </div>
      {items.length === 0 ? (
        <div style={{ fontSize: 13, color: 'var(--ink-3)' }}>{t('dashboard.upcoming.empty')}</div>
      ) : (
        <div className="upc-list">
          {items.map((r) => {
            // Read the date/time straight from the stored string parts. Going through
            // new Date(...).toISOString() reinterprets the naive local time as UTC and
            // can roll the displayed day forward/back in non-UTC timezones.
            const parsed = splitReservationDateTime(r.reservation_time);
            const datePart = parsed.date || r.day_date || null;
            const dateStr = datePart ? splitDate(datePart, locale) : null;
            const timeStr = parsed.time ? formatTime(parsed.time, locale, timeFormat) : null;
            const typeClass = RES_TYPE_CLASS[r.type] || 'other';
            return (
              <div className="upc-item" key={r.id} onClick={() => onOpen(r.trip_id)}>
                <div className="upc-date">
                  <div className="d mono">{dateStr?.d ?? '–'}</div>
                  <div className="m">{dateStr?.m ?? ''}</div>
                </div>
                <div className="upc-info">
                  <div className="t">{r.title}</div>
                  <div className="s">
                    {timeStr && (
                      <>
                        <Clock size={11} /> {timeStr} ·{' '}
                      </>
                    )}
                    {r.location || r.place_name || r.trip_title}
                  </div>
                </div>
                <div className={`upc-type ${typeClass}`}>{RES_ICON[r.type] || <Ticket size={16} />}</div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
