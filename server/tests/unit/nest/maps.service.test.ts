import { describe, it, expect, vi, beforeEach } from 'vitest';

const { maps } = vi.hoisted(() => ({
  maps: {
    searchPlaces: vi.fn(),
    autocompletePlaces: vi.fn(),
    getPlaceDetails: vi.fn(),
    getPlaceDetailsExpanded: vi.fn(),
    getPlacePhoto: vi.fn(),
    reverseGeocode: vi.fn(),
    resolveGoogleMapsUrl: vi.fn(),
    searchOverpassPois: vi.fn(),
  },
}));
vi.mock('../../../src/services/mapsService', () => maps);

const { getEntitlementsForUserMock } = vi.hoisted(() => ({
  getEntitlementsForUserMock: vi.fn(),
}));
vi.mock('../../../src/services/entitlementService', () => ({
  getEntitlementsForUser: getEntitlementsForUserMock,
}));

const { serveFilePath } = vi.hoisted(() => ({ serveFilePath: vi.fn() }));
vi.mock('../../../src/services/placePhotoCache', () => ({ serveFilePath }));

import { MapsService } from '../../../src/nest/maps/maps.service';
import type { DatabaseService } from '../../../src/nest/database/database.service';

/** A DatabaseService stub whose get() returns the row the test wants. */
function makeDb(row?: { value: string }) {
  const get = vi.fn(() => row);
  const db = { get } as unknown as DatabaseService;
  return { db, get };
}

function svc(row?: { value: string }) {
  return new MapsService(makeDb(row).db);
}

function makeMapboxDb(initialUsed = 0, month = new Date().toISOString().slice(0, 7)) {
  const rows: Record<string, { month: string; map_loads: number; disabled_at: string | null }> = {};
  if (initialUsed >= 0) rows[month] = { month, map_loads: initialUsed, disabled_at: null };
  const run = vi.fn(async () => ({ changes: 0 }));
  const get = vi.fn(async (sql: string, arg?: string) => {
    if (sql.includes('mapbox_usage_monthly')) return rows[arg || month] || undefined;
    if (sql.includes('user_tables')) return { table_name: 'MAPBOX_USAGE_MONTHLY' };
    return undefined;
  });
  const prepare = vi.fn((sql: string) => ({
    run: vi.fn(async (...args: unknown[]) => {
      if (sql.includes('INSERT OR IGNORE INTO mapbox_usage_monthly')) {
        const targetMonth = String(args[0]);
        rows[targetMonth] ??= { month: targetMonth, map_loads: 0, disabled_at: null };
        return { changes: 1 };
      }
      if (sql.includes('UPDATE mapbox_usage_monthly')) {
        const targetMonth = String(args[1]);
        const limit = Number(args[2]);
        rows[targetMonth] ??= { month: targetMonth, map_loads: 0, disabled_at: null };
        if (rows[targetMonth].map_loads >= limit) return { changes: 0 };
        rows[targetMonth].map_loads += 1;
        if (rows[targetMonth].map_loads >= Number(args[0])) rows[targetMonth].disabled_at = new Date().toISOString();
        return { changes: 1 };
      }
      return { changes: 0 };
    }),
  }));
  return { db: { run, get, prepare } as unknown as DatabaseService, rows, run, get, prepare };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('MapsService', () => {
  describe('kill-switch settings reads', () => {
    it('reports a switch disabled when the stored value is exactly "false"', async () => {
      expect(await svc({ value: 'false' }).autocompleteDisabled()).toBe(true);
      expect(await svc({ value: 'false' }).detailsDisabled()).toBe(true);
      expect(await svc({ value: 'false' }).photosDisabled()).toBe(true);
    });

    it('reports enabled when the value is "true"', async () => {
      expect(await svc({ value: 'true' }).autocompleteDisabled()).toBe(false);
      expect(await svc({ value: 'true' }).detailsDisabled()).toBe(false);
      expect(await svc({ value: 'true' }).photosDisabled()).toBe(false);
    });

    it('reports enabled when the setting row is absent', async () => {
      expect(await svc(undefined).autocompleteDisabled()).toBe(false);
      expect(await svc(undefined).detailsDisabled()).toBe(false);
      expect(await svc(undefined).photosDisabled()).toBe(false);
    });

    it('queries the matching app_settings key', async () => {
      const { db, get } = makeDb({ value: 'true' });
      const s = new MapsService(db);
      await s.autocompleteDisabled();
      expect(get).toHaveBeenCalledWith(expect.stringContaining('app_settings'), 'places_autocomplete_enabled');
      await s.detailsDisabled();
      expect(get).toHaveBeenCalledWith(expect.any(String), 'places_details_enabled');
      await s.photosDisabled();
      expect(get).toHaveBeenCalledWith(expect.any(String), 'places_photos_enabled');
    });
  });

  describe('delegation to the legacy maps service', () => {
    it('search forwards userId, query, lang and bias', () => {
      maps.searchPlaces.mockResolvedValue({ places: [], source: 'osm' });
      const bias = { lat: 1, lng: 2, radius: 5 };
      svc().search(3, 'berlin', 'de', bias);
      expect(maps.searchPlaces).toHaveBeenCalledWith(3, 'berlin', 'de', bias);
    });

    it('search works without optional args', () => {
      svc().search(3, 'berlin');
      expect(maps.searchPlaces).toHaveBeenCalledWith(3, 'berlin', undefined, undefined);
    });

    it('autocomplete forwards through', () => {
      const bias = { low: { lat: 1, lng: 2 }, high: { lat: 3, lng: 4 } };
      svc().autocomplete(3, 'be', 'en', bias);
      expect(maps.autocompletePlaces).toHaveBeenCalledWith(3, 'be', 'en', bias);
    });

    it('details forwards through', () => {
      svc().details(3, 'p1', 'de');
      expect(maps.getPlaceDetails).toHaveBeenCalledWith(3, 'p1', 'de');
    });

    it('detailsExpanded forwards refresh through', () => {
      svc().detailsExpanded(3, 'p1', 'de', true);
      expect(maps.getPlaceDetailsExpanded).toHaveBeenCalledWith(3, 'p1', 'de', true);
    });

    it('photo forwards coords and name through', () => {
      svc().photo(3, 'p1', 1.5, 2.5, 'Spot');
      expect(maps.getPlacePhoto).toHaveBeenCalledWith(3, 'p1', 1.5, 2.5, 'Spot');
    });

    it('reverse forwards through', () => {
      svc().reverse('1', '2', 'de');
      expect(maps.reverseGeocode).toHaveBeenCalledWith('1', '2', 'de');
    });

    it('resolveUrl forwards through', () => {
      svc().resolveUrl('https://maps.app.goo.gl/x');
      expect(maps.resolveGoogleMapsUrl).toHaveBeenCalledWith('https://maps.app.goo.gl/x');
    });

    it('pois forwards category and bbox through', () => {
      const bbox = { south: 1, west: 2, north: 3, east: 4 };
      svc().pois('cafe', bbox);
      expect(maps.searchOverpassPois).toHaveBeenCalledWith('cafe', bbox);
    });
  });

  describe('photoBytesPath', () => {
    it('returns the cached file path from placePhotoCache', () => {
      serveFilePath.mockReturnValue('/cache/p1.jpg');
      expect(svc().photoBytesPath('p1')).toBe('/cache/p1.jpg');
      expect(serveFilePath).toHaveBeenCalledWith('p1');
    });

    it('returns null when nothing is cached', () => {
      serveFilePath.mockReturnValue(null);
      expect(svc().photoBytesPath('p1')).toBeNull();
    });
  });

  describe('backend-owned Mapbox sessions', () => {
    it('returns fallback without incrementing when no server token is configured', async () => {
      const { db, prepare } = makeMapboxDb();
      const result = await new MapsService(db).mapboxSession(7);

      expect(result).toMatchObject({ enabled: false, fallbackProvider: 'maplibre-gl', reason: 'not_configured' });
      expect(prepare).not.toHaveBeenCalledWith(expect.stringContaining('UPDATE mapbox_usage_monthly'));
      expect(getEntitlementsForUserMock).not.toHaveBeenCalled();
    });

    it('denies free users before creating a metered session', async () => {
      vi.stubEnv('MAPBOX_ACCESS_TOKEN', 'sk.server-token');
      getEntitlementsForUserMock.mockResolvedValue({ planKey: 'free' });
      const { db, rows } = makeMapboxDb(0);

      const result = await new MapsService(db).mapboxSession(7);

      expect(result).toMatchObject({ enabled: false, fallbackProvider: 'maplibre-gl', reason: 'plan_required', used: 0 });
      expect(rows[new Date().toISOString().slice(0, 7)].map_loads).toBe(0);
    });

    it('increments usage and returns a proxy style URL below the monthly limit', async () => {
      vi.stubEnv('MAPBOX_ACCESS_TOKEN', 'sk.server-token');
      vi.stubEnv('MAPBOX_MONTHLY_LOAD_LIMIT', '2');
      getEntitlementsForUserMock.mockResolvedValue({ planKey: 'pro' });
      const { db } = makeMapboxDb(0);

      const result = await new MapsService(db).mapboxSession(7, 'mapbox://styles/mapbox/standard');

      expect(result.enabled).toBe(true);
      expect(result.used).toBe(1);
      expect(result.remaining).toBe(1);
      expect(result.styleUrl).toContain('/api/maps/mapbox/style?');
      expect(result.styleUrl).toContain('session=');
      expect(result.styleUrl).not.toContain('access_token');
    });

    it('denies new sessions at the monthly cutoff without returning a 500 shape', async () => {
      vi.stubEnv('MAPBOX_ACCESS_TOKEN', 'sk.server-token');
      vi.stubEnv('MAPBOX_MONTHLY_LOAD_LIMIT', '2');
      getEntitlementsForUserMock.mockResolvedValue({ planKey: 'pro' });
      const { db } = makeMapboxDb(2);

      const result = await new MapsService(db).mapboxSession(7, 'mapbox://styles/mapbox/standard');

      expect(result).toMatchObject({
        enabled: false,
        fallbackProvider: 'maplibre-gl',
        reason: 'quota_exhausted',
        used: 2,
        limit: 2,
        remaining: 0,
      });
    });

    it('rewrites proxied style JSON without leaking the server token', async () => {
      vi.stubEnv('MAPBOX_ACCESS_TOKEN', 'sk.server-token');
      const fetchMock = vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            version: 8,
            sprite: 'mapbox://sprites/mapbox/standard',
            glyphs: 'mapbox://fonts/mapbox/{fontstack}/{range}.pbf',
            sources: {
              streets: { type: 'vector', url: 'mapbox://mapbox.mapbox-streets-v8' },
              raster: {
                type: 'raster',
                tiles: ['https://api.mapbox.com/v4/mapbox.satellite/{z}/{x}/{y}.jpg?access_token=leak'],
              },
            },
          }),
          { headers: { 'content-type': 'application/json' } },
        ),
      );
      vi.stubGlobal('fetch', fetchMock);
      const { db } = makeMapboxDb(1);

      const response = await new MapsService(db).mapboxStyle('mapbox://styles/mapbox/standard', 'session-1');
      const bodyText = response.body.toString('utf8');
      const body = JSON.parse(bodyText);

      expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('access_token=sk.server-token'), expect.any(Object));
      expect(bodyText).not.toContain('access_token');
      expect(body.sprite).toBe('/api/maps/mapbox/sprites/mapbox/standard?session=session-1');
      expect(body.glyphs).toBe('/api/maps/mapbox/fonts/mapbox/{fontstack}/{range}.pbf?session=session-1');
      expect(body.sources.streets.url).toBe('/api/maps/mapbox/tilejson/mapbox.mapbox-streets-v8?session=session-1');
      expect(body.sources.raster.tiles[0]).toContain('/api/maps/mapbox/resource?');
      expect(body.sources.raster.tiles[0]).toContain('session=session-1');
    });
  });
});
