import { listCategories } from './categoryService';
import { getMcpSafeUrl } from './notifications';
import { createPerfTrace, type PerfTrace } from './perfTrace';
import * as placePhotoCache from './placePhotoCache';
import { listPlaces } from './placeService';
import { getTripSummary } from './tripService';
import {
  buildTripPdfHtml,
  type TripPdfAccommodation,
  type TripPdfAssignment,
  type TripPdfCategory,
  type TripPdfDay,
  type TripPdfDayNote,
  type TripPdfPlace,
  type TripPdfReservation,
  type TripPdfTrip,
} from '@trippi/shared';
import en from '@trippi/shared/i18n/en';

import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { Page, Route } from 'playwright';

const EXPORTS_DIR = path.join(__dirname, '../../uploads/exports');
const PUBLIC_DIR = path.join(__dirname, '../../public');
const CLIENT_PUBLIC_DIR = path.join(__dirname, '../../../client/public');
const UPLOADS_DIR = path.join(__dirname, '../../uploads');
const PDF_RENDER_TIMEOUT_MS = 15_000;
const PDF_ASSET_SETTLE_TIMEOUT_MS = 1_500;

interface SummaryDay {
  id: number | string;
  day_number?: number | null;
  title?: string | null;
  date?: string | null;
  assignments?: TripPdfAssignment[];
  notes?: TripPdfDayNote[];
}

interface TripPdfSummary {
  trip?: TripPdfTrip;
  days?: SummaryDay[];
  accommodations?: TripPdfAccommodation[];
  reservations?: TripPdfReservation[];
}

function slugify(value: unknown): string {
  const slug = String(value ?? 'trip')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 72);
  return slug || 'trip';
}

function t(key: string, params?: Record<string, string | number>): string {
  const value = (en as unknown as Record<string, unknown>)[key];
  const template = typeof value === 'string' ? value : key;
  if (!params) return template;
  return Object.entries(params).reduce((value, [name, replacement]) => {
    return value.replace(new RegExp(`\\{${name}\\}`, 'g'), String(replacement));
  }, template);
}

function buildAssignmentsMap(days: SummaryDay[]): Record<string, TripPdfAssignment[]> {
  return Object.fromEntries(days.map((day) => [String(day.id), Array.isArray(day.assignments) ? day.assignments : []]));
}

function buildDayNotes(days: SummaryDay[]): TripPdfDayNote[] {
  return days.flatMap((day) => (Array.isArray(day.notes) ? day.notes : []));
}

function getProxyPhotoId(url: string | null | undefined): string | null {
  if (!url) return null;
  let pathOnly = url;
  if (url.startsWith('http://') || url.startsWith('https://')) {
    try {
      pathOnly = new URL(url).pathname;
    } catch {
      return null;
    }
  }

  const match = pathOnly.match(/^\/api\/maps\/place-photo\/(.+)\/bytes$/);
  if (!match?.[1]) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}

function getPlacePhotoId(place: TripPdfPlace | null | undefined): string | null {
  if (!place) return null;
  return (
    getProxyPhotoId(place.image_url) ||
    place.google_place_id ||
    place.osm_id ||
    (place.lat != null && place.lng != null ? `coords:${place.lat}:${place.lng}` : null)
  );
}

function safeJoin(root: string, relativePath: string): string | null {
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, relativePath);
  if (resolved !== resolvedRoot && !resolved.startsWith(`${resolvedRoot}${path.sep}`)) return null;
  return resolved;
}

function contentTypeForAsset(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.svg') return 'image/svg+xml';
  if (ext === '.woff2') return 'font/woff2';
  if (ext === '.woff') return 'font/woff';
  return 'application/octet-stream';
}

async function localAssetPathForUrlPath(pathname: string): Promise<string | null> {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }

  const photoMatch = decoded.match(/^\/api\/maps\/place-photo\/(.+)\/bytes$/);
  if (photoMatch?.[1]) {
    const cached = placePhotoCache.get(photoMatch[1]);
    if (cached) return cached.filePath;
  }

  const candidates = decoded.startsWith('/brand/')
    ? [safeJoin(PUBLIC_DIR, decoded.slice(1)), safeJoin(CLIENT_PUBLIC_DIR, decoded.slice(1))]
    : decoded.startsWith('/uploads/')
      ? [safeJoin(UPLOADS_DIR, decoded.slice('/uploads/'.length))]
      : [];

  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      const stat = await fs.stat(candidate);
      if (stat.isFile()) return candidate;
    } catch {
      // Try the next safe local candidate.
    }
  }

  return null;
}

interface PdfNetworkGuardStats extends Record<string, number> {
  dataOrBlob: number;
  localAssets: number;
  aborted: number;
}

async function installPdfNetworkGuards(
  page: Page,
  origin: string,
  stats: PdfNetworkGuardStats,
): Promise<void> {
  await page.route('**/*', async (route: Route) => {
    const requestUrl = route.request().url();
    if (requestUrl === 'about:blank' || requestUrl.startsWith('data:') || requestUrl.startsWith('blob:')) {
      stats.dataOrBlob++;
      await route.continue();
      return;
    }

    let parsed: URL;
    try {
      parsed = new URL(requestUrl);
    } catch {
      stats.aborted++;
      await route.abort('blockedbyclient');
      return;
    }

    if (parsed.origin === origin) {
      const assetPath = await localAssetPathForUrlPath(parsed.pathname);
      if (assetPath) {
        stats.localAssets++;
        await route.fulfill({ path: assetPath, contentType: contentTypeForAsset(assetPath) });
        return;
      }
    }

    stats.aborted++;
    await route.abort('blockedbyclient');
  });
}

async function waitForPdfAssets(page: Page): Promise<void> {
  await page.evaluate((timeoutMs) => {
    const doc = (globalThis as any).document;
    const imageReady = Promise.all(
      Array.from(doc.images || []).map(
        (image: any) =>
          new Promise<void>((resolve) => {
            if (image.complete) {
              resolve();
              return;
            }
            image.addEventListener('load', () => resolve(), { once: true });
            image.addEventListener('error', () => resolve(), { once: true });
          }),
      ),
    );
    const fontReady = doc.fonts?.ready?.then(() => undefined).catch(() => undefined) ?? Promise.resolve();
    const timeout = new Promise<void>((resolve) => setTimeout(resolve, timeoutMs));
    return Promise.race([Promise.all([imageReady, fontReady]).then(() => undefined), timeout]);
  }, PDF_ASSET_SETTLE_TIMEOUT_MS);
}

async function cachedPhotoDataUri(photoId: string | null): Promise<string | null> {
  if (!photoId) return null;
  const cached = placePhotoCache.get(photoId);
  if (!cached) return null;
  try {
    const bytes = await fs.readFile(cached.filePath);
    return `data:image/jpeg;base64,${bytes.toString('base64')}`;
  } catch {
    return null;
  }
}

async function inlinePlaceImage(place: TripPdfPlace | null | undefined): Promise<TripPdfPlace | null | undefined> {
  if (!place) return place;
  const proxyPhotoId = getProxyPhotoId(place.image_url);
  if (!proxyPhotoId) return place;

  const dataUri = await cachedPhotoDataUri(proxyPhotoId);
  return {
    ...place,
    image_url: dataUri,
  };
}

async function inlineCachedImages(
  days: SummaryDay[],
  places: TripPdfPlace[],
): Promise<{ days: SummaryDay[]; places: TripPdfPlace[] }> {
  const inlinedPlaces = await Promise.all(places.map((place) => inlinePlaceImage(place) as Promise<TripPdfPlace>));
  const inlinedDays = await Promise.all(
    days.map(async (day) => ({
      ...day,
      assignments: Array.isArray(day.assignments)
        ? await Promise.all(
            day.assignments.map(async (assignment) => ({
              ...assignment,
              place: (await inlinePlaceImage(assignment.place)) ?? null,
            })),
          )
        : day.assignments,
    })),
  );

  return { days: inlinedDays, places: inlinedPlaces };
}

async function buildPhotoMap(days: SummaryDay[], places: TripPdfPlace[]): Promise<Record<string, string>> {
  const fullPlaceById = new Map(places.map((place) => [String(place.id), place]));
  const photoMap: Record<string, string> = {};

  for (const assignment of Object.values(buildAssignmentsMap(days)).flat()) {
    const place = assignment.place;
    if (!place || place.image_url) continue;
    const fullPlace = fullPlaceById.get(String(place.id));
    const photoId = getPlacePhotoId(place) || getPlacePhotoId(fullPlace);
    const dataUri = await cachedPhotoDataUri(photoId);

    if (dataUri) photoMap[String(place.id)] = dataUri;
  }

  return photoMap;
}

export async function exportTripPdf(tripId: number): Promise<{ filename: string; url: string; bytes: number }> {
  const perf: PerfTrace = createPerfTrace('pdf.export_trip_pdf', { tripId });
  let filename: string | undefined;
  let bytes: number | undefined;

  try {
    const summary = perf.measureSync('pdf.get_trip_summary', () => getTripSummary(tripId) as TripPdfSummary | null);
    if (!summary?.trip) throw new Error('Trip not found.');

    const rawDays = Array.isArray(summary.days) ? summary.days : [];
    const rawPlaces = perf.measureSync('pdf.list_places', () => listPlaces(String(tripId), {}) as TripPdfPlace[]);
    const { days, places } = await perf.measure('pdf.inline_cached_images', () =>
      inlineCachedImages(rawDays, rawPlaces),
    );
    const categories = perf.measureSync('pdf.list_categories', () => listCategories() as TripPdfCategory[]);
    const origin = getMcpSafeUrl().replace(/\/+$/, '');
    const photoMap = await perf.measure('pdf.build_photo_map', () => buildPhotoMap(days, places));
    const html = perf.measureSync('pdf.build_html', () =>
      buildTripPdfHtml({
        trip: summary.trip,
        days,
        places,
        assignments: buildAssignmentsMap(days),
        categories,
        dayNotes: buildDayNotes(days),
        reservations: Array.isArray(summary.reservations) ? summary.reservations : [],
        accommodations: Array.isArray(summary.accommodations) ? summary.accommodations : [],
        photoMap,
        t,
        locale: 'en-US',
        origin,
      }),
    );

    await perf.measure('pdf.ensure_export_dir', () => fs.mkdir(EXPORTS_DIR, { recursive: true }));
    filename = `${slugify(summary.trip.title)}-${Date.now().toString(36)}-${randomUUID()}.pdf`;
    const filePath = path.join(EXPORTS_DIR, filename);

    const { chromium } = await perf.measure('pdf.import_playwright', () => import('playwright'));
    const browser = await perf.measure('pdf.launch_browser', () => chromium.launch({ headless: true }));
    const networkStats: PdfNetworkGuardStats = { dataOrBlob: 0, localAssets: 0, aborted: 0 };
    try {
      const page = await perf.measure('pdf.new_page', () =>
        browser.newPage({ viewport: { width: 1000, height: 1414 }, deviceScaleFactor: 1 }),
      );
      await perf.measure('pdf.install_network_guards', () => installPdfNetworkGuards(page, origin, networkStats));
      await perf.measure('pdf.set_content', () =>
        page.setContent(html, { waitUntil: 'domcontentloaded', timeout: PDF_RENDER_TIMEOUT_MS }),
      );
      await perf.measure('pdf.wait_assets', () => waitForPdfAssets(page));
      await perf.measure('pdf.emulate_print', () => page.emulateMedia({ media: 'print' }));
      await perf.measure('pdf.render_pdf', () =>
        page.pdf({
          path: filePath,
          format: 'A4',
          printBackground: true,
          margin: { top: '0', right: '0', bottom: '0', left: '0' },
          preferCSSPageSize: true,
        }),
      );
      perf.event('pdf.network_guard', networkStats);
    } finally {
      await perf.measure('pdf.close_browser', () => browser.close());
    }

    const stat = await perf.measure('pdf.stat_file', () => fs.stat(filePath));
    bytes = stat.size;
    return {
      filename,
      url: `${origin}/uploads/exports/${encodeURIComponent(filename)}`,
      bytes,
    };
  } finally {
    perf.finish({ tripId, filename, bytes });
  }
}
