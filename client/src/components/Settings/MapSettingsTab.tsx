import { Box, Check, ChevronDown, Globe2, Layers, Lock, Map, Save } from 'lucide-react';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMapEntitlements } from '../../hooks/useMapEntitlements';
import { useTranslation } from '../../i18n';
import { useSettingsStore } from '../../store/settingsStore';
import type { Place } from '../../types';
import {
  MAPBOX_DEFAULT_STYLE,
  defaultStyleForProvider,
  getStylePresets,
  isOpenFreeMapStyle,
  normalizeStyleForProvider,
  type GlMapProvider,
} from '../Map/glProviders';
import { MapView } from '../Map/MapView';
import { normalizeLeafletTileUrl } from '../Map/tileUrls';
import CustomSelect from '../shared/CustomSelect';
import { useToast } from '../shared/Toast';
import GlMapPreview from './MapboxPreview';
import Section from './Section';
import ToggleSwitch from './ToggleSwitch';

interface MapPreset {
  name: string;
  url: string;
}

const MAP_PRESETS: MapPreset[] = [
  { name: 'OpenStreetMap', url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png' },
  { name: 'OpenStreetMap DE', url: 'https://tile.openstreetmap.de/{z}/{x}/{y}.png' },
  { name: 'CartoDB Light', url: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png' },
  { name: 'CartoDB Dark', url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png' },
];

// Tag → chip color mapping. Keeps the dropdown readable at a glance so a
// user scanning the list can spot 3D / Satellite / Apple-like styles.
const TAG_STYLES: Record<string, string> = {
  '3D': 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-300',
  '2D': 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  Satellite: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300',
  'Apple-like': 'bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300',
  Modern: 'bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300',
  Dark: 'bg-zinc-800 text-zinc-100 dark:bg-zinc-900 dark:text-zinc-300',
  Minimal: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
  Hillshading: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
  Terrain: 'bg-lime-100 text-lime-800 dark:bg-lime-900/40 dark:text-lime-300',
  Realistic: 'bg-teal-100 text-teal-800 dark:bg-teal-900/40 dark:text-teal-300',
  Navigation: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300',
  Classic: 'bg-stone-100 text-stone-700 dark:bg-stone-800 dark:text-stone-300',
  Hybrid: 'bg-cyan-100 text-cyan-800 dark:bg-cyan-900/40 dark:text-cyan-300',
  'No labels': 'bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300',
  OpenFreeMap: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300',
};

function TagChip({ tag }: { tag: string }) {
  const cls = TAG_STYLES[tag] || 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300';
  return (
    <span className={`rounded px-1.5 py-[3px] text-[9px] font-semibold uppercase leading-none tracking-wide ${cls}`}>
      {tag}
    </span>
  );
}

function StyleDropdown({
  value,
  provider,
  onChange,
}: {
  value: string;
  provider: GlMapProvider;
  onChange: (v: string) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const presets = getStylePresets(provider);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const selected = presets.find((p) => p.url === value);
  const placeholder =
    provider === 'maplibre-gl' ? t('settings.mapOpenFreeMapStylePlaceholder') : t('settings.mapStylePlaceholder');

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm hover:border-slate-400 focus:border-transparent focus:ring-2 focus:ring-slate-400 dark:border-slate-700 dark:bg-slate-900"
      >
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate text-slate-900 dark:text-white">{selected ? selected.name : placeholder}</span>
          {selected && (
            <span className="flex flex-shrink-0 items-center gap-1">
              {(selected.tags || []).map((t) => (
                <TagChip key={t} tag={t} />
              ))}
            </span>
          )}
        </span>
        <ChevronDown size={14} className="flex-shrink-0 text-slate-400" />
      </button>
      {open && (
        <div className="absolute z-20 mt-1 max-h-80 w-full overflow-auto rounded-lg border border-slate-200 bg-white py-1 shadow-lg dark:border-slate-700 dark:bg-slate-900">
          {presets.map((preset) => {
            const isActive = preset.url === value;
            return (
              <button
                key={preset.url}
                type="button"
                onClick={() => {
                  onChange(preset.url);
                  setOpen(false);
                }}
                className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-slate-50 dark:hover:bg-slate-800 ${isActive ? 'bg-slate-50 dark:bg-slate-800' : ''}`}
              >
                <span className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-slate-900 dark:text-white">{preset.name}</span>
                  {(preset.tags || []).map((t) => (
                    <TagChip key={t} tag={t} />
                  ))}
                </span>
                {isActive && <Check size={14} className="flex-shrink-0 text-slate-900 dark:text-white" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

type Provider = 'leaflet' | GlMapProvider;

function normalizeProvider(value: unknown): Provider {
  return value === 'mapbox-gl' || value === 'maplibre-gl' ? value : 'leaflet';
}

function styleForProvider(provider: Provider, style?: string | null): string {
  if (provider === 'leaflet') return style || MAPBOX_DEFAULT_STYLE;
  if (provider === 'mapbox-gl' && isOpenFreeMapStyle(style)) return MAPBOX_DEFAULT_STYLE;
  return normalizeStyleForProvider(provider, style);
}

// Each GL provider has its own style slot, so toggling providers never clobbers the
// other one's style. Leaflet/Mapbox use mapbox_style; MapLibre uses maplibre_style.
function slotStyle(provider: Provider, s: { mapbox_style?: string; maplibre_style?: string }): string | undefined {
  return provider === 'maplibre-gl' ? s.maplibre_style : s.mapbox_style;
}

export default function MapSettingsTab(): React.ReactElement {
  const { settings, updateSettings } = useSettingsStore();
  const { t } = useTranslation();
  const toast = useToast();
  const mapEntitlements = useMapEntitlements();
  const initialProvider = normalizeProvider(settings.map_provider);
  const [saving, setSaving] = useState(false);
  const [provider, setProvider] = useState<Provider>(initialProvider);
  const [mapTileUrl, setMapTileUrl] = useState<string>(normalizeLeafletTileUrl(settings.map_tile_url));
  const [mapboxStyle, setMapboxStyle] = useState<string>(
    styleForProvider(initialProvider, slotStyle(initialProvider, settings))
  );
  const [mapbox3d, setMapbox3d] = useState<boolean>(settings.mapbox_3d_enabled !== false);
  const [mapboxQuality, setMapboxQuality] = useState<boolean>(settings.mapbox_quality_mode === true);
  const [defaultLat, setDefaultLat] = useState<number | string>(settings.default_lat || 48.8566);
  const [defaultLng, setDefaultLng] = useState<number | string>(settings.default_lng || 2.3522);
  const [defaultZoom, setDefaultZoom] = useState<number | string>(settings.default_zoom || 10);
  const freeMapLocked = mapEntitlements.freeMapLocked;
  const effectiveProvider: Provider = freeMapLocked ? 'leaflet' : provider;

  useEffect(() => {
    const nextProvider = normalizeProvider(settings.map_provider);
    setProvider(nextProvider);
    setMapTileUrl(normalizeLeafletTileUrl(settings.map_tile_url));
    setMapboxStyle(styleForProvider(nextProvider, slotStyle(nextProvider, settings)));
    setMapbox3d(settings.mapbox_3d_enabled !== false);
    setMapboxQuality(settings.mapbox_quality_mode === true);
    setDefaultLat(settings.default_lat || 48.8566);
    setDefaultLng(settings.default_lng || 2.3522);
    setDefaultZoom(settings.default_zoom || 10);
  }, [settings]);

  useEffect(() => {
    if (!freeMapLocked) return;
    setProvider('leaflet');
    setMapTileUrl('');
    setMapbox3d(false);
    setMapboxQuality(false);
  }, [freeMapLocked]);

  const handleMapClick = useCallback((mapInfo) => {
    setDefaultLat(mapInfo.latlng.lat);
    setDefaultLng(mapInfo.latlng.lng);
  }, []);

  const mapPlaces = useMemo(
    (): Place[] => [
      {
        id: 1,
        trip_id: 1,
        name: 'Default map center',
        description: '',
        lat: defaultLat as number,
        lng: defaultLng as number,
        address: '',
        category_id: 0,
        price: null,
        image_url: null,
        google_place_id: null,
        osm_id: null,
        route_geometry: null,
        place_time: null,
        end_time: null,
        created_at: Date(),
      },
    ],
    [defaultLat, defaultLng]
  );

  const saveMapSettings = async (): Promise<void> => {
    setSaving(true);
    try {
      const saveProvider = freeMapLocked ? 'leaflet' : provider;
      const glStyle = saveProvider === 'leaflet' ? mapboxStyle : normalizeStyleForProvider(saveProvider, mapboxStyle);
      setMapboxStyle(glStyle);
      // Save into the active provider's own slot so the other provider's style survives.
      const stylePatch = freeMapLocked
        ? { mapbox_style: MAPBOX_DEFAULT_STYLE, maplibre_style: '' }
        : saveProvider === 'maplibre-gl'
          ? { maplibre_style: glStyle }
          : { mapbox_style: glStyle };
      await updateSettings({
        map_provider: saveProvider,
        map_tile_url: freeMapLocked ? '' : normalizeLeafletTileUrl(mapTileUrl),
        ...stylePatch,
        mapbox_3d_enabled: freeMapLocked ? false : mapbox3d,
        mapbox_quality_mode: freeMapLocked ? false : mapboxQuality,
        default_lat: parseFloat(String(defaultLat)),
        default_lng: parseFloat(String(defaultLng)),
        default_zoom: parseInt(String(defaultZoom)),
      });
      toast.success(t('settings.toast.mapSaved'));
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : t('common.error'));
    } finally {
      setSaving(false);
    }
  };

  // 3D is available on every style now — pure satellite uses the
  // mapbox-streets-v8 tileset as a fallback building source.
  const supports3d = true;
  const changeProvider = (nextProvider: Provider) => {
    if (freeMapLocked && nextProvider !== 'leaflet') return;
    setProvider(nextProvider);
    if (nextProvider !== 'leaflet') setMapboxStyle(styleForProvider(nextProvider, mapboxStyle));
  };

  return (
    <Section title={t('settings.map')} icon={Map}>
      {/* Provider picker — big cards so the choice is obvious */}
      <div>
        <label className="mb-2 block text-sm font-medium text-slate-700">{t('settings.mapProvider')}</label>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <button
            type="button"
            onClick={() => changeProvider('leaflet')}
            className={`flex items-start gap-3 rounded-lg border p-3 text-left transition-colors ${
              effectiveProvider === 'leaflet'
                ? 'border-slate-900 bg-slate-50 dark:border-slate-200 dark:bg-slate-800'
                : 'border-slate-200 hover:border-slate-400 dark:border-slate-700'
            }`}
          >
            <Layers size={18} className="mt-0.5 flex-shrink-0 text-slate-700 dark:text-slate-300" />
            <div>
              <div className="text-sm font-medium text-slate-900 dark:text-white">Leaflet</div>
              <div className="mt-0.5 hidden text-xs text-slate-500 sm:block">{t('settings.mapLeafletSubtitle')}</div>
            </div>
          </button>
          <button
            type="button"
            disabled={freeMapLocked}
            onClick={() => changeProvider('mapbox-gl')}
            className={`relative flex items-start gap-3 rounded-lg border p-3 text-left transition-colors ${
              effectiveProvider === 'mapbox-gl'
                ? 'border-slate-900 bg-slate-50 dark:border-slate-200 dark:bg-slate-800'
                : freeMapLocked
                  ? 'border-slate-200 bg-slate-50 opacity-60 dark:border-slate-700 dark:bg-slate-900'
                  : 'border-slate-200 hover:border-slate-400 dark:border-slate-700'
            }`}
          >
            <Box size={18} className="mt-0.5 flex-shrink-0 text-slate-700 dark:text-slate-300" />
            <div className="min-w-0">
              <div className="text-sm font-medium text-slate-900 dark:text-white">
                <span className="sm:hidden">Mapbox</span>
                <span className="hidden sm:inline">Mapbox GL</span>
              </div>
              <div className="mt-0.5 hidden text-xs text-slate-500 sm:block">{t('settings.mapMapboxSubtitle')}</div>
            </div>
            {/* Experimental badge only on ≥sm; on mobile there's no room next to the title. */}
            <span className="absolute right-2 top-2 hidden rounded bg-amber-100 px-1.5 py-[3px] text-[9px] font-semibold uppercase leading-none tracking-wide text-amber-800 dark:bg-amber-900/40 dark:text-amber-300 sm:inline-block">
              {freeMapLocked ? t('settings.mapLockedBadge') : t('settings.mapExperimental')}
            </span>
          </button>
          <button
            type="button"
            disabled={freeMapLocked}
            onClick={() => changeProvider('maplibre-gl')}
            className={`relative flex items-start gap-3 rounded-lg border p-3 text-left transition-colors ${
              effectiveProvider === 'maplibre-gl'
                ? 'border-slate-900 bg-slate-50 dark:border-slate-200 dark:bg-slate-800'
                : freeMapLocked
                  ? 'border-slate-200 bg-slate-50 opacity-60 dark:border-slate-700 dark:bg-slate-900'
                  : 'border-slate-200 hover:border-slate-400 dark:border-slate-700'
            }`}
          >
            <Globe2 size={18} className="mt-0.5 flex-shrink-0 text-slate-700 dark:text-slate-300" />
            <div className="min-w-0">
              <div className="text-sm font-medium text-slate-900 dark:text-white">
                <span className="sm:hidden">MapLibre</span>
                <span className="hidden sm:inline">MapLibre GL</span>
              </div>
              <div className="mt-0.5 hidden text-xs text-slate-500 sm:block">{t('settings.mapMapLibreSubtitle')}</div>
            </div>
            {freeMapLocked && (
              <span className="absolute right-2 top-2 hidden rounded bg-slate-200 px-1.5 py-[3px] text-[9px] font-semibold uppercase leading-none tracking-wide text-slate-600 dark:bg-slate-700 dark:text-slate-300 sm:inline-block">
                {t('settings.mapLockedBadge')}
              </span>
            )}
          </button>
        </div>
        <p className="mt-2 text-xs text-slate-400">{t('settings.mapProviderHint')}</p>
        {freeMapLocked && (
          <div className="mt-3 flex items-start gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm dark:border-slate-700 dark:bg-slate-900">
            <Lock className="mt-0.5 h-4 w-4 flex-shrink-0 text-slate-500" />
            <div>
              <div className="font-medium text-slate-900 dark:text-white">{t('settings.mapPremiumLockedTitle')}</div>
              <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                {t('settings.mapPremiumLockedDescription')}
              </div>
              {mapEntitlements.billing?.checkoutAvailable && (
                <button
                  type="button"
                  onClick={() => void mapEntitlements.startUpgrade()}
                  disabled={mapEntitlements.checkoutLoading}
                  className="mt-2 rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-700 disabled:bg-slate-400"
                >
                  {mapEntitlements.checkoutLoading ? t('common.loading') : t('settings.mapUpgradeCta')}
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Leaflet settings */}
      {effectiveProvider === 'leaflet' && (
        <div>
          <label className="mb-1.5 block text-sm font-medium text-slate-700">{t('settings.mapTemplate')}</label>
          <CustomSelect
            value={mapTileUrl}
            onChange={(value: string) => {
              if (!freeMapLocked && value) setMapTileUrl(value);
            }}
            placeholder={t('settings.mapTemplatePlaceholder.select')}
            options={MAP_PRESETS.map((p) => ({ value: p.url, label: p.name }))}
            size="sm"
            style={{ marginBottom: 8 }}
            disabled={freeMapLocked}
          />
          <input
            type="text"
            value={mapTileUrl}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
              if (!freeMapLocked) setMapTileUrl(e.target.value);
            }}
            disabled={freeMapLocked}
            placeholder="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-transparent focus:ring-2 focus:ring-slate-400 disabled:bg-slate-100 disabled:text-slate-400"
          />
          <p className="mt-1 text-xs text-slate-400">{t('settings.mapDefaultHint')}</p>
        </div>
      )}

      {/* GL settings */}
      {effectiveProvider !== 'leaflet' && (
        <div className="space-y-3">
          {effectiveProvider === 'mapbox-gl' && (
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400">
              {t('settings.mapMapboxManaged')}
            </div>
          )}

          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-700">{t('settings.mapStyle')}</label>
            <div className="mb-2">
              <StyleDropdown value={mapboxStyle} provider={effectiveProvider} onChange={setMapboxStyle} />
            </div>
            <input
              type="text"
              value={mapboxStyle}
              onChange={(e) => setMapboxStyle(e.target.value)}
              placeholder={defaultStyleForProvider(effectiveProvider)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm focus:border-transparent focus:ring-2 focus:ring-slate-400"
            />
            <p className="mt-1 text-xs text-slate-400">
              {effectiveProvider === 'maplibre-gl' ? t('settings.mapOpenFreeMapStyleHint') : t('settings.mapStyleHint')}
            </p>
          </div>

          {effectiveProvider === 'mapbox-gl' && (
            <>
              <div
                className={`flex items-start gap-3 rounded-lg border p-3 transition-colors ${
                  supports3d
                    ? 'border-slate-200 dark:border-slate-700'
                    : 'border-slate-200 opacity-60 dark:border-slate-700'
                }`}
              >
                <div className="flex-1">
                  <div className="text-sm font-medium text-slate-900 dark:text-white">
                    {t('settings.map3dBuildings')}
                  </div>
                  <div className="mt-0.5 text-xs text-slate-500">{t('settings.map3dHint')}</div>
                </div>
                <ToggleSwitch
                  on={mapbox3d && supports3d}
                  onToggle={() => {
                    if (supports3d) setMapbox3d(!mapbox3d);
                  }}
                />
              </div>

              <div className="flex items-start gap-3 rounded-lg border border-slate-200 p-3 dark:border-slate-700">
                <div className="flex-1">
                  <div className="flex flex-col items-start gap-1 text-sm font-medium text-slate-900 dark:text-white sm:flex-row sm:items-center sm:gap-2">
                    <span className="order-2 sm:order-1">{t('settings.mapHighQuality')}</span>
                    <span className="order-1 rounded bg-amber-100 px-1.5 py-[3px] text-[9px] font-semibold uppercase leading-none tracking-wide text-amber-800 dark:bg-amber-900/40 dark:text-amber-300 sm:order-2">
                      {t('settings.mapExperimental')}
                    </span>
                  </div>
                  <div className="mt-0.5 text-xs text-slate-500">
                    {t('settings.mapHighQualityHint')}{' '}
                    <span className="text-amber-600 dark:text-amber-400">{t('settings.mapHighQualityWarning')}</span>
                  </div>
                </div>
                <ToggleSwitch on={mapboxQuality} onToggle={() => setMapboxQuality(!mapboxQuality)} />
              </div>

              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-400 dark:border-slate-700 dark:bg-slate-800">
                <strong className="text-slate-600 dark:text-slate-300">{t('settings.mapTipLabel')}</strong>{' '}
                {t('settings.mapTip')}
              </div>
            </>
          )}
        </div>
      )}

      {/* Default map position — applies regardless of provider */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="mb-1.5 block text-sm font-medium text-slate-700">{t('settings.latitude')}</label>
          <input
            type="number"
            step="any"
            value={defaultLat}
            onChange={(e) => setDefaultLat(e.target.value)}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-transparent focus:ring-2 focus:ring-slate-400"
          />
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium text-slate-700">{t('settings.longitude')}</label>
          <input
            type="number"
            step="any"
            value={defaultLng}
            onChange={(e) => setDefaultLng(e.target.value)}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-transparent focus:ring-2 focus:ring-slate-400"
          />
        </div>
      </div>

      <div>
        <div style={{ position: 'relative', inset: 0, height: '200px', width: '100%' }}>
          {effectiveProvider !== 'leaflet' ? (
            <GlMapPreview
              provider={effectiveProvider}
              style={mapboxStyle}
              lat={parseFloat(String(defaultLat)) || 48.8566}
              lng={parseFloat(String(defaultLng)) || 2.3522}
              // Zoom in close so the style's character (3D buildings,
              // satellite texture, label density) is immediately visible.
              zoom={Math.max(parseInt(String(defaultZoom)) || 10, 16)}
              enable3d={effectiveProvider === 'mapbox-gl' && mapbox3d && supports3d}
              quality={effectiveProvider === 'mapbox-gl' && mapboxQuality}
              onClick={(ll) => {
                setDefaultLat(ll.lat);
                setDefaultLng(ll.lng);
              }}
            />
          ) : (
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            React.createElement(MapView as any, {
              places: mapPlaces,
              dayPlaces: [],
              route: null,
              routeSegments: null,
              selectedPlaceId: null,
              onMarkerClick: null,
              onMapClick: handleMapClick,
              onMapContextMenu: null,
              center: [settings.default_lat, settings.default_lng],
              zoom: defaultZoom,
              tileUrl: freeMapLocked ? undefined : normalizeLeafletTileUrl(mapTileUrl),
              fitKey: null,
              dayOrderMap: [],
              leftWidth: 0,
              rightWidth: 0,
              hasInspector: false,
            })
          )}
        </div>
      </div>

      <button
        onClick={saveMapSettings}
        disabled={saving}
        className="flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-sm text-white hover:bg-slate-700 disabled:bg-slate-400"
      >
        {saving ? (
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
        ) : (
          <Save className="h-4 w-4" />
        )}
        {t('settings.saveMap')}
      </button>
    </Section>
  );
}
