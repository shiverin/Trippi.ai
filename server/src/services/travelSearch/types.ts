export type TravelSearchProviderId = string;

export type TravelSearchIntentType =
  | 'flight'
  | 'hotel'
  | 'train'
  | 'bus'
  | 'ferry'
  | 'rental_car'
  | 'restaurant'
  | 'event'
  | 'activity'
  | 'tour'
  | 'other'
  | (string & {});

export interface TravelSearchLocation {
  name?: string | null;
  code?: string | null;
  lat?: number | null;
  lng?: number | null;
  timezone?: string | null;
  country?: string | null;
}

export interface TravelSearchParty {
  adults?: number;
  children?: number;
  infants?: number;
  rooms?: number;
}

export interface TravelSearchBudget {
  maxPrice?: number | null;
  currency?: string | null;
}

/**
 * Portable input shape for a future booking-intent row to hand to providers.
 * It intentionally stays persistence-free so issue #14 can own storage/API.
 */
export interface TravelSearchRequest {
  bookingIntentId?: string | number;
  tripId?: string | number;
  userId?: string | number;
  type: TravelSearchIntentType;
  title?: string | null;
  origin?: TravelSearchLocation | null;
  destination?: TravelSearchLocation | null;
  location?: TravelSearchLocation | null;
  startsAt?: string | null;
  endsAt?: string | null;
  party?: TravelSearchParty | null;
  budget?: TravelSearchBudget | null;
  preferences?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export interface TravelSearchTiming {
  startsAt: string | null;
  endsAt: string | null;
  timezone: string | null;
  durationMinutes: number | null;
  label?: string | null;
}

export interface TravelSearchResult {
  provider: TravelSearchProviderId;
  externalId: string;
  title: string;
  /** Price in major currency units, normalized from provider-specific shapes. */
  price: number | null;
  currency: string | null;
  timing: TravelSearchTiming;
  cancellationHint: string | null;
  refundHint: string | null;
  deepLink: string | null;
  metadata: Record<string, unknown>;
}

export interface TravelSearchOptions {
  limit?: number;
  signal?: AbortSignal;
}

export interface TravelSearchAdapter {
  readonly provider: TravelSearchProviderId;
  readonly displayName?: string;
  isAvailable?(): boolean | Promise<boolean>;
  search(request: TravelSearchRequest, options?: TravelSearchOptions): Promise<TravelSearchResult[]>;
}

export type TravelSearchAdapterFactory = () => TravelSearchAdapter | Promise<TravelSearchAdapter>;
