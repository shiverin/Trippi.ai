import { db } from '../db/database';
import { Trip } from '../types';
import { createAssignment } from './assignmentService';
import { createAccommodation } from './dayService';
import { getPlaceDetails, searchPlaces } from './mapsService';
import { createPlace } from './placeService';
import { exportTripPdf } from './tripPdfExportService';
import { createTrip, getTrip } from './tripService';

import { randomUUID } from 'crypto';

export const MAX_ITINERARY_IMPORT_DAYS = 90;
export const MAX_ITINERARY_IMPORT_ACTIVITIES = 300;

const GEO_CONCURRENCY = 1;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const RATE_LIMIT_RETRY_DELAY_MS = 1300;

export type ImportCategory =
  | 'attraction'
  | 'restaurant'
  | 'hotel'
  | 'activity'
  | 'transport'
  | 'shopping'
  | 'nature'
  | 'other';

export interface ImportLocation {
  name?: string;
  query: string;
  address?: string;
  google_place_id?: string;
  google_ftid?: string;
  osm_id?: string;
}

export interface ImportActivity {
  title: string;
  description?: string;
  category?: ImportCategory;
  start_time?: string;
  end_time?: string;
  duration_minutes?: number;
  location: ImportLocation;
  notes?: string;
  price?: number;
  currency?: string;
}

export interface ImportAccommodation {
  title: string;
  location: ImportLocation;
  check_in?: string;
  check_out?: string;
}

export interface ImportDay {
  day_number: number;
  date?: string;
  title?: string;
  city?: string;
  activities: ImportActivity[];
  accommodation?: ImportAccommodation;
}

export interface ApplyItineraryPlanInput {
  target:
    | { kind: 'new_trip'; title: string; start_date?: string; end_date?: string; currency?: string }
    | { kind: 'existing_trip'; tripId: number; mode: 'append' | 'replace_imported' };
  lang?: string;
  destination_context?: string;
  exportPdf?: boolean;
  days: ImportDay[];
}

export interface ImportIssue {
  path: string;
  message: string;
}

export class ItineraryImportError extends Error {
  issues: ImportIssue[];

  constructor(issues: ImportIssue[]) {
    super(issues.map((issue) => `${issue.path}: ${issue.message}`).join('; '));
    this.name = 'ItineraryImportError';
    this.issues = issues;
  }
}

interface ResolvedLocation {
  name: string;
  address: string | null;
  lat: number;
  lng: number;
  google_place_id: string | null;
  google_ftid: string | null;
  osm_id: string | null;
  website: string | null;
  phone: string | null;
  source: string | null;
  approximate?: boolean;
}

interface ResolvedActivity extends ImportActivity {
  resolvedLocation: ResolvedLocation;
}

interface ResolvedAccommodation extends ImportAccommodation {
  resolvedLocation: ResolvedLocation;
}

interface ResolvedDay extends ImportDay {
  activities: ResolvedActivity[];
  accommodation?: ResolvedAccommodation;
}

interface DayRow {
  id: number;
  trip_id: number;
  day_number: number;
  date: string | null;
  notes: string | null;
  title: string | null;
  mcp_import_batch_id: string | null;
}

interface ImportEvents {
  days: { type: 'day:created' | 'day:updated'; day: DayRow }[];
  places: any[];
  assignments: any[];
  accommodations: any[];
}

interface ImportCounts {
  daysCreated: number;
  daysUpdated: number;
  placesCreated: number;
  assignmentsCreated: number;
  accommodationsCreated: number;
  reservationsCreated: number;
  locationsResolved: number;
  importedObjectsRemoved: number;
}

export interface ApplyItineraryPlanResult {
  success: true;
  tripId: number;
  trip: Trip;
  batchId: string;
  counts: ImportCounts;
  warnings: string[];
  pdf?: { filename: string; url: string; bytes: number; contentType: 'application/pdf' };
  pdfError?: string;
  events: ImportEvents;
}

const CATEGORY_NAME_BY_INPUT: Record<ImportCategory, string> = {
  attraction: 'Attraction',
  restaurant: 'Restaurant',
  hotel: 'Hotel',
  activity: 'Activity',
  transport: 'Transport',
  shopping: 'Shopping',
  nature: 'Nature',
  other: 'Other',
};

function isIsoDate(value: string): boolean {
  if (!DATE_RE.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

function clean(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function parseNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function hasValidCoordinates(lat: number | null, lng: number | null): lat is number {
  return lat !== null && lng !== null && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
}

function validateTime(value: string | undefined, path: string, issues: ImportIssue[]): void {
  if (value !== undefined && !TIME_RE.test(value)) issues.push({ path, message: 'Expected 24-hour HH:mm time.' });
}

const LOCATION_FIELDS = new Set(['name', 'query', 'address', 'google_place_id', 'google_ftid', 'osm_id']);

function validateLocation(location: ImportLocation | undefined, path: string, issues: ImportIssue[]): boolean {
  if (!location || !clean(location.query)) {
    issues.push({ path: `${path}.query`, message: 'Location query is required.' });
    return false;
  }

  for (const key of Object.keys(location as unknown as Record<string, unknown>)) {
    if (!LOCATION_FIELDS.has(key)) {
      issues.push({
        path: `${path}.${key}`,
        message: 'Unsupported location field. Send query/address/provider IDs only; backend geocodes coordinates.',
      });
    }
  }
  return true;
}

function validateInput(input: ApplyItineraryPlanInput): void {
  const issues: ImportIssue[] = [];

  if (input.target.kind === 'new_trip') {
    if (!clean(input.target.title)) issues.push({ path: 'target.title', message: 'Trip title is required.' });
    if (input.target.start_date && !isIsoDate(input.target.start_date))
      issues.push({ path: 'target.start_date', message: 'Expected YYYY-MM-DD calendar date.' });
    if (input.target.end_date && !isIsoDate(input.target.end_date))
      issues.push({ path: 'target.end_date', message: 'Expected YYYY-MM-DD calendar date.' });
    if (
      input.target.start_date &&
      input.target.end_date &&
      new Date(input.target.end_date) < new Date(input.target.start_date)
    ) {
      issues.push({ path: 'target.end_date', message: 'End date must be on or after start date.' });
    }
    if (input.target.currency && !/^[A-Z]{3}$/.test(input.target.currency)) {
      issues.push({ path: 'target.currency', message: 'Currency must be a 3-letter ISO code.' });
    }
  } else {
    if (!Number.isInteger(input.target.tripId) || input.target.tripId <= 0) {
      issues.push({ path: 'target.tripId', message: 'Existing trip ID must be a positive integer.' });
    }
  }

  if (!Array.isArray(input.days) || input.days.length === 0) {
    issues.push({ path: 'days', message: 'At least one day is required.' });
  } else if (input.days.length > MAX_ITINERARY_IMPORT_DAYS) {
    issues.push({ path: 'days', message: `Cannot import more than ${MAX_ITINERARY_IMPORT_DAYS} days.` });
  }

  const seenDayNumbers = new Set<number>();
  let activityCount = 0;
  let locationCount = 0;

  input.days?.forEach((day, dayIndex) => {
    const dayPath = `days[${dayIndex}]`;
    if (!Number.isInteger(day.day_number) || day.day_number <= 0) {
      issues.push({ path: `${dayPath}.day_number`, message: 'Day number must be a positive integer.' });
    } else if (seenDayNumbers.has(day.day_number)) {
      issues.push({ path: `${dayPath}.day_number`, message: 'Day numbers must be unique.' });
    } else {
      seenDayNumbers.add(day.day_number);
    }

    if (day.date && !isIsoDate(day.date)) {
      issues.push({ path: `${dayPath}.date`, message: 'Expected YYYY-MM-DD calendar date.' });
    }

    if (!Array.isArray(day.activities)) {
      issues.push({ path: `${dayPath}.activities`, message: 'Activities must be an array.' });
      return;
    }

    activityCount += day.activities.length;
    day.activities.forEach((activity, activityIndex) => {
      const activityPath = `${dayPath}.activities[${activityIndex}]`;
      if (!clean(activity.title))
        issues.push({ path: `${activityPath}.title`, message: 'Activity title is required.' });
      if (validateLocation(activity.location, `${activityPath}.location`, issues)) {
        locationCount++;
      }
      validateTime(activity.start_time, `${activityPath}.start_time`, issues);
      validateTime(activity.end_time, `${activityPath}.end_time`, issues);
      if (
        activity.duration_minutes !== undefined &&
        (!Number.isFinite(activity.duration_minutes) || activity.duration_minutes <= 0)
      ) {
        issues.push({ path: `${activityPath}.duration_minutes`, message: 'Duration must be a positive number.' });
      }
      if (activity.price !== undefined && (!Number.isFinite(activity.price) || activity.price < 0)) {
        issues.push({ path: `${activityPath}.price`, message: 'Price must be non-negative.' });
      }
      if (activity.currency && !/^[A-Z]{3}$/.test(activity.currency)) {
        issues.push({ path: `${activityPath}.currency`, message: 'Currency must be a 3-letter ISO code.' });
      }
    });

    if (day.accommodation) {
      const accommodationPath = `${dayPath}.accommodation`;
      if (!clean(day.accommodation.title)) {
        issues.push({ path: `${accommodationPath}.title`, message: 'Accommodation title is required.' });
      }
      if (validateLocation(day.accommodation.location, `${accommodationPath}.location`, issues)) {
        locationCount++;
      }
      validateTime(day.accommodation.check_in, `${accommodationPath}.check_in`, issues);
      validateTime(day.accommodation.check_out, `${accommodationPath}.check_out`, issues);
    }
  });

  if (activityCount > MAX_ITINERARY_IMPORT_ACTIVITIES) {
    issues.push({
      path: 'days.activities',
      message: `Cannot import more than ${MAX_ITINERARY_IMPORT_ACTIVITIES} activities.`,
    });
  }
  if (locationCount === 0) {
    issues.push({ path: 'days', message: 'At least one activity or accommodation with a location is required.' });
  }

  if (issues.length > 0) throw new ItineraryImportError(issues);
}

function locationFromCandidate(candidate: Record<string, unknown>, fallback: ImportLocation): ResolvedLocation | null {
  const lat = parseNumber(candidate.lat ?? candidate.latitude);
  const lng = parseNumber(candidate.lng ?? candidate.longitude);
  if (!hasValidCoordinates(lat, lng)) return null;

  return {
    name: clean(candidate.name) ?? clean(fallback.name) ?? clean(fallback.query) ?? 'Untitled place',
    address: clean(candidate.address) ?? clean(fallback.address) ?? null,
    lat,
    lng: lng as number,
    google_place_id: clean(candidate.google_place_id) ?? clean(fallback.google_place_id) ?? null,
    google_ftid: clean(candidate.google_ftid) ?? clean(fallback.google_ftid) ?? null,
    osm_id: clean(candidate.osm_id) ?? clean(fallback.osm_id) ?? null,
    website: clean(candidate.website) ?? null,
    phone: clean(candidate.phone) ?? null,
    source: clean(candidate.source) ?? null,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRateLimitError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err ?? '');
  return /\b429\b|too many requests|rate limit/i.test(message);
}

const APPROXIMATE_CENTERS: { pattern: RegExp; name: string; lat: number; lng: number }[] = [
  { pattern: /\bkunming\b|昆明/i, name: 'Kunming', lat: 25.0389, lng: 102.7183 },
  { pattern: /\bdali\b|大理/i, name: 'Dali', lat: 25.6065, lng: 100.2676 },
  { pattern: /\blijiang\b|丽江|麗江/i, name: 'Lijiang', lat: 26.8565, lng: 100.2271 },
  { pattern: /\byunnan\b|云南|雲南/i, name: 'Yunnan', lat: 25.0453, lng: 102.7097 },
  { pattern: /\bchina\b|中国|中國/i, name: 'China', lat: 35.8617, lng: 104.1954 },
];

function approximateLocation(
  location: ImportLocation,
  city: string | undefined,
  destinationContext: string | undefined,
): ResolvedLocation | null {
  const context = [location.query, location.address, location.name, city, destinationContext]
    .filter(Boolean)
    .join(', ');
  const center = APPROXIMATE_CENTERS.find((candidate) => candidate.pattern.test(context));
  if (!center) return null;

  const label = clean(location.name) ?? clean(location.query) ?? center.name;
  return {
    name: label,
    address: compactWhitespace([label, city, destinationContext].filter(Boolean).join(', ')),
    lat: center.lat,
    lng: center.lng,
    google_place_id: clean(location.google_place_id) ?? null,
    google_ftid: clean(location.google_ftid) ?? null,
    osm_id: clean(location.osm_id) ?? null,
    website: null,
    phone: null,
    source: 'approximate',
    approximate: true,
  };
}

function compactWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function simplifiedLocationQuery(value: string): string {
  return compactWhitespace(
    value
      .replace(/\b(?:scenic\s+area|scenic\s+spot|tourist\s+area|tourism\s+area)\b/gi, ' ')
      .replace(/\b(?:visitor\s+center|visitors\s+center|ticket\s+office)\b/gi, ' '),
  );
}

function includesContext(query: string, context: string): boolean {
  const normalizedQuery = query.toLowerCase();
  const normalizedContext = context.toLowerCase();
  return normalizedQuery.includes(normalizedContext);
}

function withContext(
  query: string | undefined,
  context: string | undefined,
  separator: string = ', ',
): string | undefined {
  const cleanQuery = clean(query);
  if (!cleanQuery) return undefined;
  const cleanContext = clean(context);
  if (!cleanContext || includesContext(cleanQuery, cleanContext)) return cleanQuery;
  return `${cleanQuery}${separator}${cleanContext}`;
}

function withContexts(
  query: string | undefined,
  contexts: (string | undefined)[],
  separator = ', ',
): string | undefined {
  return contexts.reduce((current, context) => withContext(current, context, separator), query);
}

function withCityAndDestination(
  query: string | undefined,
  city: string | undefined,
  destinationContext: string | undefined,
  citySeparator = ', ',
): string | undefined {
  return withContext(withContext(query, city, citySeparator), destinationContext);
}

function buildLocationSearchQueries(
  location: ImportLocation,
  city: string | undefined,
  destinationContext: string | undefined,
): string[] {
  const base = clean(location.query);
  const name = clean(location.name);
  const address = clean(location.address);
  const simplified = base ? simplifiedLocationQuery(base) : undefined;
  const candidates = [
    withContexts(base, [address, city, destinationContext]),
    withCityAndDestination(base, city, destinationContext),
    withCityAndDestination(base, city, destinationContext, ' '),
    withCityAndDestination(simplified && simplified !== base ? simplified : undefined, city, destinationContext, ' '),
    withCityAndDestination(simplified && simplified !== base ? simplified : undefined, city, destinationContext),
    withCityAndDestination(name && name !== base ? name : undefined, city, destinationContext),
    withContext(base, destinationContext),
    withContext(simplified && simplified !== base ? simplified : undefined, destinationContext),
    withContext(name && name !== base ? name : undefined, destinationContext),
    base,
    simplified && simplified !== base ? simplified : undefined,
  ];

  const seen = new Set<string>();
  return candidates
    .map((candidate) => clean(candidate))
    .filter((candidate): candidate is string => {
      if (!candidate) return false;
      const key = candidate.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

async function resolveLocation(
  userId: number,
  location: ImportLocation,
  city: string | undefined,
  destinationContext: string | undefined,
  lang: string | undefined,
  path: string,
): Promise<{ location: ResolvedLocation; warning?: string }> {
  const detailsId = clean(location.google_place_id) ?? clean(location.osm_id);
  if (detailsId) {
    try {
      const details = await getPlaceDetails(userId, detailsId, lang);
      const resolved = locationFromCandidate(details.place, location);
      if (resolved) return { location: resolved };
    } catch {
      // Fall through to text search below. A stale provider ID should not make an
      // otherwise searchable itinerary impossible to import.
    }
  }

  const queries = buildLocationSearchQueries(location, city, destinationContext);
  let lastSearchError: string | null = null;
  for (const query of queries) {
    try {
      const search = await searchPlaces(userId, query, lang);
      const match = search.places.map((candidate) => locationFromCandidate(candidate, location)).find(Boolean);
      if (match) return { location: match };
    } catch (err) {
      lastSearchError = err instanceof Error ? err.message : 'Location search failed.';
      if (isRateLimitError(err)) {
        await sleep(RATE_LIMIT_RETRY_DELAY_MS);
        try {
          const retry = await searchPlaces(userId, query, lang);
          const match = retry.places.map((candidate) => locationFromCandidate(candidate, location)).find(Boolean);
          if (match) return { location: match };
        } catch (retryErr) {
          lastSearchError = retryErr instanceof Error ? retryErr.message : lastSearchError;
        }

        const approximate = approximateLocation(location, city, destinationContext);
        if (approximate) {
          return {
            location: approximate,
            warning: `${path}: geocoding was rate-limited; used approximate ${
              city ?? destinationContext ?? 'destination'
            } coordinates for "${location.query}".`,
          };
        }
      }
    }
  }

  if (lastSearchError) {
    throw new ItineraryImportError([{ path, message: lastSearchError }]);
  }

  throw new ItineraryImportError([{ path, message: `Could not resolve coordinates for "${location.query}".` }]);
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      results[index] = await mapper(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

async function resolveImportLocations(
  input: ApplyItineraryPlanInput,
  userId: number,
): Promise<{ resolvedDays: ResolvedDay[]; warnings: string[] }> {
  const resolvedDays = input.days.map((day) => ({
    ...day,
    activities: day.activities.map((activity) => ({ ...activity }) as ResolvedActivity),
    accommodation: day.accommodation ? ({ ...day.accommodation } as ResolvedAccommodation) : undefined,
  }));
  const warnings: string[] = [];

  const jobs: {
    path: string;
    location: ImportLocation;
    city?: string;
    destinationContext?: string;
    apply: (resolved: ResolvedLocation) => void;
  }[] = [];

  resolvedDays.forEach((day, dayIndex) => {
    day.activities.forEach((activity, activityIndex) => {
      jobs.push({
        path: `days[${dayIndex}].activities[${activityIndex}].location`,
        location: activity.location,
        city: day.city,
        destinationContext: input.destination_context,
        apply: (resolved) => {
          activity.resolvedLocation = resolved;
        },
      });
    });

    if (day.accommodation) {
      jobs.push({
        path: `days[${dayIndex}].accommodation.location`,
        location: day.accommodation.location,
        city: day.city,
        destinationContext: input.destination_context,
        apply: (resolved) => {
          if (day.accommodation) day.accommodation.resolvedLocation = resolved;
        },
      });
    }
  });

  await mapWithConcurrency(jobs, GEO_CONCURRENCY, async (job) => {
    const resolved = await resolveLocation(
      userId,
      job.location,
      job.city,
      job.destinationContext,
      input.lang,
      job.path,
    );
    job.apply(resolved.location);
    if (resolved.warning) warnings.push(resolved.warning);
    return resolved.location;
  });

  return { resolvedDays, warnings };
}

function loadCategoryLookup(): Map<string, number> {
  const rows = db.prepare('SELECT id, name FROM categories').all() as { id: number; name: string }[];
  return new Map(rows.map((row) => [row.name.toLowerCase(), row.id]));
}

function categoryIdFor(category: ImportCategory | undefined, lookup: Map<string, number>): number | undefined {
  const name = CATEGORY_NAME_BY_INPUT[category ?? 'other'];
  return lookup.get(name.toLowerCase());
}

function inferTripDates(input: ApplyItineraryPlanInput): { startDate?: string; endDate?: string } {
  const dated = input.days
    .filter((day) => day.date)
    .sort((a, b) => a.day_number - b.day_number)
    .map((day) => day.date as string);

  if (input.target.kind !== 'new_trip') return {};
  return {
    startDate: input.target.start_date ?? dated[0],
    endDate: input.target.end_date ?? dated[dated.length - 1],
  };
}

function getDayByNumber(tripId: number, dayNumber: number): DayRow | undefined {
  return db.prepare('SELECT * FROM days WHERE trip_id = ? AND day_number = ?').get(tripId, dayNumber) as
    | DayRow
    | undefined;
}

function getDayById(dayId: number): DayRow {
  return db.prepare('SELECT * FROM days WHERE id = ?').get(dayId) as DayRow;
}

function ensureDay(
  tripId: number,
  day: ResolvedDay,
  batchId: string,
  markExistingDay: boolean,
  events: ImportEvents,
  counts: ImportCounts,
): DayRow {
  const existing = getDayByNumber(tripId, day.day_number);
  if (!existing) {
    const result = db
      .prepare('INSERT INTO days (trip_id, day_number, date, title, mcp_import_batch_id) VALUES (?, ?, ?, ?, ?)')
      .run(tripId, day.day_number, day.date ?? null, day.title ?? null, batchId);
    const created = getDayById(Number(result.lastInsertRowid));
    counts.daysCreated++;
    events.days.push({ type: 'day:created', day: created });
    return created;
  }

  const updates: string[] = [];
  const params: Record<string, unknown> = { id: existing.id };
  const canOverwriteMetadata = markExistingDay || existing.mcp_import_batch_id !== null;

  if (day.date && (canOverwriteMetadata || !existing.date)) {
    updates.push('date = @date');
    params.date = day.date;
  }
  if (day.title && (canOverwriteMetadata || !existing.title)) {
    updates.push('title = @title');
    params.title = day.title;
  }
  if (canOverwriteMetadata) {
    updates.push('mcp_import_batch_id = @batchId');
    params.batchId = batchId;
  }

  if (updates.length > 0) {
    db.prepare(`UPDATE days SET ${updates.join(', ')} WHERE id = @id`).run(params);
    const updated = getDayById(existing.id);
    counts.daysUpdated++;
    events.days.push({ type: 'day:updated', day: updated });
    return updated;
  }

  return existing;
}

function deleteImportedContent(tripId: number): number {
  let removed = 0;
  removed += db
    .prepare('DELETE FROM reservations WHERE trip_id = ? AND mcp_import_batch_id IS NOT NULL')
    .run(tripId).changes;
  removed += db
    .prepare('DELETE FROM day_accommodations WHERE trip_id = ? AND mcp_import_batch_id IS NOT NULL')
    .run(tripId).changes;
  removed += db
    .prepare(
      `DELETE FROM day_assignments
       WHERE mcp_import_batch_id IS NOT NULL
         AND day_id IN (SELECT id FROM days WHERE trip_id = ?)`,
    )
    .run(tripId).changes;
  removed += db
    .prepare(
      `DELETE FROM places
       WHERE trip_id = ?
         AND mcp_import_batch_id IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM day_assignments da WHERE da.place_id = places.id)
         AND NOT EXISTS (SELECT 1 FROM day_accommodations a WHERE a.place_id = places.id)
         AND NOT EXISTS (SELECT 1 FROM reservations r WHERE r.place_id = places.id)`,
    )
    .run(tripId).changes;
  removed += db
    .prepare(
      `DELETE FROM days
       WHERE trip_id = ?
         AND mcp_import_batch_id IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM day_assignments da WHERE da.day_id = days.id)
         AND NOT EXISTS (SELECT 1 FROM day_notes dn WHERE dn.day_id = days.id)
         AND NOT EXISTS (SELECT 1 FROM day_accommodations a WHERE a.start_day_id = days.id OR a.end_day_id = days.id)
         AND NOT EXISTS (SELECT 1 FROM reservations r WHERE r.day_id = days.id OR r.end_day_id = days.id)`,
    )
    .run(tripId).changes;
  return removed;
}

function createImportedPlace(
  tripId: number,
  title: string,
  description: string | undefined,
  categoryId: number | undefined,
  location: ResolvedLocation,
  batchId: string,
  fields: {
    notes?: string;
    price?: number;
    currency?: string;
    duration_minutes?: number;
  } = {},
) {
  return createPlace(String(tripId), {
    name: clean(location.name) ?? title,
    description,
    lat: location.lat,
    lng: location.lng,
    address: location.address ?? undefined,
    category_id: categoryId,
    notes: fields.notes,
    price: fields.price,
    currency: fields.currency,
    duration_minutes: fields.duration_minutes,
    google_place_id: location.google_place_id ?? undefined,
    google_ftid: location.google_ftid ?? undefined,
    osm_id: location.osm_id ?? undefined,
    website: location.website ?? undefined,
    phone: location.phone ?? undefined,
    mcp_import_batch_id: batchId,
  });
}

function buildCounts(): ImportCounts {
  return {
    daysCreated: 0,
    daysUpdated: 0,
    placesCreated: 0,
    assignmentsCreated: 0,
    accommodationsCreated: 0,
    reservationsCreated: 0,
    locationsResolved: 0,
    importedObjectsRemoved: 0,
  };
}

function buildEvents(): ImportEvents {
  return { days: [], places: [], assignments: [], accommodations: [] };
}

export async function applyItineraryPlan(
  userId: number,
  input: ApplyItineraryPlanInput,
): Promise<ApplyItineraryPlanResult> {
  validateInput(input);
  const { resolvedDays, warnings } = await resolveImportLocations(input, userId);
  const batchId = `mcp_${randomUUID()}`;
  const counts = buildCounts();
  const events = buildEvents();
  counts.locationsResolved = resolvedDays.reduce(
    (sum, day) => sum + day.activities.length + (day.accommodation ? 1 : 0),
    0,
  );

  const transactionResult = db.transaction(() => {
    let tripId: number;

    if (input.target.kind === 'new_trip') {
      const { startDate, endDate } = inferTripDates(input);
      const maxDayNumber = Math.max(...resolvedDays.map((day) => day.day_number));
      const created = createTrip(
        userId,
        {
          title: input.target.title.trim(),
          start_date: startDate,
          end_date: endDate,
          currency: input.target.currency,
          day_count: maxDayNumber,
        },
        MAX_ITINERARY_IMPORT_DAYS,
      );
      tripId = created.tripId;
      db.prepare('UPDATE days SET mcp_import_batch_id = ? WHERE trip_id = ?').run(batchId, tripId);
    } else {
      const existing = getTrip(input.target.tripId, userId);
      if (!existing) throw new ItineraryImportError([{ path: 'target.tripId', message: 'Trip not found.' }]);
      tripId = input.target.tripId;
      if (input.target.mode === 'replace_imported') counts.importedObjectsRemoved = deleteImportedContent(tripId);
    }

    const categoryLookup = loadCategoryLookup();
    const dayByNumber = new Map<number, DayRow>();
    const markExistingDays = input.target.kind === 'new_trip';

    for (const day of resolvedDays) {
      const row = ensureDay(tripId, day, batchId, markExistingDays, events, counts);
      dayByNumber.set(day.day_number, row);
    }

    for (const day of resolvedDays) {
      const dayRow = dayByNumber.get(day.day_number);
      if (!dayRow) throw new ItineraryImportError([{ path: `day ${day.day_number}`, message: 'Day was not created.' }]);

      for (const activity of day.activities) {
        const place = createImportedPlace(
          tripId,
          activity.title,
          activity.description,
          categoryIdFor(activity.category, categoryLookup),
          activity.resolvedLocation,
          batchId,
          {
            notes: activity.notes,
            price: activity.price,
            currency: activity.currency,
            duration_minutes: activity.duration_minutes,
          },
        );
        const assignment = createAssignment(dayRow.id, place.id, activity.notes ?? null, {
          assignment_time: activity.start_time ?? null,
          assignment_end_time: activity.end_time ?? null,
          mcp_import_batch_id: batchId,
        });
        events.places.push(place);
        if (assignment) events.assignments.push(assignment);
        counts.placesCreated++;
        counts.assignmentsCreated++;
      }

      if (day.accommodation) {
        const place = createImportedPlace(
          tripId,
          day.accommodation.title,
          undefined,
          categoryIdFor('hotel', categoryLookup),
          day.accommodation.resolvedLocation,
          batchId,
          { notes: undefined },
        );
        const nextDay = dayByNumber.get(day.day_number + 1);
        const accommodation = createAccommodation(tripId, {
          place_id: place.id,
          start_day_id: dayRow.id,
          end_day_id: nextDay?.id ?? dayRow.id,
          check_in: day.accommodation.check_in,
          check_out: day.accommodation.check_out,
          notes: day.accommodation.title,
          mcp_import_batch_id: batchId,
        });
        events.places.push(place);
        events.accommodations.push(accommodation);
        counts.placesCreated++;
        counts.accommodationsCreated++;
        counts.reservationsCreated++;
      }
    }

    const trip = getTrip(tripId, userId);
    if (!trip) throw new ItineraryImportError([{ path: 'target.tripId', message: 'Trip not found after import.' }]);
    return { tripId, trip };
  })();

  const result: ApplyItineraryPlanResult = {
    success: true,
    tripId: transactionResult.tripId,
    trip: transactionResult.trip,
    batchId,
    counts,
    warnings,
    events,
  };

  if (input.exportPdf) {
    try {
      const pdf = await exportTripPdf(transactionResult.tripId);
      result.pdf = { ...pdf, contentType: 'application/pdf' };
    } catch (err) {
      result.pdfError = err instanceof Error ? err.message : 'PDF export failed.';
    }
  }

  return result;
}
