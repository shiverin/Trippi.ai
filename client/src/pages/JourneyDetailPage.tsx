import {
  ArrowLeft,
  BookOpen,
  ChevronDown,
  ChevronUp,
  Download,
  Eye,
  EyeOff,
  Grid,
  List,
  MapPin,
  MoreHorizontal,
  Plus,
} from 'lucide-react';
import { journeyApi } from '../api/client';
import ContributorInviteDialog from '../components/Journey/ContributorInviteDialog';
import { DAY_COLORS } from '../components/Journey/dayColors';
import { AddTripDialog } from '../components/Journey/JourneyDetailPageAddTripDialog';
import { CheckinCard, EntryCard, SkeletonCard } from '../components/Journey/JourneyDetailPageEntryCard';
import { EntryEditor } from '../components/Journey/JourneyDetailPageEntryEditor';
import { GalleryView } from '../components/Journey/JourneyDetailPageGalleryView';
import { JourneySettingsDialog } from '../components/Journey/JourneyDetailPageSettingsDialog';
import JourneyMap from '../components/Journey/JourneyMapAuto';
import MobileEntryView from '../components/Journey/MobileEntryView';
import MobileMapTimeline from '../components/Journey/MobileMapTimeline';
import PhotoLightbox from '../components/Journey/PhotoLightbox';
import Navbar from '../components/Layout/Navbar';
import ConfirmDialog from '../components/shared/ConfirmDialog';
import { useAuthStore } from '../store/authStore';
import type { JourneyEntry } from '../store/journeyStore';
import { useJourneyStore } from '../store/journeyStore';
import { computeJourneyLifecycle } from '../utils/journeyLifecycle';
import { formatDate, groupByDate, photoUrl, pickGradient } from './journeyDetail/JourneyDetailPage.helpers';
import { useJourneyDetail } from './journeyDetail/useJourneyDetail';

export default function JourneyDetailPage() {
  // Page = wiring container: load + live sync, view state, dialogs, the
  // scroll-synced map and the map/trip-date derivations live in the hook.
  const {
    id,
    navigate,
    toast,
    t,
    locale,
    current,
    loading,
    canEditEntries,
    canEditJourney,
    myRole,
    view,
    setView,
    activeEntryId,
    setActiveEntryId,
    feedRef,
    viewingEntry,
    setViewingEntry,
    editingEntry,
    setEditingEntry,
    lightbox,
    setLightbox,
    deleteTarget,
    setDeleteTarget,
    showInvite,
    setShowInvite,
    showAddTrip,
    setShowAddTrip,
    unlinkTrip,
    setUnlinkTrip,
    showSettings,
    setShowSettings,
    hideSkeletons,
    setHideSkeletons,
    mapRef,
    fullMapRef,
    activeLocationId,
    handleMarkerClick,
    handleLocationClick,
    mapEntries,
    sidebarMapItems,
    tripDates,
    isMobile,
    loadJourney,
    updateEntry,
    deleteEntry,
    reorderEntries,
    uploadPhotos,
    deletePhoto,
  } = useJourneyDetail();

  if (loading || !current) {
    return (
      <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
        <Navbar />
        <div style={{ paddingTop: 'var(--nav-h, 0px)' }} className="flex justify-center py-20">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-zinc-300 border-t-zinc-900" />
        </div>
      </div>
    );
  }

  const timelineEntries = current.entries.filter((e) => !hideSkeletons || e.type !== 'skeleton');
  const dayGroups = groupByDate(timelineEntries);
  const sortedDates = [...dayGroups.keys()].sort();

  const tripDateMin = current.trips.length
    ? current.trips.reduce(
        (min: string, t: any) => (t.start_date && (!min || t.start_date < min) ? t.start_date : min),
        ''
      )
    : null;
  const tripDateMax = current.trips.length
    ? current.trips.reduce((max: string, t: any) => (t.end_date && (!max || t.end_date > max) ? t.end_date : max), '')
    : null;
  const lifecycle = computeJourneyLifecycle(current.status, tripDateMin || null, tripDateMax || null);

  const showMobileCombined = isMobile && view === 'timeline';
  const showMobileGallery = isMobile && view === 'gallery';
  const isMobileChromeless = showMobileCombined || showMobileGallery;

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <Navbar />

      {/* Mobile combined map+timeline (Polarsteps-style) — renders as fullscreen overlay */}
      {showMobileCombined && (
        <MobileMapTimeline
          entries={timelineEntries}
          mapEntries={sidebarMapItems}
          dark={document.documentElement.classList.contains('dark')}
          readOnly={!canEditEntries}
          onEntryClick={(entry) => setViewingEntry(entry)}
          onAddEntry={
            canEditEntries
              ? () => {
                  const today = new Date().toISOString().split('T')[0];
                  setEditingEntry({
                    id: 0,
                    journey_id: current.id,
                    author_id: 0,
                    type: 'entry',
                    entry_date: today,
                    visibility: 'private',
                    sort_order: 0,
                    photos: [],
                    created_at: 0,
                    updated_at: 0,
                  } as JourneyEntry);
                }
              : undefined
          }
        />
      )}

      {/* Fullscreen entry view (mobile) */}
      {viewingEntry && (
        <MobileEntryView
          entry={viewingEntry}
          readOnly={!canEditEntries}
          onClose={() => setViewingEntry(null)}
          onEdit={() => {
            setViewingEntry(null);
            setEditingEntry(viewingEntry);
          }}
          onDelete={() => {
            setViewingEntry(null);
            setDeleteTarget(viewingEntry);
          }}
          onPhotoClick={(photos, idx) =>
            setLightbox({
              photos: photos.map((p) => ({
                id: p.id,
                src: photoUrl(p, 'original'),
                caption: p.caption,
                provider: p.provider,
                asset_id: p.asset_id,
                owner_id: p.owner_id,
              })),
              index: idx,
            })
          }
        />
      )}

      {/* Floating top bar on mobile Journey + Gallery views: back | tabs+title | settings */}
      {isMobileChromeless && (
        <div
          className="fixed left-0 right-0 z-30 flex items-start justify-between gap-2 px-4"
          style={{ top: 'calc(var(--nav-h, 56px) + 12px)' }}
        >
          <button
            onClick={() => navigate('/journey')}
            aria-label={t('journey.detail.backToJourney')}
            className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg border border-zinc-200 bg-white/90 text-zinc-700 shadow-lg backdrop-blur-lg transition-transform hover:bg-white active:scale-95 dark:border-zinc-700 dark:bg-zinc-800/90 dark:text-zinc-200 dark:hover:bg-zinc-800"
          >
            <ArrowLeft size={16} />
          </button>

          <div className="flex min-w-0 flex-1 justify-center">
            <div className="flex overflow-hidden rounded-lg border border-zinc-200 bg-white/90 shadow-lg backdrop-blur-lg dark:border-zinc-700 dark:bg-zinc-800/90">
              <button
                onClick={() => setView('timeline')}
                className={`flex items-center gap-1.5 px-3 py-[7px] text-[12px] font-medium ${
                  view === 'timeline'
                    ? 'bg-zinc-900 text-white dark:bg-white dark:text-zinc-900'
                    : 'text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300'
                }`}
              >
                <MapPin size={13} />
                {t('journey.detail.journeyTab') || 'Journey'}
              </button>
              <button
                onClick={() => setView('gallery')}
                className={`flex items-center gap-1.5 px-3 py-[7px] text-[12px] font-medium ${
                  view === 'gallery'
                    ? 'bg-zinc-900 text-white dark:bg-white dark:text-zinc-900'
                    : 'text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300'
                }`}
              >
                <Grid size={13} />
                {t('journey.share.gallery')}
              </button>
            </div>
          </div>

          {canEditJourney ? (
            <button
              onClick={() => setShowSettings(true)}
              aria-label={t('journey.settings.title')}
              className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg border border-zinc-200 bg-white/90 text-zinc-700 shadow-lg backdrop-blur-lg transition-transform hover:bg-white active:scale-95 dark:border-zinc-700 dark:bg-zinc-800/90 dark:text-zinc-200 dark:hover:bg-zinc-800"
            >
              <MoreHorizontal size={16} />
            </button>
          ) : (
            <div className="h-10 w-10 flex-shrink-0" aria-hidden />
          )}
        </div>
      )}

      <div style={{ paddingTop: 'var(--nav-h, 0px)' }} className={showMobileCombined ? 'hidden' : ''}>
        <div
          className={isMobile ? 'mx-auto max-w-[1440px] px-0 pt-0' : 'flex w-full overflow-hidden'}
          style={!isMobile ? { height: 'calc(100dvh - var(--nav-h, 56px))' } : undefined}
        >
          {/* LEFT column (full width on mobile, scrollable feed on desktop) */}
          <div ref={feedRef} className={isMobile ? '' : 'journey-feed-scroll flex-1 overflow-y-auto xl:max-w-[50%]'}>
            <div className={isMobile ? '' : 'w-full px-8 py-6'}>
              {/* Hero card — hidden on mobile gallery/journey views (floating top bar handles branding there) */}
              <div className={`mb-6 px-4 md:px-0 ${isMobileChromeless ? 'hidden' : ''}`}>
                <div
                  className="relative -mx-4 overflow-hidden rounded-none p-5 md:mx-0 md:rounded-2xl md:p-7"
                  style={{ background: pickGradient(current.id), color: 'white' }}
                >
                  {current.cover_image && (
                    <div className="absolute inset-0 z-[1]">
                      <img src={`/uploads/${current.cover_image}`} className="h-full w-full object-cover" alt="" />
                      <div
                        className="absolute inset-0"
                        style={{ background: pickGradient(current.id), opacity: 0.55 }}
                      />
                    </div>
                  )}
                  <div
                    className="pointer-events-none absolute inset-0 z-[2]"
                    style={{
                      background:
                        'radial-gradient(circle at 20% 20%, rgba(236,72,153,0.3), transparent 50%), radial-gradient(circle at 80% 80%, rgba(99,102,241,0.3), transparent 50%)',
                    }}
                  />

                  <div className="relative z-[3] mb-5 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => navigate('/journey')}
                        aria-label={t('journey.detail.backToJourney')}
                        className="flex h-[34px] w-[34px] items-center justify-center rounded-lg bg-white/15 backdrop-blur hover:bg-white/25"
                      >
                        <ArrowLeft size={14} />
                      </button>
                      {/* Status badge — keep completed/upcoming/draft/archived, but drop live + synced-with-trips per UX trim */}
                      <div className="hidden items-center gap-2 md:flex">
                        {lifecycle !== 'live' && lifecycle !== 'archived' && (
                          <div className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/[0.12] px-2.5 py-1 text-[11px] font-medium backdrop-blur">
                            {t(
                              `journey.status.${lifecycle === 'upcoming' ? 'upcoming' : lifecycle === 'draft' ? 'draft' : 'completed'}`
                            )}
                          </div>
                        )}
                        {lifecycle === 'archived' && (
                          <div className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/[0.12] px-2.5 py-1 text-[11px] font-medium backdrop-blur">
                            {t('journey.status.archived')}
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={() => {
                          import('../components/PDF/JourneyBookPDF').then((m) => m.downloadJourneyBookPDF(current));
                        }}
                        className="flex h-[34px] w-[34px] items-center justify-center rounded-lg bg-white/15 backdrop-blur hover:bg-white/25"
                      >
                        <Download size={14} />
                      </button>
                      <div className="group relative">
                        <button
                          onClick={async () => {
                            const next = !hideSkeletons;
                            setHideSkeletons(next);
                            await journeyApi.updatePreferences(current.id, { hide_skeletons: next });
                          }}
                          className={`flex h-[34px] w-[34px] items-center justify-center rounded-lg backdrop-blur ${hideSkeletons ? 'bg-white/30' : 'bg-white/15 hover:bg-white/25'}`}
                        >
                          {hideSkeletons ? <EyeOff size={14} /> : <Eye size={14} />}
                        </button>
                        <span className="pointer-events-none absolute right-0 top-full mt-2 whitespace-nowrap rounded-md bg-zinc-900 px-2 py-1 text-[11px] font-medium text-white opacity-0 transition-opacity group-hover:opacity-100 dark:bg-zinc-100 dark:text-zinc-900">
                          {hideSkeletons ? t('journey.skeletons.show') : t('journey.skeletons.hide')}
                        </span>
                      </div>
                      {canEditJourney && (
                        <button
                          onClick={() => setShowSettings(true)}
                          className="flex h-[34px] w-[34px] items-center justify-center rounded-lg bg-white/15 backdrop-blur hover:bg-white/25"
                        >
                          <MoreHorizontal size={14} />
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="relative z-[3] mb-5">
                    <h1 className="mb-1.5 text-[32px] font-bold leading-tight tracking-[-0.02em]">{current.title}</h1>
                    {current.subtitle && <p className="text-[13px] opacity-85">{current.subtitle}</p>}
                  </div>

                  <div className="relative z-[3] flex items-end justify-between border-t border-white/15 pt-5">
                    <div className="flex gap-8">
                      {[
                        { value: sortedDates.length, label: t('journey.stats.days') },
                        { value: current.stats.places, label: t('journey.stats.places') },
                        { value: current.stats.entries, label: t('journey.stats.entries') },
                        { value: current.stats.photos, label: t('journey.stats.photos') },
                      ].map((s) => (
                        <div key={s.label} className="flex flex-col gap-0.5">
                          <span className="text-[20px] font-bold">{s.value}</span>
                          <span className="text-[10px] uppercase tracking-[0.08em] opacity-70">{s.label}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              {/* Main content (was a 2-col grid with right-sidebar panels;
              now single column inside the left feed — right pane is a
              sticky fullscreen map further below). */}
              <div className={isMobile ? 'px-4' : ''}>
                <div>
                  {/* View Controls — hidden on mobile (floating top bar has them) */}
                  <div className={`mb-5 mt-5 flex items-center justify-between ${isMobileChromeless ? 'hidden' : ''}`}>
                    <div className="flex overflow-hidden rounded-lg border border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-800">
                      {(isMobile
                        ? [
                            {
                              id: 'timeline' as const,
                              icon: MapPin,
                              label: t('journey.detail.journeyTab') || 'Journey',
                            },
                            { id: 'gallery' as const, icon: Grid, label: t('journey.share.gallery') },
                          ]
                        : [
                            { id: 'timeline' as const, icon: List, label: t('journey.share.timeline') },
                            { id: 'gallery' as const, icon: Grid, label: t('journey.share.gallery') },
                          ]
                      ).map((v) => (
                        <button
                          key={v.id}
                          onClick={() => setView(v.id)}
                          className={`flex items-center gap-1.5 px-3 py-[7px] text-[12px] font-medium ${
                            view === v.id
                              ? 'bg-zinc-900 text-white dark:bg-white dark:text-zinc-900'
                              : 'text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300'
                          }`}
                        >
                          <v.icon size={13} />
                          {v.label}
                        </button>
                      ))}
                    </div>
                    {canEditEntries && (!isMobile ? view === 'timeline' : view !== 'gallery') && (
                      <button
                        onClick={() => {
                          const today = new Date().toISOString().split('T')[0];
                          setEditingEntry({
                            id: 0,
                            journey_id: current.id,
                            author_id: 0,
                            type: 'entry',
                            entry_date: today,
                            visibility: 'private',
                            sort_order: 0,
                            photos: [],
                            created_at: 0,
                            updated_at: 0,
                          } as JourneyEntry);
                        }}
                        className={`flex h-8 w-8 items-center justify-center rounded-lg bg-zinc-900 text-white hover:bg-zinc-800 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-100 ${isMobile && view === 'timeline' ? 'hidden' : ''}`}
                      >
                        <Plus size={16} />
                      </button>
                    )}
                  </div>

                  {/* Timeline (desktop only — mobile uses fullscreen combined view above) */}
                  {!isMobile && (
                    <div className={`flex flex-col gap-6 pb-24 md:pb-6${view === 'timeline' ? '' : 'hidden'}`}>
                      {sortedDates.length === 0 && (
                        <div className="py-16 text-center">
                          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-zinc-100 dark:bg-zinc-800">
                            <BookOpen size={24} className="text-zinc-400" />
                          </div>
                          <p className="text-[15px] font-medium text-zinc-700 dark:text-zinc-300">No entries yet</p>
                          <p className="mt-1 text-[12px] text-zinc-500">
                            Add a trip to get started with skeleton entries
                          </p>
                        </div>
                      )}

                      {sortedDates.map((date, dayIdx) => {
                        const entries = dayGroups.get(date)!;
                        const fd = formatDate(date, locale);
                        const locations = [...new Set(entries.map((e) => e.location_name).filter(Boolean))];

                        return (
                          <div key={date} className="trek-stagger flex flex-col gap-3">
                            <div className="-mx-4 flex items-center justify-between rounded-none border-y border-zinc-200 bg-white/95 px-4 py-3.5 backdrop-blur dark:border-zinc-700 dark:bg-zinc-900/95 md:mx-0 md:rounded-xl md:border">
                              <div className="flex items-center gap-3">
                                <div
                                  className="flex h-8 w-8 items-center justify-center rounded-lg text-[13px] font-bold text-white"
                                  style={{ background: DAY_COLORS[dayIdx % DAY_COLORS.length] }}
                                >
                                  {dayIdx + 1}
                                </div>
                                <div>
                                  <h3 className="text-[14px] font-semibold text-zinc-900 dark:text-white">
                                    {new Date(date + 'T00:00:00').toLocaleDateString(undefined, {
                                      weekday: 'long',
                                      day: 'numeric',
                                      month: 'long',
                                    })}
                                  </h3>
                                </div>
                              </div>
                              <div className="flex items-center gap-3 text-[11px] text-zinc-500">
                                <span className="flex items-center gap-1">
                                  <MapPin size={12} /> {entries.length} {t('journey.synced.places')}
                                </span>
                              </div>
                            </div>

                            {entries.map((entry, idx) => {
                              // Skeletons are just "suggested" places pulled
                              // from the linked trip — they aren't real
                              // journey entries until the user edits them,
                              // so reordering them does not make sense.
                              const canReorder =
                                !isMobile && canEditEntries && entries.length > 1 && entry.type !== 'skeleton';
                              const move = (direction: -1 | 1) => {
                                if (!current) return;
                                const target = idx + direction;
                                if (target < 0 || target >= entries.length) return;
                                const reordered = [...entries];
                                const [moved] = reordered.splice(idx, 1);
                                reordered.splice(target, 0, moved);
                                reorderEntries(
                                  current.id,
                                  reordered.map((e) => e.id)
                                ).catch(() => toast.error(t('common.errorOccurred')));
                              };
                              return (
                                <div
                                  key={entry.id}
                                  data-entry-id={String(entry.id)}
                                  className={`relative ${canReorder ? 'flex items-stretch gap-2' : ''}`}
                                  onMouseEnter={() => {
                                    setActiveEntryId(String(entry.id));
                                    mapRef.current?.highlightMarker(String(entry.id));
                                  }}
                                  style={
                                    String(entry.id) === activeEntryId
                                      ? {
                                          outline: `2px solid ${DAY_COLORS[dayIdx % DAY_COLORS.length]}`,
                                          outlineOffset: '3px',
                                          borderRadius: '12px',
                                        }
                                      : undefined
                                  }
                                >
                                  {canReorder && (
                                    <div className="flex flex-shrink-0 flex-col justify-center gap-1 py-1">
                                      <button
                                        type="button"
                                        onClick={() => move(-1)}
                                        disabled={idx === 0}
                                        aria-label="Move up"
                                        className="flex h-7 w-7 items-center justify-center rounded-lg border border-zinc-200 bg-white text-zinc-600 shadow-sm transition-colors hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
                                      >
                                        <ChevronUp size={14} />
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => move(1)}
                                        disabled={idx === entries.length - 1}
                                        aria-label="Move down"
                                        className="flex h-7 w-7 items-center justify-center rounded-lg border border-zinc-200 bg-white text-zinc-600 shadow-sm transition-colors hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
                                      >
                                        <ChevronDown size={14} />
                                      </button>
                                    </div>
                                  )}
                                  <div className={canReorder ? 'min-w-0 flex-1' : ''}>
                                    {entry.type === 'skeleton' ? (
                                      <SkeletonCard
                                        entry={entry}
                                        onClick={canEditEntries ? () => setEditingEntry(entry) : undefined}
                                      />
                                    ) : entry.type === 'checkin' ? (
                                      <CheckinCard
                                        entry={entry}
                                        onClick={canEditEntries ? () => setEditingEntry(entry) : undefined}
                                      />
                                    ) : (
                                      <EntryCard
                                        entry={entry}
                                        readOnly={!canEditEntries}
                                        onEdit={() => setEditingEntry(entry)}
                                        onDelete={() => setDeleteTarget(entry)}
                                        onPhotoClick={(photos, idx) =>
                                          setLightbox({
                                            photos: photos.map((p) => ({
                                              id: p.id,
                                              src: photoUrl(p, 'original'),
                                              caption: p.caption,
                                              provider: p.provider,
                                              asset_id: p.asset_id,
                                              owner_id: p.owner_id,
                                            })),
                                            index: idx,
                                          })
                                        }
                                      />
                                    )}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* Gallery View — mobile gets extra top padding so the floating top bar doesn't overlap */}
                  <div
                    className={view === 'gallery' ? '' : 'hidden'}
                    style={showMobileGallery ? { paddingTop: 'calc(var(--nav-h, 56px) + 64px)' } : undefined}
                  >
                    <GalleryView
                      entries={current.entries}
                      gallery={current.gallery || []}
                      journeyId={current.id}
                      userId={useAuthStore.getState().user?.id || 0}
                      trips={current.trips}
                      onPhotoClick={(photos, idx) =>
                        setLightbox({
                          photos: photos.map((p) => ({
                            id: p.id,
                            src: photoUrl(p, 'original'),
                            caption: p.caption ?? null,
                            provider: p.provider,
                            asset_id: p.asset_id,
                            owner_id: p.owner_id,
                          })),
                          index: idx,
                        })
                      }
                      onRefresh={() => loadJourney(Number(id))}
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* RIGHT column on desktop — sticky rounded map (polarsteps-style).
              Hidden on mobile; mobile gets its own chromeless combined view. */}
          {!isMobile && (
            <aside className="w-[44%] min-w-[420px] max-w-[760px] pb-4 pl-0 pr-4 pt-6">
              <div className="h-full overflow-hidden rounded-2xl border border-zinc-200 shadow-sm dark:border-zinc-800">
                <JourneyMap
                  ref={mapRef}
                  checkins={[]}
                  entries={sidebarMapItems as any}
                  height={9999}
                  activeMarkerId={activeEntryId}
                  onMarkerClick={handleMarkerClick}
                  fullScreen
                />
              </div>
            </aside>
          )}
        </div>
      </div>

      {/* Entry Editor */}
      {editingEntry && (
        <EntryEditor
          entry={editingEntry}
          journeyId={current.id}
          tripDates={tripDates}
          galleryPhotos={current.gallery || []}
          onClose={() => setEditingEntry(null)}
          onSave={async (data) => {
            let entryId = editingEntry.id;
            if (editingEntry.id === 0) {
              const created = await useJourneyStore.getState().createEntry(current.id, data);
              entryId = created.id;
            } else {
              await updateEntry(editingEntry.id, data);
            }
            return entryId;
          }}
          onUploadPhotos={async (entryId, files, cbs) => {
            return await uploadPhotos(entryId, files, cbs);
          }}
          onDone={() => {
            setEditingEntry(null);
            loadJourney(Number(id));
          }}
        />
      )}

      {/* Journey Settings */}
      {showSettings && (
        <JourneySettingsDialog
          journey={current}
          onClose={() => setShowSettings(false)}
          onSaved={() => {
            setShowSettings(false);
            loadJourney(Number(id));
          }}
          onOpenInvite={() => {
            setShowInvite(true);
          }}
          onRefresh={() => loadJourney(Number(id))}
        />
      )}

      {/* Add Trip Dialog */}
      {showAddTrip && current && (
        <AddTripDialog
          journeyId={current.id}
          existingTripIds={current.trips.map((t: any) => t.trip_id)}
          onClose={() => setShowAddTrip(false)}
          onAdded={() => {
            setShowAddTrip(false);
            loadJourney(Number(id));
          }}
        />
      )}

      {/* Contributor Invite Dialog */}
      {showInvite && (
        <ContributorInviteDialog
          journeyId={current.id}
          existingUserIds={current.contributors.map((c: any) => c.user_id)}
          onClose={() => setShowInvite(false)}
          onInvited={() => {
            setShowInvite(false);
            loadJourney(Number(id));
          }}
        />
      )}

      {/* Delete confirm */}
      <ConfirmDialog
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={async () => {
          if (!deleteTarget) return;
          await deleteEntry(deleteTarget.id);
          setDeleteTarget(null);
          loadJourney(Number(id));
        }}
        title={t('journey.entries.deleteTitle')}
        message={t('journey.deleteConfirmMessage', { title: deleteTarget?.title || 'this entry' })}
        confirmLabel={t('common.delete')}
        danger
      />

      {/* Unlink Trip confirm */}
      <ConfirmDialog
        isOpen={!!unlinkTrip}
        onClose={() => setUnlinkTrip(null)}
        onConfirm={async () => {
          if (!unlinkTrip || !current) return;
          try {
            await journeyApi.removeTrip(current.id, unlinkTrip.trip_id);
            toast.success(t('journey.trips.tripUnlinked'));
            setUnlinkTrip(null);
            loadJourney(Number(id));
          } catch {
            toast.error(t('journey.trips.unlinkFailed'));
          }
        }}
        title={t('journey.trips.unlinkTrip')}
        message={t('journey.trips.unlinkMessage', { title: unlinkTrip?.title })}
        confirmLabel={t('journey.trips.unlink')}
        danger
      />

      {/* Lightbox */}
      {lightbox && (
        <PhotoLightbox
          photos={lightbox.photos.map((p) => ({
            id: p.id.toString(),
            src: p.src,
            caption: p.caption,
            provider: p.provider,
            asset_id: p.asset_id,
            owner_id: p.owner_id,
          }))}
          startIndex={lightbox.index}
          onClose={() => setLightbox(null)}
        />
      )}
    </div>
  );
}
