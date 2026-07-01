import {
  searchPlaces,
  autocompletePlaces,
  getPlaceDetails,
  getPlaceDetailsExpanded,
  getPlacePhoto,
  getTransportRoute,
  reverseGeocode,
  resolveGoogleMapsUrl,
  searchOverpassPois,
} from '../../services/mapsService';
import { getEntitlementsForUser } from '../../services/entitlementService';
import type { MediaObject } from '../../services/mediaStorage';
import { serveFilePath, serveObject, serveSignedUrl } from '../../services/placePhotoCache';
import { DatabaseService } from '../database/database.service';
import { Injectable } from '@nestjs/common';
import type {
  MapsMapboxSessionResult,
  MapsSearchResult,
  MapsAutocompleteResult,
  MapsPlaceDetailsResult,
  MapsPlacePhotoResult,
  MapsReverseResult,
  MapsResolveUrlResult,
  MapsTransportRouteResult,
} from '@trippi/shared';
import { randomUUID } from 'node:crypto';

type LocationBias = { low: { lat: number; lng: number }; high: { lat: number; lng: number } };
type MapboxUsageRow = { month: string; map_loads: number; disabled_at?: string | null };
type ProxiedMapboxResponse = { body: Buffer; contentType: string; cacheControl?: string | null };

const MAPBOX_DEFAULT_STYLE = 'mapbox://styles/mapbox/standard';
const MAPBOX_FALLBACK_PROVIDER = 'maplibre-gl' as const;
const MAPBOX_USAGE_TABLE = 'mapbox_usage_monthly';
const MAPBOX_STYLE_RE = /^mapbox:\/\/styles\/([^/]+)\/([^/?#]+)$/;
const MAPBOX_TILESET_RE = /^mapbox:\/\/([^/?#]+)$/;
const MAPBOX_FONT_RE = /^mapbox:\/\/fonts\/([^/]+)\/(.+)$/;
const MAPBOX_SPRITE_RE = /^mapbox:\/\/sprites\/([^/]+)\/([^/?#]+)$/;

function mapboxLimit(): number {
  const raw = Number(process.env.MAPBOX_MONTHLY_LOAD_LIMIT || 45_000);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 45_000;
}

function mapboxToken(): string {
  return (process.env.MAPBOX_ACCESS_TOKEN || '').trim();
}

function currentUsageMonth(now = new Date()): string {
  return now.toISOString().slice(0, 7);
}

function positiveInt(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : fallback;
}

function proxyUrl(path: string, params?: Record<string, string | undefined>): string {
  const cleanParams = params
    ? Object.fromEntries(Object.entries(params).filter((entry): entry is [string, string] => Boolean(entry[1])))
    : undefined;
  const query = cleanParams ? `?${new URLSearchParams(cleanParams).toString()}` : '';
  return `/api/maps/mapbox/${path}${query}`;
}

function appendAccessToken(url: string, token: string): string {
  const parsed = new URL(url);
  parsed.searchParams.delete('access_token');
  parsed.searchParams.set('access_token', token);
  return parsed.toString();
}

function stripAccessToken(url: string): string {
  const parsed = new URL(url);
  parsed.searchParams.delete('access_token');
  return parsed.toString();
}

function encodeMapboxPathSegment(segment: string): string {
  return segment.includes('{') || segment.includes('}') ? segment : encodeURIComponent(segment);
}

function styleEndpoint(style: string): string | null {
  const match = MAPBOX_STYLE_RE.exec(style.trim());
  if (!match) return null;
  return `https://api.mapbox.com/styles/v1/${encodeURIComponent(match[1])}/${encodeURIComponent(match[2])}`;
}

function tilejsonEndpoint(url: string): string | null {
  const match = MAPBOX_TILESET_RE.exec(url.trim());
  if (!match) return null;
  return `https://api.mapbox.com/v4/${encodeURIComponent(match[1])}.json?secure`;
}

function fontEndpoint(owner: string, fontstack: string, range: string): string {
  return `https://api.mapbox.com/fonts/v1/${encodeURIComponent(owner)}/${encodeURIComponent(fontstack)}/${encodeURIComponent(range)}`;
}

function spriteEndpoint(owner: string, style: string, suffix: string): string {
  return `https://api.mapbox.com/styles/v1/${encodeURIComponent(owner)}/${encodeURIComponent(style)}/sprite${suffix}`;
}

function allowedMapboxHttpUrl(raw: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:') return null;
  const host = parsed.hostname.toLowerCase();
  if (host !== 'api.mapbox.com' && !host.endsWith('.tiles.mapbox.com') && host !== 'tiles.mapbox.com') return null;
  return stripAccessToken(parsed.toString());
}

function rewriteMapboxUrl(raw: string, sessionId?: string): string {
  if (MAPBOX_STYLE_RE.test(raw)) return proxyUrl('style', { style: raw, session: sessionId });

  const sprite = MAPBOX_SPRITE_RE.exec(raw);
  if (sprite) return proxyUrl(`sprites/${encodeURIComponent(sprite[1])}/${encodeURIComponent(sprite[2])}`, { session: sessionId });

  const font = MAPBOX_FONT_RE.exec(raw);
  if (font) {
    const rest = font[2];
    const slash = rest.lastIndexOf('/');
    if (slash > 0) {
      return proxyUrl(
        `fonts/${encodeURIComponent(font[1])}/${encodeMapboxPathSegment(rest.slice(0, slash))}/${encodeMapboxPathSegment(rest.slice(slash + 1))}`,
        { session: sessionId },
      );
    }
  }

  if (MAPBOX_TILESET_RE.test(raw)) {
    return proxyUrl(`tilejson/${encodeURIComponent(raw.replace(/^mapbox:\/\//, ''))}`, { session: sessionId });
  }

  const http = allowedMapboxHttpUrl(raw);
  if (http) return proxyUrl('resource', { url: http, session: sessionId });

  return raw;
}

function rewriteMapboxJson(value: unknown, sessionId?: string): unknown {
  if (typeof value === 'string') {
    return value.startsWith('mapbox://') || value.includes('mapbox.com') ? rewriteMapboxUrl(value, sessionId) : value;
  }
  if (Array.isArray(value)) return value.map((item) => rewriteMapboxJson(item, sessionId));
  if (!value || typeof value !== 'object') return value;
  const next: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) next[key] = rewriteMapboxJson(child, sessionId);
  return next;
}

/**
 * Thin Nest wrapper around the existing maps service. All geocoding, the
 * provider fan-out (Nominatim/Overpass/Google) and — importantly — the SSRF
 * guard live in mapsService and are reused unchanged, so behaviour and the
 * outbound-URL protection are identical.
 *
 * The per-endpoint kill-switches are settings reads the legacy route does
 * inline; they're encapsulated here as `*Disabled()` helpers over the same
 * `app_settings` rows.
 */
@Injectable()
export class MapsService {
  constructor(private readonly database: DatabaseService) {}

  private quotaReady: Promise<void> | null = null;

  private ensureMapboxUsageTable(): Promise<void> {
    if (!this.quotaReady) {
      this.quotaReady = this.database
        .run(
          `CREATE TABLE IF NOT EXISTS ${MAPBOX_USAGE_TABLE} (
            month TEXT PRIMARY KEY,
            map_loads INTEGER NOT NULL DEFAULT 0,
            disabled_at TEXT,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
          )`,
        )
        .then(() => undefined)
        .catch(async (err) => {
          const message = String((err as Error).message || err).toLowerCase();
          if (!message.includes('ora-009') && !message.includes('missing right parenthesis')) throw err;
          try {
            await this.database.get("SELECT table_name FROM user_tables WHERE table_name = 'MAPBOX_USAGE_MONTHLY'");
          } catch {
            throw err;
          }
          const exists = await this.database.get("SELECT table_name FROM user_tables WHERE table_name = 'MAPBOX_USAGE_MONTHLY'");
          if (exists) return;
          await this.database.run(
            `CREATE TABLE mapbox_usage_monthly (
              month VARCHAR2(7) PRIMARY KEY,
              map_loads NUMBER(10) DEFAULT 0 NOT NULL,
              disabled_at VARCHAR2(64),
              updated_at VARCHAR2(64) DEFAULT CURRENT_TIMESTAMP NOT NULL
            )`,
          );
        });
    }
    return this.quotaReady;
  }

  private async usage(month = currentUsageMonth()): Promise<{ month: string; used: number; limit: number; remaining: number }> {
    await this.ensureMapboxUsageTable();
    const limit = mapboxLimit();
    const row = await this.database.get<MapboxUsageRow>(
      `SELECT month, map_loads FROM ${MAPBOX_USAGE_TABLE} WHERE month = ?`,
      month,
    );
    const used = positiveInt(row?.map_loads, 0);
    return { month, used, limit, remaining: Math.max(0, limit - used) };
  }

  private async incrementUsage(): Promise<{ allowed: boolean; month: string; used: number; limit: number; remaining: number }> {
    await this.ensureMapboxUsageTable();
    const month = currentUsageMonth();
    const limit = mapboxLimit();
    await this.database
      .prepare(
        `INSERT OR IGNORE INTO ${MAPBOX_USAGE_TABLE} (month, map_loads, updated_at)
         VALUES (?, 0, CURRENT_TIMESTAMP)`,
      )
      .run(month);
    const result = await this.database
      .prepare(
        `UPDATE ${MAPBOX_USAGE_TABLE}
         SET map_loads = map_loads + 1,
             updated_at = CURRENT_TIMESTAMP,
             disabled_at = CASE
               WHEN map_loads + 1 >= ? THEN COALESCE(disabled_at, CURRENT_TIMESTAMP)
               ELSE disabled_at
             END
         WHERE month = ? AND map_loads < ?`,
      )
      .run(limit, month, limit);
    const after = await this.usage(month);
    return { allowed: result.changes > 0, ...after };
  }

  async mapboxSession(userId: number, style?: string): Promise<MapsMapboxSessionResult> {
    const usage = await this.usage();
    const token = mapboxToken();
    if (!token) return { enabled: false, fallbackProvider: MAPBOX_FALLBACK_PROVIDER, reason: 'not_configured', ...usage };

    const entitlements = await getEntitlementsForUser(userId);
    if (entitlements.planKey === 'free') {
      return { enabled: false, fallbackProvider: MAPBOX_FALLBACK_PROVIDER, reason: 'plan_required', ...usage };
    }

    const requestedStyle = (style || MAPBOX_DEFAULT_STYLE).trim();
    if (!styleEndpoint(requestedStyle)) {
      return { enabled: false, fallbackProvider: MAPBOX_FALLBACK_PROVIDER, reason: 'invalid_style', ...usage };
    }

    const incremented = await this.incrementUsage();
    if (!incremented.allowed) {
      return {
        enabled: false,
        fallbackProvider: MAPBOX_FALLBACK_PROVIDER,
        reason: 'quota_exhausted',
        month: incremented.month,
        used: incremented.used,
        limit: incremented.limit,
        remaining: incremented.remaining,
      };
    }

    const sessionId = randomUUID();
    return {
      enabled: true,
      sessionId,
      styleUrl: proxyUrl('style', { style: requestedStyle, session: sessionId }),
      fallbackProvider: MAPBOX_FALLBACK_PROVIDER,
      month: incremented.month,
      used: incremented.used,
      limit: incremented.limit,
      remaining: incremented.remaining,
    };
  }

  private async mapboxResourcesAllowed(): Promise<boolean> {
    const usage = await this.usage();
    return !!mapboxToken() && usage.used <= usage.limit;
  }

  private async fetchMapbox(url: string, contentTypeFallback: string): Promise<ProxiedMapboxResponse> {
    if (!(await this.mapboxResourcesAllowed())) {
      const err = new Error('Mapbox quota exhausted');
      (err as Error & { status?: number }).status = 429;
      throw err;
    }
    const token = mapboxToken();
    const response = await fetch(appendAccessToken(url, token), {
      headers: { Accept: contentTypeFallback },
    });
    if (!response.ok) {
      const err = new Error(`Mapbox request failed with status ${response.status}`);
      (err as Error & { status?: number }).status = response.status;
      throw err;
    }
    return {
      body: Buffer.from(await response.arrayBuffer()),
      contentType: response.headers.get('content-type') || contentTypeFallback,
      cacheControl: response.headers.get('cache-control'),
    };
  }

  async mapboxStyle(style: string, sessionId?: string): Promise<ProxiedMapboxResponse> {
    const endpoint = styleEndpoint(style);
    if (!endpoint) {
      const err = new Error('Invalid Mapbox style');
      (err as Error & { status?: number }).status = 400;
      throw err;
    }
    const response = await this.fetchMapbox(endpoint, 'application/json');
    const json = JSON.parse(response.body.toString('utf8')) as unknown;
    return {
      ...response,
      body: Buffer.from(JSON.stringify(rewriteMapboxJson(json, sessionId))),
      contentType: 'application/json; charset=utf-8',
    };
  }

  async mapboxTilejson(tileset: string, sessionId?: string): Promise<ProxiedMapboxResponse> {
    const endpoint = tilejsonEndpoint(`mapbox://${tileset}`);
    if (!endpoint) {
      const err = new Error('Invalid Mapbox tileset');
      (err as Error & { status?: number }).status = 400;
      throw err;
    }
    const response = await this.fetchMapbox(endpoint, 'application/json');
    const json = JSON.parse(response.body.toString('utf8')) as unknown;
    return {
      ...response,
      body: Buffer.from(JSON.stringify(rewriteMapboxJson(json, sessionId))),
      contentType: 'application/json; charset=utf-8',
    };
  }

  mapboxFont(owner: string, fontstack: string, range: string): Promise<ProxiedMapboxResponse> {
    return this.fetchMapbox(fontEndpoint(owner, fontstack, range), 'application/x-protobuf');
  }

  mapboxSprite(owner: string, style: string, suffix: string): Promise<ProxiedMapboxResponse> {
    const fallback = suffix.endsWith('.json') ? 'application/json' : 'image/png';
    return this.fetchMapbox(spriteEndpoint(owner, style, suffix), fallback);
  }

  mapboxResource(url: string): Promise<ProxiedMapboxResponse> {
    const allowed = allowedMapboxHttpUrl(url);
    if (!allowed) {
      const err = new Error('Invalid Mapbox resource');
      (err as Error & { status?: number }).status = 400;
      throw err;
    }
    return this.fetchMapbox(allowed, 'application/octet-stream');
  }

  private async isSettingDisabled(key: string): Promise<boolean> {
    const row = await this.database.get<{ value: string }>('SELECT value FROM app_settings WHERE key = ?', key);
    return row?.value === 'false';
  }

  autocompleteDisabled(): Promise<boolean> {
    return this.isSettingDisabled('places_autocomplete_enabled');
  }

  detailsDisabled(): Promise<boolean> {
    return this.isSettingDisabled('places_details_enabled');
  }

  photosDisabled(): Promise<boolean> {
    return this.isSettingDisabled('places_photos_enabled');
  }

  search(
    userId: number,
    query: string,
    lang?: string,
    locationBias?: { lat: number; lng: number; radius?: number },
  ): Promise<MapsSearchResult> {
    return searchPlaces(userId, query, lang, locationBias) as Promise<MapsSearchResult>;
  }

  autocomplete(
    userId: number,
    input: string,
    lang?: string,
    locationBias?: LocationBias,
  ): Promise<MapsAutocompleteResult> {
    return autocompletePlaces(userId, input, lang, locationBias) as Promise<MapsAutocompleteResult>;
  }

  details(userId: number, placeId: string, lang?: string): Promise<MapsPlaceDetailsResult> {
    return getPlaceDetails(userId, placeId, lang) as Promise<MapsPlaceDetailsResult>;
  }

  detailsExpanded(
    userId: number,
    placeId: string,
    lang: string | undefined,
    refresh: boolean,
  ): Promise<MapsPlaceDetailsResult> {
    return getPlaceDetailsExpanded(userId, placeId, lang, refresh) as Promise<MapsPlaceDetailsResult>;
  }

  photo(userId: number, placeId: string, lat: number, lng: number, name?: string): Promise<MapsPlacePhotoResult> {
    return getPlacePhoto(userId, placeId, lat, lng, name) as Promise<MapsPlacePhotoResult>;
  }

  photoBytesPath(placeId: string): string | null {
    return serveFilePath(placeId);
  }

  photoBytesObject(placeId: string): Promise<MediaObject | null> {
    return serveObject(placeId);
  }

  photoBytesSignedUrl(placeId: string): Promise<string | null> {
    return serveSignedUrl(placeId);
  }

  reverse(lat: string, lng: string, lang?: string): Promise<MapsReverseResult> {
    return reverseGeocode(lat, lng, lang) as Promise<MapsReverseResult>;
  }

  resolveUrl(url: string): Promise<MapsResolveUrlResult> {
    return resolveGoogleMapsUrl(url) as Promise<MapsResolveUrlResult>;
  }

  transportRoute(
    userId: number,
    tripId: string | number,
    reservationId: string | number,
  ): Promise<MapsTransportRouteResult> {
    return getTransportRoute(userId, tripId, reservationId);
  }

  // OSM-only POI search by category within a viewport bbox (never calls Google).
  pois(category: string, bbox: { south: number; west: number; north: number; east: number }) {
    return searchOverpassPois(category, bbox);
  }
}
