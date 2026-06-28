import { Camera, Image, Plus, RefreshCw, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { addonsApi, journeyApi } from '../../api/client';
import { useTranslation } from '../../i18n';
import { photoUrl } from '../../pages/journeyDetail/JourneyDetailPage.helpers';
import type { GalleryPhoto, JourneyEntry, JourneyTrip } from '../../store/journeyStore';
import { useJourneyStore } from '../../store/journeyStore';
import { getApiErrorMessage } from '../../types';
import { normalizeImageFiles } from '../../utils/convertHeic';
import { useToast } from '../shared/Toast';
import { ProviderPicker } from './JourneyDetailPageProviderPicker';

export function GalleryView({
  entries,
  gallery,
  journeyId,
  userId,
  trips,
  onPhotoClick,
  onRefresh,
}: {
  entries: JourneyEntry[];
  gallery: GalleryPhoto[];
  journeyId: number;
  userId: number;
  trips: JourneyTrip[];
  onPhotoClick: (photos: GalleryPhoto[], index: number) => void;
  onRefresh: () => void;
}) {
  const { t } = useTranslation();
  const [showPicker, setShowPicker] = useState(false);
  const [pickerProvider, setPickerProvider] = useState<string | null>(null);
  const [availableProviders, setAvailableProviders] = useState<{ id: string; name: string }[]>([]);
  const [galleryProgress, setGalleryProgress] = useState<{ done: number; total: number } | null>(null);
  const galleryUploading = galleryProgress !== null;
  const toast = useToast();

  // check which providers are enabled AND connected for the current user
  useEffect(() => {
    (async () => {
      try {
        const addonsData = await addonsApi.enabled();
        const enabledProviders = (addonsData.addons || []).filter((a: any) => a.type === 'photo_provider' && a.enabled);
        const connected: { id: string; name: string }[] = [];
        for (const p of enabledProviders) {
          try {
            const res = await fetch(`/api/integrations/memories/${p.id}/status`, { credentials: 'include' });
            if (res.ok) {
              const status = await res.json();
              if (status.connected) connected.push({ id: p.id, name: p.name });
            }
          } catch {}
        }
        setAvailableProviders(connected);
      } catch {}
    })();
  }, []);

  const allPhotos = gallery;

  const entriesWithContent = entries.filter((e) => e.type !== 'skeleton' || e.title);

  const browseProvider = (provider: string) => {
    setPickerProvider(provider);
    setShowPicker(true);
  };

  const galleryFileRef = useRef<HTMLInputElement>(null);

  const handleGalleryUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files?.length) return;
    setGalleryProgress({ done: 0, total: files.length });
    try {
      const normalized = await normalizeImageFiles(files);
      const { failed } = await useJourneyStore.getState().uploadGalleryPhotos(journeyId, normalized, {
        onProgress: (p) => setGalleryProgress({ done: p.done, total: p.total }),
      });
      if (failed.length > 0) {
        toast.error(
          t('journey.editor.uploadPartialFailed', { failed: String(failed.length), total: String(normalized.length) })
        );
      } else {
        toast.success(t('journey.photosUploaded', { count: String(files.length) }));
      }
      onRefresh();
    } catch (err) {
      toast.error(getApiErrorMessage(err, t('journey.photosUploadFailed')));
    } finally {
      setGalleryProgress(null);
    }
    e.target.value = '';
  };

  const handleDeletePhoto = async (galleryPhotoId: number) => {
    const store = useJourneyStore.getState();
    if (!store.current) return;

    // Optimistic update — remove from gallery and all entry photo lists
    useJourneyStore.setState({
      current: {
        ...store.current,
        gallery: (store.current.gallery || []).filter((p) => p.id !== galleryPhotoId),
        entries: store.current.entries.map((e) => ({
          ...e,
          photos: e.photos.filter((p) => p.id !== galleryPhotoId),
        })),
      },
    });

    try {
      await journeyApi.deleteGalleryPhoto(journeyId, galleryPhotoId);
    } catch {
      toast.error(t('common.error'));
      onRefresh();
    }
  };

  return (
    <div>
      <input
        ref={galleryFileRef}
        type="file"
        accept="image/*"
        multiple
        onChange={handleGalleryUpload}
        className="hidden"
      />

      {/* Header */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1 rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-medium text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
          <Camera size={10} /> {allPhotos.length} {t('journey.detail.photos')}
        </span>
        <div className="flex items-center gap-2">
          <button
            onClick={() => galleryFileRef.current?.click()}
            disabled={galleryUploading}
            className="inline-flex items-center gap-1.5 rounded-lg bg-zinc-900 px-2.5 py-1.5 text-[11px] font-medium text-white hover:bg-zinc-800 disabled:opacity-50 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-100"
          >
            {galleryUploading ? (
              <>
                <div className="h-3 w-3 animate-spin rounded-full border-2 border-white/30 border-t-white dark:border-zinc-900/30 dark:border-t-zinc-900" />{' '}
                {galleryProgress
                  ? t('journey.editor.uploadingProgress', {
                      done: String(galleryProgress.done),
                      total: String(galleryProgress.total),
                    })
                  : t('journey.editor.uploading')}
              </>
            ) : (
              <>
                <Plus size={12} /> {t('common.upload')}
              </>
            )}
          </button>
          {availableProviders.map((p) => (
            <button
              key={p.id}
              onClick={() => browseProvider(p.id)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 px-2.5 py-1.5 text-[11px] font-medium text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800"
            >
              <Image size={12} />
              {p.name}
            </button>
          ))}
        </div>
      </div>

      {allPhotos.length === 0 ? (
        <div className="py-16 text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-zinc-100 dark:bg-zinc-800">
            <Image size={24} className="text-zinc-400" />
          </div>
          <p className="text-[15px] font-medium text-zinc-700 dark:text-zinc-300">{t('journey.detail.noPhotos')}</p>
          <p className="mt-1 text-[12px] text-zinc-500">{t('journey.detail.noPhotosHint')}</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-1.5 pb-24 sm:grid-cols-3 md:grid-cols-4 md:pb-6">
          {allPhotos.map((photo, i) => (
            <div
              key={photo.id}
              className="group relative aspect-square cursor-pointer overflow-hidden rounded-lg"
              onClick={() => onPhotoClick(allPhotos, i)}
            >
              <img
                src={photoUrl(photo, 'thumbnail')}
                alt={photo.caption || ''}
                className="h-full w-full object-cover transition-transform group-hover:scale-105"
                loading="lazy"
              />
              <div className="absolute inset-0 bg-black/0 transition-colors group-hover:bg-black/20" />
              {/* Delete button */}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleDeletePhoto(photo.id);
                }}
                className="absolute right-1.5 top-1.5 z-10 flex h-6 w-6 items-center justify-center rounded-full bg-black/60 text-white opacity-0 backdrop-blur transition-opacity group-hover:opacity-100"
              >
                <X size={12} />
              </button>
              {photo.provider && photo.provider !== 'local' && (
                <div className="absolute left-1.5 top-1.5">
                  <span className="flex items-center gap-1 rounded-full bg-black/70 px-1.5 py-0.5 text-[8px] font-medium text-white backdrop-blur">
                    <RefreshCw size={7} />
                    {photo.provider === 'immich'
                      ? 'Immich'
                      : photo.provider === 'synology'
                        ? 'Synology'
                        : photo.provider}
                  </span>
                </div>
              )}
              {photo.caption && (
                <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/60 to-transparent p-2 opacity-0 transition-opacity group-hover:opacity-100">
                  <p className="truncate text-[10px] text-white">{photo.caption}</p>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Provider Photo Picker Modal */}
      {showPicker && (
        <ProviderPicker
          provider={pickerProvider!}
          userId={userId}
          entries={entriesWithContent}
          trips={trips}
          existingAssetIds={new Set(gallery.filter((p) => p.asset_id).map((p) => p.asset_id!))}
          onClose={() => setShowPicker(false)}
          onAdd={async (groups, entryId) => {
            let added = 0;
            let anyFailed = false;
            for (const group of groups) {
              try {
                if (entryId) {
                  const result = await journeyApi.addProviderPhotos(
                    entryId,
                    pickerProvider!,
                    group.assetIds,
                    undefined,
                    group.passphrase
                  );
                  added += result.added || 0;
                } else {
                  const result = await journeyApi.addProviderPhotosToGallery(
                    journeyId,
                    pickerProvider!,
                    group.assetIds,
                    group.passphrase
                  );
                  added += result.added || 0;
                }
              } catch {
                anyFailed = true;
              }
            }
            if (added > 0) {
              toast.success(t('journey.photosAdded', { count: added }));
              onRefresh();
            } else if (anyFailed) {
              toast.error(t('common.error'));
            }
            setShowPicker(false);
          }}
        />
      )}
    </div>
  );
}
