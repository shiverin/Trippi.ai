import type {
  TravelSearchAdapter,
  TravelSearchLocation,
  TravelSearchOptions,
  TravelSearchRequest,
  TravelSearchResult,
} from './types';

type AmadeusEnv = 'test' | 'production';

interface AmadeusTokenResponse {
  access_token?: string;
  expires_in?: number;
}

interface AmadeusFlightOffer {
  id?: string;
  source?: string;
  oneWay?: boolean;
  numberOfBookableSeats?: number;
  price?: { total?: string; grandTotal?: string; currency?: string };
  itineraries?: Array<{
    duration?: string;
    segments?: Array<{
      departure?: { iataCode?: string; at?: string };
      arrival?: { iataCode?: string; at?: string };
      carrierCode?: string;
      number?: string;
      duration?: string;
      numberOfStops?: number;
    }>;
  }>;
  travelerPricings?: unknown;
}

interface AmadeusHotelOffer {
  id?: string;
  checkInDate?: string;
  checkOutDate?: string;
  room?: { typeEstimated?: { category?: string; beds?: number; bedType?: string }; description?: { text?: string } };
  price?: { total?: string; base?: string; currency?: string };
  policies?: { cancellations?: Array<{ description?: { text?: string } }>; refundable?: { cancellationRefund?: string } };
  self?: string;
}

interface AmadeusHotelEntry {
  hotel?: {
    hotelId?: string;
    name?: string;
    cityCode?: string;
    latitude?: number;
    longitude?: number;
  };
  offers?: AmadeusHotelOffer[];
  self?: string;
}

interface AmadeusFetchResponse {
  ok: boolean;
  status: number;
  statusText: string;
  json(): Promise<unknown>;
}

export interface AmadeusTravelSearchAdapterOptions {
  clientId?: string;
  clientSecret?: string;
  env?: AmadeusEnv;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

const TOKEN_REFRESH_SKEW_MS = 60_000;

export class AmadeusTravelSearchAdapter implements TravelSearchAdapter {
  readonly provider = 'amadeus';
  readonly displayName = 'Amadeus';

  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private token: { value: string; expiresAt: number } | null = null;

  constructor(options: AmadeusTravelSearchAdapterOptions = {}) {
    this.clientId = options.clientId ?? process.env.AMADEUS_CLIENT_ID ?? '';
    this.clientSecret = options.clientSecret ?? process.env.AMADEUS_CLIENT_SECRET ?? '';
    const env = normalizeEnv(options.env ?? process.env.AMADEUS_ENV);
    this.baseUrl = env === 'production' ? 'https://api.amadeus.com' : 'https://test.api.amadeus.com';
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.now = options.now ?? Date.now;
  }

  isAvailable(): boolean {
    return Boolean(this.clientId.trim() && this.clientSecret.trim());
  }

  async search(request: TravelSearchRequest, options: TravelSearchOptions = {}): Promise<TravelSearchResult[]> {
    if (!this.isAvailable()) throw new Error('Amadeus credentials are not configured.');
    if (request.type === 'flight') return this.searchFlights(request, options);
    if (request.type === 'hotel') return this.searchHotels(request, options);
    return [];
  }

  private async searchFlights(request: TravelSearchRequest, options: TravelSearchOptions): Promise<TravelSearchResult[]> {
    const origin = locationCode(request.origin);
    const destination = locationCode(request.destination);
    const departureDate = dateOnly(request.startsAt);
    if (!origin || !destination || !departureDate) {
      throw new Error('Flight search requires origin IATA code, destination IATA code, and departure date.');
    }

    const params = new URLSearchParams({
      originLocationCode: origin,
      destinationLocationCode: destination,
      departureDate,
      adults: String(Math.max(1, Math.floor(request.party?.adults ?? 1))),
      max: String(normalizeLimit(options.limit, 5)),
    });
    const returnDate = dateOnly(request.endsAt);
    if (returnDate && returnDate !== departureDate) params.set('returnDate', returnDate);
    if (request.party?.children) params.set('children', String(Math.max(0, Math.floor(request.party.children))));
    if (request.party?.infants) params.set('infants', String(Math.max(0, Math.floor(request.party.infants))));
    if (request.budget?.currency) params.set('currencyCode', request.budget.currency.toUpperCase());
    if (typeof request.budget?.maxPrice === 'number' && Number.isFinite(request.budget.maxPrice)) {
      params.set('maxPrice', String(Math.floor(request.budget.maxPrice)));
    }

    const payload = await this.getJson(`/v2/shopping/flight-offers?${params}`, options.signal);
    const offers = Array.isArray((payload as { data?: unknown }).data) ? ((payload as { data: unknown[] }).data as AmadeusFlightOffer[]) : [];
    return offers.map((offer, index) => mapFlightOffer(request, offer, index));
  }

  private async searchHotels(request: TravelSearchRequest, options: TravelSearchOptions): Promise<TravelSearchResult[]> {
    const hotelIds = stringList(request.preferences?.hotelIds ?? request.preferences?.hotel_ids);
    const checkInDate = dateOnly(request.startsAt);
    const checkOutDate = dateOnly(request.endsAt);
    if (!checkInDate || !checkOutDate) throw new Error('Hotel search requires check-in and check-out dates.');

    let ids = hotelIds;
    if (ids.length === 0) ids = await this.findHotelIds(request, options.signal);
    if (ids.length === 0) return [];

    const params = new URLSearchParams({
      hotelIds: ids.slice(0, 20).join(','),
      checkInDate,
      checkOutDate,
      adults: String(Math.max(1, Math.floor(request.party?.adults ?? 1))),
      roomQuantity: String(Math.max(1, Math.floor(request.party?.rooms ?? 1))),
      bestRateOnly: 'true',
    });
    if (request.budget?.currency) params.set('currency', request.budget.currency.toUpperCase());

    const payload = await this.getJson(`/v3/shopping/hotel-offers?${params}`, options.signal);
    const entries = Array.isArray((payload as { data?: unknown }).data) ? ((payload as { data: unknown[] }).data as AmadeusHotelEntry[]) : [];
    return entries.flatMap((entry, index) => mapHotelEntry(request, entry, index)).slice(0, normalizeLimit(options.limit, 5));
  }

  private async findHotelIds(request: TravelSearchRequest, signal?: AbortSignal): Promise<string[]> {
    const destination = request.destination ?? request.location;
    const cityCode = locationCode(destination);
    const lat = finiteNumber(destination?.lat);
    const lng = finiteNumber(destination?.lng);
    const params = new URLSearchParams();
    let path: string;
    if (cityCode) {
      path = '/v1/reference-data/locations/hotels/by-city';
      params.set('cityCode', cityCode);
    } else if (lat !== null && lng !== null) {
      path = '/v1/reference-data/locations/hotels/by-geocode';
      params.set('latitude', String(lat));
      params.set('longitude', String(lng));
      params.set('radius', '25');
      params.set('radiusUnit', 'KM');
    } else {
      throw new Error('Hotel search requires a destination city code, geocode, or preferences.hotelIds.');
    }

    const payload = await this.getJson(`${path}?${params}`, signal);
    const hotels = Array.isArray((payload as { data?: unknown }).data) ? ((payload as { data: unknown[] }).data as Array<{ hotelId?: string }>) : [];
    return hotels.map((hotel) => hotel.hotelId).filter((id): id is string => Boolean(id));
  }

  private async getJson(path: string, signal?: AbortSignal): Promise<unknown> {
    const token = await this.getAccessToken(signal);
    const response = (await this.fetchImpl(`${this.baseUrl}${path}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal,
    })) as AmadeusFetchResponse;
    return parseResponse(response, 'Amadeus request failed');
  }

  private async getAccessToken(signal?: AbortSignal): Promise<string> {
    if (this.token && this.token.expiresAt > this.now() + TOKEN_REFRESH_SKEW_MS) return this.token.value;

    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: this.clientId,
      client_secret: this.clientSecret,
    });
    const response = (await this.fetchImpl(`${this.baseUrl}/v1/security/oauth2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      signal,
    })) as AmadeusFetchResponse;
    const payload = (await parseResponse(response, 'Amadeus authentication failed')) as AmadeusTokenResponse;
    if (!payload.access_token) throw new Error('Amadeus authentication response did not include an access token.');
    this.token = {
      value: payload.access_token,
      expiresAt: this.now() + Math.max(1, payload.expires_in ?? 1800) * 1000,
    };
    return this.token.value;
  }
}

async function parseResponse(response: AmadeusFetchResponse, fallback: string): Promise<unknown> {
  const payload = await response.json().catch(() => null);
  if (response.ok) return payload;
  const detail = errorDetail(payload);
  throw new Error(`${fallback}: ${response.status} ${response.statusText}${detail ? ` - ${detail}` : ''}`);
}

function errorDetail(payload: unknown): string | null {
  const errors = (payload as { errors?: Array<{ title?: string; detail?: string }> } | null)?.errors;
  if (!Array.isArray(errors) || errors.length === 0) return null;
  return errors
    .map((error) => error.detail || error.title)
    .filter(Boolean)
    .join('; ');
}

function mapFlightOffer(request: TravelSearchRequest, offer: AmadeusFlightOffer, index: number): TravelSearchResult {
  const firstSegment = offer.itineraries?.[0]?.segments?.[0];
  const lastSegments = offer.itineraries?.[offer.itineraries.length - 1]?.segments ?? [];
  const lastSegment = lastSegments[lastSegments.length - 1] ?? firstSegment;
  const title = [
    firstSegment?.carrierCode && firstSegment?.number ? `${firstSegment.carrierCode}${firstSegment.number}` : null,
    `${firstSegment?.departure?.iataCode ?? locationCode(request.origin) ?? 'Origin'} to ${lastSegment?.arrival?.iataCode ?? locationCode(request.destination) ?? 'destination'}`,
  ]
    .filter(Boolean)
    .join(' · ');

  return {
    provider: 'amadeus',
    externalId: offer.id ?? `flight-${index + 1}`,
    title,
    price: money(offer.price?.grandTotal ?? offer.price?.total),
    currency: offer.price?.currency ?? request.budget?.currency ?? null,
    timing: {
      startsAt: firstSegment?.departure?.at ?? request.startsAt ?? null,
      endsAt: lastSegment?.arrival?.at ?? request.endsAt ?? null,
      timezone: request.destination?.timezone ?? null,
      durationMinutes: durationMinutes(firstSegment?.departure?.at ?? null, lastSegment?.arrival?.at ?? null),
      label: offer.itineraries?.[0]?.duration ?? null,
    },
    cancellationHint: null,
    refundHint: null,
    deepLink: null,
    metadata: {
      source: offer.source ?? null,
      bookableSeats: offer.numberOfBookableSeats ?? null,
      itineraries: offer.itineraries ?? [],
      travelerPricings: offer.travelerPricings ?? null,
      stopCount: Math.max(0, (offer.itineraries?.[0]?.segments?.length ?? 1) - 1),
    },
  };
}

function mapHotelEntry(request: TravelSearchRequest, entry: AmadeusHotelEntry, entryIndex: number): TravelSearchResult[] {
  const hotel = entry.hotel;
  const offers = entry.offers ?? [];
  return offers.map((offer, offerIndex) => ({
    provider: 'amadeus',
    externalId: offer.id ?? `${hotel?.hotelId ?? 'hotel'}-${entryIndex + 1}-${offerIndex + 1}`,
    title: hotel?.name ?? offer.room?.description?.text ?? 'Hotel offer',
    price: money(offer.price?.total ?? offer.price?.base),
    currency: offer.price?.currency ?? request.budget?.currency ?? null,
    timing: {
      startsAt: offer.checkInDate ?? request.startsAt ?? null,
      endsAt: offer.checkOutDate ?? request.endsAt ?? null,
      timezone: request.destination?.timezone ?? request.location?.timezone ?? null,
      durationMinutes: durationMinutes(offer.checkInDate ?? null, offer.checkOutDate ?? null),
    },
    cancellationHint: offer.policies?.cancellations?.[0]?.description?.text ?? null,
    refundHint: offer.policies?.refundable?.cancellationRefund ?? null,
    deepLink: offer.self ?? entry.self ?? null,
    metadata: {
      hotelId: hotel?.hotelId ?? null,
      cityCode: hotel?.cityCode ?? null,
      lat: hotel?.latitude ?? null,
      lng: hotel?.longitude ?? null,
      room: offer.room ?? null,
    },
  }));
}

function normalizeEnv(value: string | undefined): AmadeusEnv {
  return value?.toLowerCase() === 'production' ? 'production' : 'test';
}

function normalizeLimit(limit: number | undefined, fallback: number): number {
  if (typeof limit !== 'number' || !Number.isFinite(limit)) return fallback;
  return Math.max(1, Math.min(20, Math.floor(limit)));
}

function locationCode(location: TravelSearchLocation | null | undefined): string | null {
  const code = location?.code?.trim();
  return code ? code.toUpperCase() : null;
}

function dateOnly(value: string | null | undefined): string | null {
  if (!value) return null;
  const match = value.match(/^\d{4}-\d{2}-\d{2}/);
  return match ? match[0] : null;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function money(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function durationMinutes(startsAt: string | null, endsAt: string | null): number | null {
  if (!startsAt || !endsAt) return null;
  const start = Date.parse(startsAt);
  const end = Date.parse(endsAt);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
  return Math.round((end - start) / 60000);
}

function stringList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
  if (typeof value === 'string') return value.split(',').map((item) => item.trim()).filter(Boolean);
  return [];
}
