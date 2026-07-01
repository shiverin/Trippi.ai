import { lazy, Suspense } from 'react';
import { useMapEntitlements } from '../../hooks/useMapEntitlements';
import { useMapboxSession } from '../../hooks/useMapboxSession';
import { useSettingsStore } from '../../store/settingsStore';
import { MAPBOX_DEFAULT_STYLE } from './glProviders';
import { MapView } from './MapView';

// MapLibre/Mapbox pull in a ~230 KB (gzip) GL engine. Lazy-load the GL renderer so
// Leaflet-only installs never download it — it ships only once a GL provider is picked.
const MapViewGL = lazy(() => import('./MapViewGL').then((m) => ({ default: m.MapViewGL })));

// Auto-selects the map renderer based on user settings. Keeps the existing
// Leaflet MapView untouched so the Mapbox GL variant can mature iteratively
// behind a toggle. Atlas is not affected — it imports Leaflet directly.
//
// Offline maps: only the Leaflet renderer supports full pre-download (raster
// tiles via sync/tilePrefetcher.ts). GL maps are best-effort offline — their
// vector tiles are cached opportunistically by the Service Worker as you view
// them online (see the GL tile rules in vite.config.js), not prefetched.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function MapViewAuto(props: any) {
  const provider = useSettingsStore((s) => s.settings.map_provider);
  const mapboxStyle = useSettingsStore((s) => s.settings.mapbox_style || MAPBOX_DEFAULT_STYLE);
  const { freeMapLocked } = useMapEntitlements();
  const mapboxSession = useMapboxSession(!freeMapLocked && provider === 'mapbox-gl', mapboxStyle);
  const effectiveProps = freeMapLocked ? { ...props, tileUrl: undefined } : props;
  // Fall back while the backend-owned Mapbox session is pending or denied, so the
  // planner never exposes a token and never shows a blank map.
  const glProvider =
    freeMapLocked
      ? null
      : provider === 'maplibre-gl'
        ? 'maplibre-gl'
        : provider === 'mapbox-gl' && mapboxSession.status === 'ready'
          ? 'mapbox-gl'
          : provider === 'mapbox-gl' && mapboxSession.status === 'fallback'
            ? 'maplibre-gl'
            : null;
  if (glProvider) {
    // Render the previous Leaflet map as the fallback so there's no blank flash
    // while the GL chunk loads on first use.
    return (
      <Suspense fallback={<MapView {...effectiveProps} />}>
        <MapViewGL
          {...effectiveProps}
          glProvider={glProvider}
          mapboxStyleOverride={glProvider === 'mapbox-gl' ? mapboxSession.session.styleUrl : null}
        />
      </Suspense>
    );
  }
  return <MapView {...effectiveProps} />;
}
