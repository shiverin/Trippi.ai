import { listCategories } from './categoryService';
import { getMcpSafeUrl } from './notifications';
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

const EXPORTS_DIR = path.join(__dirname, '../../uploads/exports');

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
  const summary = getTripSummary(tripId) as TripPdfSummary | null;
  if (!summary?.trip) throw new Error('Trip not found.');

  const rawDays = Array.isArray(summary.days) ? summary.days : [];
  const rawPlaces = listPlaces(String(tripId), {}) as TripPdfPlace[];
  const { days, places } = await inlineCachedImages(rawDays, rawPlaces);
  const categories = listCategories() as TripPdfCategory[];
  const origin = getMcpSafeUrl().replace(/\/+$/, '');
  const html = buildTripPdfHtml({
    trip: summary.trip,
    days,
    places,
    assignments: buildAssignmentsMap(days),
    categories,
    dayNotes: buildDayNotes(days),
    reservations: Array.isArray(summary.reservations) ? summary.reservations : [],
    accommodations: Array.isArray(summary.accommodations) ? summary.accommodations : [],
    photoMap: await buildPhotoMap(days, places),
    t,
    locale: 'en-US',
    origin,
  });

  await fs.mkdir(EXPORTS_DIR, { recursive: true });
  const filename = `${slugify(summary.trip.title)}-${Date.now().toString(36)}-${randomUUID()}.pdf`;
  const filePath = path.join(EXPORTS_DIR, filename);

  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1000, height: 1414 }, deviceScaleFactor: 1 });
    await page.setContent(html, { waitUntil: 'networkidle' });
    await page.emulateMedia({ media: 'print' });
    await page.pdf({
      path: filePath,
      format: 'A4',
      printBackground: true,
      margin: { top: '0', right: '0', bottom: '0', left: '0' },
      preferCSSPageSize: true,
    });
  } finally {
    await browser.close();
  }

  const stat = await fs.stat(filePath);
  return {
    filename,
    url: `${origin}/uploads/exports/${encodeURIComponent(filename)}`,
    bytes: stat.size,
  };
}
