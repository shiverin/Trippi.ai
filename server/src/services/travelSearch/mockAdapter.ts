import type {
  TravelSearchAdapter,
  TravelSearchIntentType,
  TravelSearchLocation,
  TravelSearchOptions,
  TravelSearchProviderId,
  TravelSearchRequest,
  TravelSearchResult,
  TravelSearchTiming,
} from './types';

import { createHash } from 'node:crypto';

export type TravelSearchMockFixture = Partial<TravelSearchResult> & {
  externalId: string;
  title: string;
  type?: TravelSearchIntentType;
  matches?: (request: TravelSearchRequest) => boolean;
};

export interface MockTravelSearchAdapterOptions {
  provider?: TravelSearchProviderId;
  displayName?: string;
  fixtures?: TravelSearchMockFixture[];
}

const DEFAULT_PROVIDER = 'mock-travel';

const BASE_PRICE_BY_TYPE: Record<string, number> = {
  flight: 260,
  hotel: 170,
  train: 58,
  bus: 32,
  ferry: 44,
  rental_car: 72,
  restaurant: 46,
  event: 65,
  activity: 82,
  tour: 115,
  other: 95,
};

export class MockTravelSearchAdapter implements TravelSearchAdapter {
  readonly provider: TravelSearchProviderId;
  readonly displayName: string;
  private readonly fixtures: TravelSearchMockFixture[];

  constructor(options: MockTravelSearchAdapterOptions = {}) {
    this.provider = options.provider ?? DEFAULT_PROVIDER;
    this.displayName = options.displayName ?? 'Mock Travel Search';
    this.fixtures = options.fixtures ?? [];
  }

  isAvailable(): boolean {
    return true;
  }

  async search(request: TravelSearchRequest, options: TravelSearchOptions = {}): Promise<TravelSearchResult[]> {
    if (options.signal?.aborted) {
      throw new Error('Travel search request was aborted');
    }

    const results =
      this.fixtures.length > 0
        ? this.fixtures
            .filter((fixture) => !fixture.type || fixture.type === request.type)
            .filter((fixture) => !fixture.matches || fixture.matches(request))
            .map((fixture) => normalizeFixture(this.provider, request, fixture))
        : buildDefaultResults(this.provider, request);

    return results.slice(0, normalizeLimit(options.limit, results.length));
  }
}

export function createMockTravelSearchAdapter(options: MockTravelSearchAdapterOptions = {}): TravelSearchAdapter {
  return new MockTravelSearchAdapter(options);
}

function buildDefaultResults(provider: TravelSearchProviderId, request: TravelSearchRequest): TravelSearchResult[] {
  return [0, 1].map((rank) => {
    const externalId = `${slug(request.type)}-${hashRequest(request, rank).slice(0, 10)}-${rank + 1}`;
    const timing = buildTiming(request);
    return {
      provider,
      externalId,
      title: buildTitle(request, rank),
      price: buildPrice(request, rank),
      currency: request.budget?.currency ?? 'USD',
      timing,
      cancellationHint:
        rank === 0 ? 'Mock fare allows cancellation review before checkout' : 'Mock fare has provider-specific rules',
      refundHint: rank === 0 ? 'Mock refundable option' : 'Mock partial refund option',
      deepLink: `https://trippi.example/mock-search/${encodeURIComponent(provider)}/${encodeURIComponent(externalId)}`,
      metadata: {
        mock: true,
        rank: rank + 1,
        requestType: request.type,
        bookingIntentId: request.bookingIntentId ?? null,
      },
    };
  });
}

function normalizeFixture(
  provider: TravelSearchProviderId,
  request: TravelSearchRequest,
  fixture: TravelSearchMockFixture,
): TravelSearchResult {
  return {
    provider: fixture.provider ?? provider,
    externalId: fixture.externalId,
    title: fixture.title,
    price: fixture.price ?? null,
    currency: fixture.currency ?? request.budget?.currency ?? null,
    timing: normalizeTiming(request, fixture.timing),
    cancellationHint: fixture.cancellationHint ?? null,
    refundHint: fixture.refundHint ?? null,
    deepLink: fixture.deepLink ?? null,
    metadata: { ...(fixture.metadata ?? {}) },
  };
}

function normalizeTiming(request: TravelSearchRequest, timing?: Partial<TravelSearchTiming>): TravelSearchTiming {
  const fallback = buildTiming(request);
  return {
    startsAt: timing?.startsAt ?? fallback.startsAt,
    endsAt: timing?.endsAt ?? fallback.endsAt,
    timezone: timing?.timezone ?? fallback.timezone,
    durationMinutes: timing?.durationMinutes ?? fallback.durationMinutes,
    ...(timing?.label !== undefined ? { label: timing.label } : {}),
  };
}

function buildTiming(request: TravelSearchRequest): TravelSearchTiming {
  const startsAt = request.startsAt ?? null;
  const endsAt = request.endsAt ?? null;
  return {
    startsAt,
    endsAt,
    timezone: request.destination?.timezone ?? request.location?.timezone ?? request.origin?.timezone ?? null,
    durationMinutes: durationMinutes(startsAt, endsAt),
  };
}

function buildPrice(request: TravelSearchRequest, rank: number): number {
  const base = BASE_PRICE_BY_TYPE[String(request.type)] ?? BASE_PRICE_BY_TYPE.other;
  const jitter = Number.parseInt(hashRequest(request, rank).slice(0, 6), 16) % 41;
  const price = base + rank * 37 + jitter;
  const maxPrice = request.budget?.maxPrice;
  if (typeof maxPrice === 'number' && Number.isFinite(maxPrice) && maxPrice > 0) {
    return Math.min(price, maxPrice);
  }
  return price;
}

function buildTitle(request: TravelSearchRequest, rank: number): string {
  const type = titleCase(String(request.type).replace(/[_-]+/g, ' '));
  const label = routeLabel(request) ?? request.title ?? 'Open search';
  const variant = rank === 0 ? 'Flexible' : 'Value';
  return `${variant} ${type}: ${label}`;
}

function routeLabel(request: TravelSearchRequest): string | null {
  const origin = locationLabel(request.origin);
  const destination = locationLabel(request.destination);
  if (origin && destination) return `${origin} to ${destination}`;
  if (destination) return destination;
  return locationLabel(request.location);
}

function locationLabel(location: TravelSearchLocation | null | undefined): string | null {
  if (!location) return null;
  return location.code || location.name || null;
}

function durationMinutes(startsAt: string | null, endsAt: string | null): number | null {
  if (!startsAt || !endsAt) return null;
  const start = Date.parse(startsAt);
  const end = Date.parse(endsAt);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
  return Math.round((end - start) / 60000);
}

function hashRequest(request: TravelSearchRequest, rank: number): string {
  return createHash('sha1')
    .update(
      JSON.stringify({
        rank,
        type: request.type,
        title: request.title ?? null,
        origin: request.origin ?? null,
        destination: request.destination ?? null,
        location: request.location ?? null,
        startsAt: request.startsAt ?? null,
        endsAt: request.endsAt ?? null,
        party: request.party ?? null,
        budget: request.budget ?? null,
      }),
    )
    .digest('hex');
}

function normalizeLimit(limit: number | undefined, fallback: number): number {
  if (limit === undefined) return fallback;
  if (!Number.isFinite(limit)) return fallback;
  return Math.max(0, Math.floor(limit));
}

function slug(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'search'
  );
}

function titleCase(value: string): string {
  return value.replace(/\w\S*/g, (word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase());
}
