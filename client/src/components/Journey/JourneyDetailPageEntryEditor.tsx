import { Check, Image, MapPin, Minus, Plus, X } from 'lucide-react';
import { useRef, useState } from 'react';
import { journeyApi, mapsApi } from '../../api/client';
import { useIsMobile } from '../../hooks/useIsMobile';
import { useTranslation } from '../../i18n';
import { MOOD_CONFIG, WEATHER_CONFIG } from '../../pages/journeyDetail/JourneyDetailPage.constants';
import { photoUrl } from '../../pages/journeyDetail/JourneyDetailPage.helpers';
import type { GalleryPhoto, JourneyEntry, JourneyPhoto } from '../../store/journeyStore';
import { getApiErrorMessage } from '../../types';
import { normalizeImageFiles } from '../../utils/convertHeic';
import { type ResilientResult, type UploadProgress } from '../../utils/uploadQueue';
import { useToast } from '../shared/Toast';
import { DatePicker } from './JourneyDetailPageDatePicker';
import MarkdownToolbar from './MarkdownToolbar';

export function EntryEditor({
  entry,
  journeyId,
  tripDates,
  galleryPhotos,
  onClose,
  onSave,
  onUploadPhotos,
  onDone,
}: {
  entry: JourneyEntry;
  journeyId: number;
  tripDates: Set<string>;
  galleryPhotos: GalleryPhoto[];
  onClose: () => void;
  onSave: (data: Record<string, unknown>) => Promise<number>;
  onUploadPhotos: (
    entryId: number,
    files: File[],
    cbs?: { onProgress?: (p: UploadProgress) => void }
  ) => Promise<ResilientResult<JourneyPhoto>>;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const isMobile = useIsMobile();
  const [title, setTitle] = useState(entry.title || '');
  const [story, setStory] = useState(entry.story || '');
  const [entryDate, setEntryDate] = useState(entry.entry_date || new Date().toISOString().split('T')[0]);
  const [entryTime, setEntryTime] = useState(entry.entry_time || '');
  const [locationName, setLocationName] = useState(entry.location_name || '');
  const [locationLat, setLocationLat] = useState<number | null>(entry.location_lat ?? null);
  const [locationLng, setLocationLng] = useState<number | null>(entry.location_lng ?? null);
  const [locationQuery, setLocationQuery] = useState('');
  const [locationResults, setLocationResults] = useState<
    { name: string; address?: string; lat: number; lng: number }[]
  >([]);
  const [locationSearching, setLocationSearching] = useState(false);
  const [showLocationResults, setShowLocationResults] = useState(false);
  const locationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [mood, setMood] = useState(entry.mood || '');
  const [weather, setWeather] = useState(entry.weather || '');
  const [pros, setPros] = useState<string[]>(entry.pros_cons?.pros?.length ? entry.pros_cons.pros : ['']);
  const [cons, setCons] = useState<string[]>(entry.pros_cons?.cons?.length ? entry.pros_cons.cons : ['']);
  const [saving, setSaving] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<{ done: number; total: number } | null>(null);
  const [photos, setPhotos] = useState<(JourneyPhoto | GalleryPhoto)[]>(entry.photos || []);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [pendingLinkIds, setPendingLinkIds] = useState<number[]>([]);
  const [showGalleryPick, setShowGalleryPick] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const storyRef = useRef<HTMLTextAreaElement>(null);

  // Track which fields differ from the entry we started editing so we can
  // warn before discarding on close/cancel.
  const originalPros = (entry.pros_cons?.pros ?? []).join('\n');
  const originalCons = (entry.pros_cons?.cons ?? []).join('\n');
  const isDirty =
    title !== (entry.title || '') ||
    story !== (entry.story || '') ||
    entryDate !== (entry.entry_date || new Date().toISOString().split('T')[0]) ||
    entryTime !== (entry.entry_time || '') ||
    locationName !== (entry.location_name || '') ||
    (locationLat ?? null) !== (entry.location_lat ?? null) ||
    (locationLng ?? null) !== (entry.location_lng ?? null) ||
    mood !== (entry.mood || '') ||
    weather !== (entry.weather || '') ||
    pros.filter((p) => p.trim()).join('\n') !== originalPros ||
    cons.filter((c) => c.trim()).join('\n') !== originalCons ||
    pendingFiles.length > 0 ||
    pendingLinkIds.length > 0;

  const availableGalleryPhotos = galleryPhotos.filter((gp) => !photos.some((p) => p.id === gp.id));

  const handleClose = () => {
    if (isDirty && !window.confirm(t('journey.editor.discardChangesConfirm'))) return;
    onClose();
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const entryId = await onSave({
        title: title || null,
        story: story || null,
        entry_date: entryDate,
        entry_time: entryTime || null,
        location_name: locationName || null,
        location_lat: locationLat,
        location_lng: locationLng,
        mood: mood || null,
        weather: weather || null,
        pros_cons: { pros: pros.filter((p) => p.trim()), cons: cons.filter((c) => c.trim()) },
        type:
          entry.type === 'skeleton' && (story.trim() || pendingFiles.length > 0 || pendingLinkIds.length > 0)
            ? 'entry'
            : undefined,
      });
      // upload queued files after entry is created
      if (pendingFiles.length > 0 && entryId) {
        const filesToUpload = pendingFiles;
        setUploadProgress({ done: 0, total: filesToUpload.length });
        try {
          const { failed } = await onUploadPhotos(entryId, filesToUpload, {
            onProgress: (p) => setUploadProgress({ done: p.done, total: p.total }),
          });
          setPendingFiles(failed);
          if (failed.length > 0) {
            toast.error(
              t('journey.editor.uploadPartialFailed', {
                failed: String(failed.length),
                total: String(filesToUpload.length),
              })
            );
          }
        } catch (err) {
          toast.error(getApiErrorMessage(err, t('journey.editor.uploadFailed')));
        } finally {
          setUploadProgress(null);
        }
      }
      // link gallery photos that were picked before save
      if (pendingLinkIds.length > 0 && entryId) {
        for (const photoId of pendingLinkIds) {
          try {
            await journeyApi.linkPhoto(entryId, photoId);
          } catch {}
        }
      }
      onDone();
    } finally {
      setSaving(false);
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files?.length) return;
    // Queue files locally until Save so cancel/close actually discards. This
    // keeps photo behavior consistent with text fields — no silent persistence.
    const normalized = await normalizeImageFiles(files);
    setPendingFiles((prev) => [...prev, ...normalized]);
  };

  return (
    <div
      className="fixed inset-0 z-[9999]"
      style={{ background: 'rgba(9,9,11,0.6)', backdropFilter: 'blur(6px)', WebkitBackdropFilter: 'blur(6px)' }}
    >
      {/* The modal itself is constrained to the feed column on desktop so it
          centers there — but the backdrop stays full-width (covering the map
          too) for a uniform dim/blur across the whole page. */}
      <div
        className="absolute bottom-0 left-0 top-0 flex items-end sm:items-center sm:justify-center sm:p-5"
        style={{ right: isMobile ? 0 : 'clamp(420px, 44vw, 760px)' }}
      >
        <div
          className="flex h-full w-full flex-col overflow-hidden bg-white shadow-[0_20px_40px_rgba(0,0,0,0.2)] dark:bg-zinc-900 sm:h-auto sm:max-h-[90vh] sm:max-w-[640px] sm:rounded-2xl"
          style={{ paddingBottom: 'var(--bottom-nav-h)' }}
        >
          <div className="flex items-center justify-between border-b border-zinc-200 px-6 py-4 dark:border-zinc-700">
            <h2 className="text-[16px] font-bold text-zinc-900 dark:text-white">
              {entry.id === 0 ? t('journey.detail.newEntry') : t('journey.detail.editEntry')}
            </h2>
            <button
              onClick={handleClose}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800"
            >
              <X size={16} />
            </button>
          </div>

          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-6 py-5">
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t('journey.editor.titlePlaceholder')}
              className="w-full border-0 border-b border-transparent bg-transparent pb-2 text-[20px] font-medium text-zinc-900 outline-none placeholder:text-zinc-400 focus:border-zinc-300 dark:text-white dark:focus:border-zinc-600"
            />

            <div>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                multiple
                onChange={handleFileChange}
                onClick={(e) => {
                  (e.target as HTMLInputElement).value = '';
                }}
                className="hidden"
              />
              <div className="flex gap-2">
                <button
                  onClick={() => fileRef.current?.click()}
                  disabled={saving}
                  className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-dashed border-zinc-200 py-4 text-[12px] text-zinc-500 hover:border-zinc-400 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:hover:border-zinc-500 dark:hover:bg-zinc-800"
                >
                  {uploadProgress ? (
                    <>
                      <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-zinc-300 border-t-zinc-600" />{' '}
                      {t('journey.editor.uploadingProgress', {
                        done: String(uploadProgress.done),
                        total: String(uploadProgress.total),
                      })}
                    </>
                  ) : (
                    <>
                      <Plus size={13} /> {t('journey.editor.uploadPhotos')}
                    </>
                  )}
                </button>
                {galleryPhotos.length > 0 && (
                  <button
                    onClick={() => setShowGalleryPick(!showGalleryPick)}
                    className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg border py-4 text-[12px] text-zinc-500 ${
                      showGalleryPick
                        ? 'border-zinc-900 bg-zinc-50 dark:border-white dark:bg-zinc-800'
                        : 'border-dashed border-zinc-200 hover:border-zinc-400 hover:bg-zinc-50 dark:border-zinc-700 dark:hover:border-zinc-500 dark:hover:bg-zinc-800'
                    }`}
                  >
                    <Image size={13} /> {t('journey.editor.fromGallery')}
                  </button>
                )}
              </div>

              {/* Gallery picker — directly below buttons. Safari collapses
                `aspect-square` items inside an overflow-scroll grid, so
                the square is enforced with a padding-top spacer + an
                absolutely positioned image (works across all browsers). */}
              {showGalleryPick && (
                <div className="mt-2 rounded-xl border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-700 dark:bg-zinc-800/50">
                  <div className="grid max-h-[160px] grid-cols-5 gap-1.5 overflow-y-auto sm:grid-cols-6">
                    {availableGalleryPhotos.map((gp) => (
                      <div
                        key={gp.id}
                        onClick={async () => {
                          if (entry.id > 0) {
                            try {
                              const linked = await journeyApi.linkPhoto(entry.id, gp.id);
                              if (linked) setPhotos((prev) => [...prev, linked]);
                            } catch {}
                          } else {
                            setPendingLinkIds((prev) => [...prev, gp.id]);
                            setPhotos((prev) => [...prev, gp]);
                          }
                        }}
                        className="relative w-full cursor-pointer overflow-hidden rounded-lg transition-all hover:ring-2 hover:ring-zinc-900 hover:ring-offset-1 dark:hover:ring-white dark:hover:ring-offset-zinc-900"
                        style={{ paddingTop: '100%' }}
                      >
                        <img
                          src={photoUrl(gp)}
                          alt=""
                          className="absolute inset-0 h-full w-full object-cover"
                          loading="lazy"
                          onError={(e) => {
                            const img = e.currentTarget;
                            const orig = photoUrl(gp, 'original');
                            if (!img.src.includes('/original')) img.src = orig;
                          }}
                        />
                      </div>
                    ))}
                    {availableGalleryPhotos.length === 0 && (
                      <div className="col-span-full py-3 text-center text-[11px] text-zinc-400">
                        {t('journey.editor.allPhotosAdded')}
                      </div>
                    )}
                  </div>
                </div>
              )}
              {(photos.length > 0 || pendingFiles.length > 0) && (
                <div className="mt-3">
                  <div className="flex flex-wrap gap-2">
                    {photos.map((p, idx) => (
                      <div
                        key={p.id}
                        className={`group relative h-20 w-20 overflow-hidden rounded-lg ${idx === 0 && photos.length > 1 ? 'ring-2 ring-zinc-900 ring-offset-1 dark:ring-white dark:ring-offset-zinc-900' : ''}`}
                      >
                        <img
                          src={photoUrl(p)}
                          className="h-full w-full object-cover"
                          alt=""
                          onError={(e) => {
                            const img = e.currentTarget;
                            const orig = photoUrl(p, 'original');
                            if (!img.src.includes('/original')) img.src = orig;
                          }}
                        />
                        {idx === 0 && photos.length > 1 && (
                          <span className="absolute bottom-0.5 left-0.5 rounded bg-zinc-900/70 px-1 py-px text-[8px] font-bold text-white">
                            {t('journey.editor.photoFirst')}
                          </span>
                        )}
                        {idx > 0 && photos.length > 1 && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setPhotos((prev) => {
                                const next = [...prev];
                                const [moved] = next.splice(idx, 1);
                                next.unshift(moved);
                                next.forEach((ph, i) => {
                                  journeyApi.updatePhoto(ph.id, { sort_order: i }).catch(() => {});
                                });
                                return next;
                              });
                            }}
                            className="absolute bottom-0.5 left-0.5 rounded bg-black/60 px-1.5 py-0.5 text-[8px] font-semibold text-white opacity-0 transition-opacity group-hover:opacity-100"
                          >
                            {t('journey.editor.makeFirst')}
                          </button>
                        )}
                        <button
                          onClick={async (e) => {
                            e.stopPropagation();
                            setPhotos((prev) => prev.filter((x) => x.id !== p.id));
                            if (entry.id > 0) {
                              // unlink from entry; gallery row is preserved
                              try {
                                await journeyApi.unlinkPhoto(entry.id, p.id);
                              } catch {}
                            } else {
                              setPendingLinkIds((prev) => prev.filter((id) => id !== p.id));
                            }
                          }}
                          className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-black/60 text-white opacity-0 transition-opacity group-hover:opacity-100"
                        >
                          <X size={10} />
                        </button>
                      </div>
                    ))}
                    {pendingFiles.map((f, i) => (
                      <div key={`pending-${i}`} className="group relative h-20 w-20 overflow-hidden rounded-lg">
                        <img src={URL.createObjectURL(f)} className="h-full w-full object-cover" alt="" />
                        <button
                          onClick={() => setPendingFiles((prev) => prev.filter((_, j) => j !== i))}
                          className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-black/60 text-white opacity-0 transition-opacity group-hover:opacity-100"
                        >
                          <X size={10} />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="shrink-0 overflow-hidden rounded-lg border border-zinc-200 focus-within:border-zinc-400 dark:border-zinc-700 dark:focus-within:border-zinc-500">
              <MarkdownToolbar textareaRef={storyRef} onUpdate={setStory} />
              <textarea
                ref={storyRef}
                value={story}
                onChange={(e) => setStory(e.target.value)}
                placeholder={t('journey.editor.writeStory')}
                rows={6}
                style={{ minHeight: '144px' }}
                className="w-full shrink-0 resize-none border-0 bg-white px-3 py-2.5 text-[14px] text-zinc-900 outline-none dark:bg-zinc-800 dark:text-white"
              />
            </div>

            {/* Pros & Cons */}
            <div className="rounded-2xl bg-zinc-50 p-5 dark:bg-zinc-800/50">
              <div className="mb-4">
                <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-zinc-500">
                  {t('journey.editor.prosCons')}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-4">
                {/* Pros */}
                <div>
                  <div className="mb-2.5 flex items-center gap-[7px]">
                    <div className="flex h-4 w-4 items-center justify-center rounded-full bg-green-100 dark:bg-green-900/30">
                      <Check size={9} className="text-green-700 dark:text-green-400" strokeWidth={3.5} />
                    </div>
                    <span className="text-[12px] font-semibold text-green-700 dark:text-green-400">
                      {t('journey.editor.pros')}
                    </span>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    {pros.map((p, i) => (
                      <div
                        key={i}
                        className="flex h-9 items-center gap-2 rounded-[10px] border border-zinc-200 px-3 dark:border-zinc-700"
                      >
                        <span className="h-[5px] w-[5px] flex-shrink-0 rounded-full bg-green-500" />
                        <input
                          value={p}
                          onChange={(e) => {
                            const next = [...pros];
                            next[i] = e.target.value;
                            setPros(next);
                          }}
                          placeholder={t('journey.editor.proPlaceholder')}
                          className="min-w-0 flex-1 border-none bg-transparent text-[13px] text-zinc-900 outline-none placeholder:text-green-400 dark:text-zinc-100 dark:placeholder:text-green-600"
                        />
                        {pros.length > 1 && (
                          <button
                            onClick={() => setPros(pros.filter((_, j) => j !== i))}
                            className="flex-shrink-0 p-1 text-green-300 hover:text-green-600 dark:text-green-700 dark:hover:text-green-400"
                          >
                            <X size={13} strokeWidth={2.5} />
                          </button>
                        )}
                      </div>
                    ))}
                    <button
                      onClick={() => setPros([...pros, ''])}
                      className="flex h-9 w-full items-center justify-center gap-1.5 rounded-[10px] border border-dashed border-green-200 text-[12px] font-medium text-green-700 transition-colors hover:border-green-300 dark:border-green-800/40 dark:text-green-400 dark:hover:border-green-700"
                    >
                      <Plus size={13} strokeWidth={2.5} /> {t('journey.editor.addAnother')}
                    </button>
                  </div>
                </div>

                {/* Cons */}
                <div>
                  <div className="mb-2.5 flex items-center gap-[7px]">
                    <div className="flex h-4 w-4 items-center justify-center rounded-full bg-red-100 dark:bg-red-900/30">
                      <Minus size={9} className="text-red-700 dark:text-red-400" strokeWidth={3.5} />
                    </div>
                    <span className="text-[12px] font-semibold text-red-700 dark:text-red-400">
                      {t('journey.editor.cons')}
                    </span>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    {cons.map((c, i) => (
                      <div
                        key={i}
                        className="flex h-9 items-center gap-2 rounded-[10px] border border-zinc-200 px-3 dark:border-zinc-700"
                      >
                        <span className="h-[5px] w-[5px] flex-shrink-0 rounded-full bg-red-500" />
                        <input
                          value={c}
                          onChange={(e) => {
                            const next = [...cons];
                            next[i] = e.target.value;
                            setCons(next);
                          }}
                          placeholder={t('journey.editor.conPlaceholder')}
                          className="min-w-0 flex-1 border-none bg-transparent text-[13px] text-zinc-900 outline-none placeholder:text-red-400 dark:text-zinc-100 dark:placeholder:text-red-600"
                        />
                        {cons.length > 1 && (
                          <button
                            onClick={() => setCons(cons.filter((_, j) => j !== i))}
                            className="flex-shrink-0 p-1 text-red-300 hover:text-red-600 dark:text-red-700 dark:hover:text-red-400"
                          >
                            <X size={13} strokeWidth={2.5} />
                          </button>
                        )}
                      </div>
                    ))}
                    <button
                      onClick={() => setCons([...cons, ''])}
                      className="flex h-9 w-full items-center justify-center gap-1.5 rounded-[10px] border border-dashed border-red-200 text-[12px] font-medium text-red-700 transition-colors hover:border-red-300 dark:border-red-800/40 dark:text-red-400 dark:hover:border-red-700"
                    >
                      <Plus size={13} strokeWidth={2.5} /> {t('journey.editor.addAnother')}
                    </button>
                  </div>
                </div>
              </div>
            </div>

            <div className="h-px bg-zinc-200 dark:bg-zinc-700" />

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-500">
                  {t('journey.editor.date')}
                </label>
                <DatePicker value={entryDate} onChange={setEntryDate} tripDates={tripDates} />
              </div>
              <div className="relative">
                <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-500">
                  {t('journey.editor.location')}
                </label>
                <div className="relative">
                  <input
                    value={locationQuery || locationName}
                    onChange={(e) => {
                      const q = e.target.value;
                      setLocationQuery(q);
                      setShowLocationResults(true);
                      if (locationTimerRef.current) clearTimeout(locationTimerRef.current);
                      if (q.trim().length >= 2) {
                        locationTimerRef.current = setTimeout(async () => {
                          setLocationSearching(true);
                          try {
                            const res = await mapsApi.search(q);
                            setLocationResults(
                              (res.places || []).slice(0, 6).map((p: any) => ({
                                name: p.name,
                                address: p.address,
                                lat: Number(p.lat),
                                lng: Number(p.lng),
                              }))
                            );
                          } catch {
                            setLocationResults([]);
                          } finally {
                            setLocationSearching(false);
                          }
                        }, 400);
                      } else {
                        setLocationResults([]);
                      }
                    }}
                    onFocus={() => {
                      if (locationResults.length > 0) setShowLocationResults(true);
                    }}
                    placeholder={t('journey.editor.searchLocation')}
                    className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-[13px] text-zinc-900 outline-none focus:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-800 dark:text-white dark:focus:border-zinc-500"
                  />
                  {locationLat && (
                    <div className="absolute right-2 top-1/2 -translate-y-1/2">
                      <MapPin size={13} className="text-zinc-500 dark:text-zinc-400" />
                    </div>
                  )}
                </div>
                {showLocationResults && locationResults.length > 0 && (
                  <>
                    <div className="fixed inset-0 z-[99]" onClick={() => setShowLocationResults(false)} />
                    <div className="absolute left-0 right-0 top-full z-[100] mt-1 max-h-[240px] overflow-hidden overflow-y-auto rounded-xl border border-zinc-200 bg-white shadow-lg dark:border-zinc-700 dark:bg-zinc-800">
                      {locationResults.map((r, i) => (
                        <button
                          key={i}
                          onClick={() => {
                            setLocationName(r.name);
                            setLocationLat(r.lat);
                            setLocationLng(r.lng);
                            setLocationQuery('');
                            setShowLocationResults(false);
                            setLocationResults([]);
                          }}
                          className="flex w-full items-start gap-2.5 border-b border-zinc-100 px-3 py-2.5 text-left last:border-0 hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-700"
                        >
                          <MapPin size={13} className="mt-0.5 flex-shrink-0 text-zinc-400" />
                          <div className="min-w-0">
                            <div className="truncate text-[13px] font-medium text-zinc-900 dark:text-white">
                              {r.name}
                            </div>
                            {r.address && <div className="truncate text-[11px] text-zinc-500">{r.address}</div>}
                          </div>
                        </button>
                      ))}
                    </div>
                  </>
                )}
                {locationSearching && (
                  <div className="absolute left-0 right-0 top-full z-[100] mt-1 rounded-xl border border-zinc-200 bg-white px-3 py-3 text-center text-[12px] text-zinc-400 shadow-lg dark:border-zinc-700 dark:bg-zinc-800">
                    {t('journey.editor.searching')}
                  </div>
                )}
              </div>
            </div>

            <div>
              <label className="mb-2 block text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-500">
                {t('journey.editor.mood')}
              </label>
              <div className="flex gap-2">
                {Object.entries(MOOD_CONFIG).map(([key, config]) => {
                  const Icon = config.icon;
                  const active = mood === key;
                  return (
                    <button
                      key={key}
                      onClick={() => setMood(active ? '' : key)}
                      className={`flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-all ${
                        active ? '' : 'border-zinc-200 text-zinc-500 dark:border-zinc-700'
                      }`}
                      style={
                        active
                          ? { background: config.bg, color: config.text, borderColor: config.text + '30' }
                          : undefined
                      }
                    >
                      <Icon size={12} />
                      {t(config.label)}
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <label className="mb-2 block text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-500">
                {t('journey.editor.weather')}
              </label>
              <div className="flex flex-wrap gap-2">
                {Object.entries(WEATHER_CONFIG).map(([key, config]) => {
                  const Icon = config.icon;
                  const active = weather === key;
                  return (
                    <button
                      key={key}
                      onClick={() => setWeather(active ? '' : key)}
                      className={`flex items-center gap-1 rounded-full border px-2 py-1 text-[11px] font-medium transition-all ${
                        active
                          ? 'border-zinc-900 bg-zinc-900 text-white dark:border-white dark:bg-white dark:text-zinc-900'
                          : 'border-zinc-200 text-zinc-500 hover:border-zinc-400 dark:border-zinc-700'
                      }`}
                    >
                      <Icon size={12} />
                      {t(config.label)}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          <div
            className="flex items-center justify-end gap-2 border-t border-zinc-200 bg-zinc-50 px-6 py-4 dark:border-zinc-700 dark:bg-zinc-800/50"
            style={{ paddingBottom: 'max(16px, env(safe-area-inset-bottom, 16px))' }}
          >
            <button
              onClick={handleClose}
              className="rounded-lg border border-zinc-200 px-3.5 py-2 text-[13px] font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-700"
            >
              {t('common.cancel')}
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="rounded-lg bg-zinc-900 px-3.5 py-2 text-[13px] font-medium text-white hover:bg-zinc-800 disabled:opacity-50 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-100"
            >
              {saving ? t('common.saving') : t('common.save')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
