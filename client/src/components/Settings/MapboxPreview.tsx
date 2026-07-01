import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useEffect, useRef } from 'react';
import { useMapboxSession } from '../../hooks/useMapboxSession';
import { MAPBOX_DEFAULT_STYLE, OPENFREEMAP_DEFAULT_STYLE, normalizeStyleForProvider, type GlMapProvider } from '../Map/glProviders';
import { addCustom3dBuildings, addTerrainAndSky, isStandardFamily, supportsCustom3d } from '../Map/mapboxSetup';

interface Props {
  provider?: GlMapProvider;
  style: string;
  lat: number;
  lng: number;
  zoom: number;
  enable3d: boolean;
  quality?: boolean;
  onClick?: (latlng: { lat: number; lng: number }) => void;
}

export default function GlMapPreview({
  provider = 'mapbox-gl',
  style,
  lat,
  lng,
  zoom,
  enable3d,
  quality = false,
  onClick,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mapRef = useRef<any | null>(null);
  const onClickRef = useRef(onClick);
  onClickRef.current = onClick;
  const mapboxSession = useMapboxSession(provider === 'mapbox-gl', style);
  const renderProvider: GlMapProvider =
    provider === 'mapbox-gl' && mapboxSession.status === 'fallback' ? 'maplibre-gl' : provider;
  const isMapLibre = renderProvider === 'maplibre-gl';
  const gl = (isMapLibre ? maplibregl : mapboxgl) as any;
  const glStyle =
    provider === 'mapbox-gl'
      ? mapboxSession.status === 'ready'
        ? mapboxSession.session.styleUrl!
        : OPENFREEMAP_DEFAULT_STYLE
      : normalizeStyleForProvider(provider, style);
  const enableMapbox3d = !isMapLibre && enable3d;

  useEffect(() => {
    if (!containerRef.current || (provider === 'mapbox-gl' && mapboxSession.status === 'loading')) return;
    if (!isMapLibre) {
      mapboxgl.accessToken = 'pk.trippi_backend_proxy';
      try {
        (mapboxgl as unknown as { setTelemetryEnabled?: (enabled: boolean) => void }).setTelemetryEnabled?.(false);
      } catch {
        /* noop */
      }
    }

    const mapOptions: Record<string, unknown> = {
      container: containerRef.current,
      style: glStyle,
      center: [lng, lat],
      zoom,
      pitch: enableMapbox3d ? 45 : 0,
      attributionControl: true,
      antialias: quality,
    };
    if (!isMapLibre) mapOptions.projection = quality ? 'globe' : 'mercator';

    const map = new gl.Map(mapOptions as any);
    mapRef.current = map;

    map.on('load', () => {
      if (enableMapbox3d) {
        if (!isStandardFamily(glStyle)) addTerrainAndSky(map);
        if (supportsCustom3d(glStyle)) {
          const dark = document.documentElement.classList.contains('dark');
          addCustom3dBuildings(map, dark);
        }
      }
      if (glStyle === MAPBOX_DEFAULT_STYLE) {
        try {
          map.setTerrain(null);
        } catch {
          /* noop */
        }
      }
    });

    map.on('click', (e) => {
      onClickRef.current?.({ lat: e.lngLat.lat, lng: e.lngLat.lng });
    });

    return () => {
      try {
        map.remove();
      } catch {
        /* noop */
      }
      mapRef.current = null;
    };
  }, [provider, renderProvider, mapboxSession.status, glStyle, enableMapbox3d, quality]);

  // Recenter without rebuilding the map when lat/lng/zoom change externally
  useEffect(() => {
    if (!mapRef.current) return;
    try {
      mapRef.current.jumpTo({ center: [lng, lat], zoom });
    } catch {
      /* noop */
    }
  }, [lat, lng, zoom]);

  if (provider === 'mapbox-gl' && mapboxSession.status === 'loading') {
    return (
      <div className="flex h-full items-center justify-center rounded-lg border border-slate-200 bg-slate-100 text-xs text-slate-500 dark:border-slate-700 dark:bg-slate-800">
        Loading Mapbox preview…
      </div>
    );
  }

  return <div ref={containerRef} style={{ width: '100%', height: '100%', borderRadius: '8px', overflow: 'hidden' }} />;
}
