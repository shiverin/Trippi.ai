import { AmadeusTravelSearchAdapter } from './amadeusAdapter';
import { createMockTravelSearchAdapter } from './mockAdapter';
import type { TravelSearchAdapter } from './types';

export type TravelSearchProviderMode = 'mock-development-provider' | 'amadeus-live-provider' | 'unavailable';

export interface TravelSearchFeatureStatus {
  enabled: boolean;
  provider: 'mock' | 'amadeus' | 'unavailable';
  providerMode: TravelSearchProviderMode;
  supportsFlights: boolean;
  supportsHotels: boolean;
  mock: boolean;
  reason?: string;
}

function configuredProvider(): 'mock' | 'amadeus' {
  const raw = process.env.TRAVEL_SEARCH_PROVIDER?.trim().toLowerCase();
  if (raw === 'amadeus') return 'amadeus';
  if (raw === 'mock') return 'mock';
  return process.env.NODE_ENV?.toLowerCase() === 'production' ? 'amadeus' : 'mock';
}

function hasAmadeusCredentials(): boolean {
  return Boolean(process.env.AMADEUS_CLIENT_ID?.trim() && process.env.AMADEUS_CLIENT_SECRET?.trim());
}

export function getTravelSearchFeatureStatus(): TravelSearchFeatureStatus {
  const provider = configuredProvider();

  if (provider === 'mock') {
    return {
      enabled: process.env.NODE_ENV?.toLowerCase() !== 'production',
      provider: 'mock',
      providerMode: 'mock-development-provider',
      supportsFlights: true,
      supportsHotels: true,
      mock: true,
      reason:
        process.env.NODE_ENV?.toLowerCase() === 'production'
          ? 'Mock travel search is disabled in production.'
          : undefined,
    };
  }

  if (!hasAmadeusCredentials()) {
    return {
      enabled: false,
      provider: 'amadeus',
      providerMode: 'unavailable',
      supportsFlights: false,
      supportsHotels: false,
      mock: false,
      reason: 'Amadeus credentials are not configured.',
    };
  }

  return {
    enabled: true,
    provider: 'amadeus',
    providerMode: 'amadeus-live-provider',
    supportsFlights: true,
    supportsHotels: true,
    mock: false,
  };
}

export function createConfiguredTravelSearchAdapter(): TravelSearchAdapter {
  const status = getTravelSearchFeatureStatus();
  if (!status.enabled) throw new Error(status.reason ?? 'Travel search provider is unavailable.');
  if (status.provider === 'mock') return createMockTravelSearchAdapter();
  if (status.enabled && status.provider === 'amadeus') return new AmadeusTravelSearchAdapter();
  throw new Error(status.reason ?? 'Travel search provider is unavailable.');
}
