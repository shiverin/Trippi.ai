import {
  Camera,
  Clock,
  Cloud,
  CloudLightning,
  CloudRain,
  CloudSun,
  Frown,
  Laugh,
  MapPin,
  Meh,
  Pencil,
  Smile,
  Snowflake,
  Sun,
  ThumbsDown,
  ThumbsUp,
  Trash2,
  X,
} from 'lucide-react';
import type { JourneyEntry, JourneyPhoto } from '../../store/journeyStore';
import { formatLocationName } from '../../utils/formatters';
import JournalBody from './JournalBody';

const MOOD_CONFIG: Record<string, { icon: typeof Smile; label: string; bg: string; text: string }> = {
  amazing: {
    icon: Laugh,
    label: 'Amazing',
    bg: 'bg-pink-50 dark:bg-pink-900/20',
    text: 'text-pink-600 dark:text-pink-400',
  },
  good: {
    icon: Smile,
    label: 'Good',
    bg: 'bg-amber-50 dark:bg-amber-900/20',
    text: 'text-amber-600 dark:text-amber-400',
  },
  neutral: {
    icon: Meh,
    label: 'Neutral',
    bg: 'bg-zinc-100 dark:bg-zinc-800',
    text: 'text-zinc-500 dark:text-zinc-400',
  },
  rough: {
    icon: Frown,
    label: 'Rough',
    bg: 'bg-violet-50 dark:bg-violet-900/20',
    text: 'text-violet-600 dark:text-violet-400',
  },
};

const WEATHER_CONFIG: Record<string, { icon: typeof Sun; label: string }> = {
  sunny: { icon: Sun, label: 'Sunny' },
  partly: { icon: CloudSun, label: 'Partly cloudy' },
  cloudy: { icon: Cloud, label: 'Cloudy' },
  rainy: { icon: CloudRain, label: 'Rainy' },
  stormy: { icon: CloudLightning, label: 'Stormy' },
  cold: { icon: Snowflake, label: 'Cold' },
};

function photoUrl(
  p: JourneyPhoto,
  size: 'thumbnail' | 'original' = 'original',
  builder?: (id: number) => string
): string {
  if (builder) return builder(p.photo_id);
  return `/api/photos/${p.photo_id}/${size}`;
}

interface Props {
  entry: JourneyEntry;
  readOnly?: boolean;
  publicPhotoUrl?: (photoId: number) => string;
  onClose: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onPhotoClick: (photos: JourneyPhoto[], index: number) => void;
}

export default function MobileEntryView({
  entry,
  readOnly,
  publicPhotoUrl,
  onClose,
  onEdit,
  onDelete,
  onPhotoClick,
}: Props) {
  const photos = entry.photos || [];
  const mood = entry.mood ? MOOD_CONFIG[entry.mood] : null;
  const weather = entry.weather ? WEATHER_CONFIG[entry.weather] : null;
  const prosArr = entry.pros_cons?.pros ?? [];
  const consArr = entry.pros_cons?.cons ?? [];
  const hasProscons = prosArr.length > 0 || consArr.length > 0;

  const date = new Date(entry.entry_date + 'T00:00:00');
  const dateStr = date.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });

  return (
    <div
      className="fixed inset-0 z-[9999] flex flex-col overflow-hidden bg-white dark:bg-zinc-950"
      style={{ height: '100dvh' }}
    >
      {/* Top bar */}
      <div className="flex flex-shrink-0 items-center justify-between border-b border-zinc-100 px-4 py-3 dark:border-zinc-800">
        <button
          onClick={onClose}
          className="flex h-9 w-9 items-center justify-center rounded-lg text-zinc-500 transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-800"
        >
          <X size={20} />
        </button>
        {!readOnly && (
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => {
                onClose();
                onEdit();
              }}
              className="flex h-8 items-center gap-1.5 rounded-lg bg-zinc-100 px-3 text-[12px] font-medium text-zinc-700 transition-colors hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
            >
              <Pencil size={13} />
              Edit
            </button>
            <button
              onClick={() => {
                onClose();
                onDelete();
              }}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-zinc-400 transition-colors hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-900/20 dark:hover:text-red-400"
            >
              <Trash2 size={15} />
            </button>
          </div>
        )}
      </div>

      {/* Scrollable content */}
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain" style={{ WebkitOverflowScrolling: 'touch' }}>
        {/* Hero photo(s) */}
        {photos.length > 0 && (
          <div className="relative">
            <img
              src={photoUrl(photos[0], 'original', publicPhotoUrl)}
              alt=""
              className="max-h-[50vh] w-full cursor-pointer object-cover"
              onClick={() => onPhotoClick(photos, 0)}
            />
            {photos.length > 1 && (
              <div className="absolute bottom-3 right-3 flex items-center gap-1 rounded-full bg-black/60 px-2.5 py-1 text-[11px] font-medium text-white backdrop-blur-sm">
                <Camera size={12} />
                {photos.length} photos
              </div>
            )}
            {/* Photo strip for multiple photos */}
            {photos.length > 1 && (
              <div className="flex gap-1 overflow-x-auto bg-zinc-50 px-4 py-2 dark:bg-zinc-900">
                {photos.map((p, i) => (
                  <img
                    key={p.id || i}
                    src={photoUrl(p, 'thumbnail', publicPhotoUrl)}
                    alt=""
                    className="h-16 w-16 flex-shrink-0 cursor-pointer rounded-lg object-cover ring-zinc-900/30 transition-all hover:ring-2 dark:ring-white/30"
                    onClick={() => onPhotoClick(photos, i)}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {/* Content */}
        <div className="px-5 py-5 pb-32">
          {/* Date + time + location header */}
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <span className="text-[12px] font-medium text-zinc-500">{dateStr}</span>
            {entry.entry_time && (
              <span className="flex items-center gap-1 text-[12px] text-zinc-400">
                <Clock size={11} />
                {entry.entry_time.slice(0, 5)}
              </span>
            )}
          </div>

          {entry.location_name && (
            <div className="mb-3">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-zinc-100 px-2.5 py-1 text-[12px] font-medium text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
                <MapPin size={12} className="flex-shrink-0 text-zinc-500 dark:text-zinc-400" />
                {formatLocationName(entry.location_name)}
              </span>
            </div>
          )}

          {/* Title */}
          {entry.title && (
            <h1 className="mb-4 text-[22px] font-bold leading-tight tracking-tight text-zinc-900 dark:text-white">
              {entry.title}
            </h1>
          )}

          {/* Mood + Weather chips */}
          {(mood || weather) && (
            <div className="mb-4 flex items-center gap-2">
              {mood && (
                <span
                  className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold ${mood.bg} ${mood.text}`}
                >
                  <mood.icon size={13} />
                  {mood.label}
                </span>
              )}
              {weather && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-zinc-100 px-2.5 py-1 text-[11px] font-semibold text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
                  <weather.icon size={13} />
                  {weather.label}
                </span>
              )}
            </div>
          )}

          {/* Story */}
          {entry.story && (
            <div className="mb-5 text-[14px] leading-relaxed text-zinc-700 dark:text-zinc-300">
              <JournalBody text={entry.story} />
            </div>
          )}

          {/* Tags */}
          {entry.tags && entry.tags.length > 0 && (
            <div className="mb-5 flex flex-wrap gap-1.5">
              {entry.tags.map((tag, i) => (
                <span
                  key={i}
                  className="rounded-full bg-indigo-50 px-2 py-0.5 text-[11px] font-medium text-indigo-600 dark:bg-indigo-900/30 dark:text-indigo-400"
                >
                  {tag}
                </span>
              ))}
            </div>
          )}

          {/* Pros & Cons */}
          {hasProscons && (
            <div className="mb-5 overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-700">
              {prosArr.length > 0 && (
                <div className="px-4 py-3">
                  <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-emerald-600 dark:text-emerald-400">
                    <ThumbsUp size={12} /> Pros
                  </div>
                  <ul className="space-y-1">
                    {prosArr.map((p, i) => (
                      <li key={i} className="flex items-start gap-2 text-[13px] text-zinc-700 dark:text-zinc-300">
                        <span className="mt-0.5 text-emerald-500">+</span> {p}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {prosArr.length > 0 && consArr.length > 0 && (
                <div className="border-t border-zinc-200 dark:border-zinc-700" />
              )}
              {consArr.length > 0 && (
                <div className="px-4 py-3">
                  <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-red-500 dark:text-red-400">
                    <ThumbsDown size={12} /> Cons
                  </div>
                  <ul className="space-y-1">
                    {consArr.map((c, i) => (
                      <li key={i} className="flex items-start gap-2 text-[13px] text-zinc-700 dark:text-zinc-300">
                        <span className="mt-0.5 text-red-500">−</span> {c}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
