import { asyncDb } from '../db/asyncDatabase';
import { BookingOptionsService, type BookingOptionInput } from '../nest/booking-options/booking-options.service';
import { enqueueAgentJob, type AgentJob } from './agentJobQueue';
import type { AgentJobHandler, AgentJobHandlers } from './agentJobWorker';
import {
  createConfiguredTravelSearchAdapter,
  getTravelSearchFeatureStatus,
  rankTravelSearchResults,
  type RankedTravelSearchResult,
  type TravelSearchBudget,
  type TravelSearchLocation,
  type TravelSearchParty,
  type TravelSearchRequest,
} from './travelSearch';

export const PRICE_WATCH_JOB_TYPE = 'booking-intent.price-watch';
export const PRICE_WATCH_DEFAULT_LIMIT = 5;

export type BookingIntentWatchStatus = 'idle' | 'queued' | 'checking' | 'checked' | 'failed';

export interface PriceWatchJobPayload {
  tripId: number;
  bookingIntentId: number;
  provider: string;
  providerMode: string;
  limit: number;
}

export interface EnqueuePriceWatchInput {
  tripId: number;
  bookingIntentId: number;
  limit?: number;
}

interface BookingIntentWatchRow {
  id: number | string;
  trip_id: number | string;
  created_by: number | string | null;
  type: string;
  dates: string | null;
  origin: string | null;
  destination: string | null;
  party_constraints: string | null;
  budget: string | null;
  preferences: string | null;
  status: string;
  watch_status: BookingIntentWatchStatus;
  last_checked_at: string | null;
}

interface PriceWatchResultMetadata {
  bookingIntentId: number;
  tripId: number;
  provider: string;
  providerMode: string;
  mockProvider: boolean;
  resultCount: number;
  upsertedOptions: number;
}

export function priceWatchIdempotencyKey(bookingIntentId: number | string): string {
  return `booking-intent:${bookingIntentId}:price-watch`;
}

export async function enqueuePriceWatchJob(input: EnqueuePriceWatchInput): Promise<AgentJob<PriceWatchJobPayload>> {
  const tripId = normalizeId(input.tripId, 'tripId');
  const bookingIntentId = normalizeId(input.bookingIntentId, 'bookingIntentId');
  const status = getTravelSearchFeatureStatus();

  return enqueueAgentJob<PriceWatchJobPayload>({
    type: PRICE_WATCH_JOB_TYPE,
    tripId,
    idempotencyKey: priceWatchIdempotencyKey(bookingIntentId),
    rerunTerminal: true,
    payload: {
      tripId,
      bookingIntentId,
      provider: status.provider,
      providerMode: status.providerMode,
      limit: normalizeLimit(input.limit),
    },
  });
}

export const processBookingPriceWatchJob: AgentJobHandler<PriceWatchJobPayload> = async (
  job,
  context,
): Promise<PriceWatchResultMetadata | { skipped: true; reason: string; bookingIntentId: number; tripId: number }> => {
  const payload = normalizePayload(job.payload);
  await context.assertTripActive();

  const intent = await getIntent(payload.tripId, payload.bookingIntentId);
  if (!intent) {
    throw new Error(`Booking intent ${payload.bookingIntentId} was not found for trip ${payload.tripId}`);
  }
  if (intent.status === 'archived') {
    return {
      skipped: true,
      reason: 'booking_intent_archived',
      bookingIntentId: payload.bookingIntentId,
      tripId: payload.tripId,
    };
  }

  await markWatchChecking(payload.tripId, payload.bookingIntentId);

  try {
    const request = toTravelSearchRequest(intent);
    const providerStatus = getTravelSearchFeatureStatus();
    if (!providerStatus.enabled) {
      throw new Error(providerStatus.reason ?? 'Travel search provider is unavailable.');
    }
    const adapter = createConfiguredTravelSearchAdapter();
    const results = await adapter.search(request, {
      limit: payload.limit,
      signal: context.signal,
    });
    const rankedResults = rankTravelSearchResults(request, results);
    const upsertedOptions = await upsertRankedOptions(payload.tripId, payload.bookingIntentId, rankedResults);
    await markWatchChecked(payload.tripId, payload.bookingIntentId, upsertedOptions);

    return {
      bookingIntentId: payload.bookingIntentId,
      tripId: payload.tripId,
      provider: adapter.provider,
      providerMode: providerStatus.providerMode,
      mockProvider: providerStatus.mock,
      resultCount: results.length,
      upsertedOptions,
    };
  } catch (error) {
    await markWatchFailed(payload.tripId, payload.bookingIntentId);
    throw error;
  }
};

export const bookingPriceWatchHandlers: AgentJobHandlers = {
  [PRICE_WATCH_JOB_TYPE]: processBookingPriceWatchJob as AgentJobHandler,
};

async function upsertRankedOptions(
  tripId: number,
  bookingIntentId: number,
  rankedResults: RankedTravelSearchResult[],
): Promise<number> {
  const options = new BookingOptionsService();
  let upserted = 0;

  for (const ranked of rankedResults) {
    const option = await options.upsertFromWorker(
      String(tripId),
      String(bookingIntentId),
      toBookingOptionInput(ranked),
    );
    if (option) upserted++;
  }

  return upserted;
}

function toBookingOptionInput(ranked: RankedTravelSearchResult): BookingOptionInput {
  const result = ranked.result;
  const providerMode = result.metadata.mock === true ? 'mock-development-provider' : 'amadeus-live-provider';
  return {
    provider: result.provider,
    external_id: result.externalId,
    title: result.title,
    price: result.price,
    currency: result.currency,
    score: ranked.score,
    checkout_url: result.deepLink,
    metadata: {
      source: providerMode,
      mock: result.metadata.mock === true,
      provider_metadata: result.metadata,
      timing: result.timing,
      cancellation_hint: result.cancellationHint,
      refund_hint: result.refundHint,
      ranking: {
        rank: ranked.rank,
        score: ranked.score,
        reasons: ranked.reasons,
        breakdown: ranked.breakdown,
      },
    },
    status: 'current',
  };
}

async function getIntent(tripId: number, bookingIntentId: number): Promise<BookingIntentWatchRow | undefined> {
  return asyncDb
    .prepare(
      `
        SELECT *
        FROM booking_intents
        WHERE trip_id = ? AND id = ?
      `,
    )
    .get<BookingIntentWatchRow>(tripId, bookingIntentId);
}

async function markWatchChecking(tripId: number, bookingIntentId: number): Promise<void> {
  const now = new Date().toISOString();
  await asyncDb
    .prepare(
      `
        UPDATE booking_intents
        SET status = CASE WHEN status = 'draft' THEN 'watching' ELSE status END,
            watch_status = 'checking',
            updated_at = ?
        WHERE trip_id = ? AND id = ? AND status != 'archived'
      `,
    )
    .run(now, tripId, bookingIntentId);
}

async function markWatchChecked(tripId: number, bookingIntentId: number, optionCount: number): Promise<void> {
  const now = new Date().toISOString();
  await asyncDb
    .prepare(
      `
        UPDATE booking_intents
        SET status = CASE
              WHEN ? > 0 AND status IN ('draft', 'watching', 'options_ready') THEN 'options_ready'
              WHEN status = 'draft' THEN 'watching'
              ELSE status
            END,
            watch_status = 'checked',
            last_checked_at = ?,
            updated_at = ?
        WHERE trip_id = ? AND id = ? AND status != 'archived'
      `,
    )
    .run(optionCount, now, now, tripId, bookingIntentId);
}

async function markWatchFailed(tripId: number, bookingIntentId: number): Promise<void> {
  const now = new Date().toISOString();
  await asyncDb
    .prepare(
      `
        UPDATE booking_intents
        SET watch_status = 'failed',
            last_checked_at = ?,
            updated_at = ?
        WHERE trip_id = ? AND id = ? AND status != 'archived'
      `,
    )
    .run(now, now, tripId, bookingIntentId);
}

function toTravelSearchRequest(intent: BookingIntentWatchRow): TravelSearchRequest {
  const dates = parseJsonObject(intent.dates);
  const partyConstraints = parseJsonObject(intent.party_constraints);
  const budget = parseJsonObject(intent.budget);
  const preferences = parseJsonObject(intent.preferences);

  return {
    bookingIntentId: Number(intent.id),
    tripId: Number(intent.trip_id),
    userId: intent.created_by === null ? undefined : Number(intent.created_by),
    type: intent.type,
    title: firstString(preferences, ['title', 'label', 'name']),
    origin: locationFromText(intent.origin),
    destination: locationFromText(intent.destination),
    location: locationFromText(intent.destination ?? intent.origin),
    startsAt: firstString(dates, ['startsAt', 'start_at', 'start', 'depart', 'departure', 'checkIn', 'check_in']),
    endsAt: firstString(dates, ['endsAt', 'end_at', 'end', 'return', 'arrival', 'checkOut', 'check_out']),
    party: travelParty(partyConstraints),
    budget: travelBudget(budget),
    preferences,
    metadata: {
      source: 'booking-intent',
      providerMode: getTravelSearchFeatureStatus().providerMode,
    },
  };
}

function travelParty(value: Record<string, unknown>): TravelSearchParty | null {
  const party: TravelSearchParty = {};
  const adults = firstNumber(value, ['adults', 'adult_count']);
  const children = firstNumber(value, ['children', 'child_count']);
  const infants = firstNumber(value, ['infants', 'infant_count']);
  const rooms = firstNumber(value, ['rooms', 'room_count']);

  if (adults !== null) party.adults = adults;
  if (children !== null) party.children = children;
  if (infants !== null) party.infants = infants;
  if (rooms !== null) party.rooms = rooms;

  return Object.keys(party).length > 0 ? party : null;
}

function travelBudget(value: Record<string, unknown>): TravelSearchBudget | null {
  const maxPrice = firstNumber(value, ['maxPrice', 'max_price', 'max', 'amount', 'limit']);
  const currency = firstString(value, ['currency', 'currencyCode', 'currency_code']);

  if (maxPrice === null && currency === null) return null;
  return { maxPrice, currency };
}

function locationFromText(value: string | null): TravelSearchLocation | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  if (/^[A-Z0-9]{2,5}$/.test(trimmed)) {
    return { code: trimmed };
  }
  return { name: trimmed };
}

function parseJsonObject(value: string | null): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function firstString(value: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const raw = value[key];
    if (typeof raw === 'string' && raw.trim()) return raw.trim();
  }
  return null;
}

function firstNumber(value: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const raw = value[key];
    if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
    if (typeof raw === 'string' && raw.trim()) {
      const parsed = Number(raw);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return null;
}

function normalizePayload(payload: PriceWatchJobPayload): PriceWatchJobPayload {
  return {
    tripId: normalizeId(payload.tripId, 'tripId'),
    bookingIntentId: normalizeId(payload.bookingIntentId, 'bookingIntentId'),
    provider:
      typeof payload.provider === 'string' && payload.provider.trim()
        ? payload.provider.trim()
        : getTravelSearchFeatureStatus().provider,
    providerMode:
      typeof payload.providerMode === 'string' && payload.providerMode.trim()
        ? payload.providerMode.trim()
        : getTravelSearchFeatureStatus().providerMode,
    limit: normalizeLimit(payload.limit),
  };
}

function normalizeId(value: number | string, field: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${field} must be a positive integer`);
  }
  return parsed;
}

function normalizeLimit(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return PRICE_WATCH_DEFAULT_LIMIT;
  return Math.max(0, Math.floor(value));
}
