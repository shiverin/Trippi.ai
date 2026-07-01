import {
  mapsSearchRequestSchema,
  mapsAutocompleteRequestSchema,
  mapsMapboxSessionResultSchema,
  mapsReverseQuerySchema,
  mapsResolveUrlRequestSchema,
} from './maps.schema';

import { describe, it, expect } from 'vitest';

describe('mapsSearchRequestSchema', () => {
  it('requires a non-empty query', () => {
    expect(mapsSearchRequestSchema.safeParse({ query: 'berlin' }).success).toBe(true);
    expect(mapsSearchRequestSchema.safeParse({ query: '' }).success).toBe(false);
    expect(mapsSearchRequestSchema.safeParse({}).success).toBe(false);
  });
});

describe('mapsAutocompleteRequestSchema', () => {
  it('caps input at 200 chars and allows an optional locationBias', () => {
    expect(mapsAutocompleteRequestSchema.safeParse({ input: 'be' }).success).toBe(true);
    expect(mapsAutocompleteRequestSchema.safeParse({ input: 'x'.repeat(201) }).success).toBe(false);
    expect(
      mapsAutocompleteRequestSchema.safeParse({
        input: 'be',
        locationBias: { low: { lat: 1, lng: 2 }, high: { lat: 3, lng: 4 } },
      }).success,
    ).toBe(true);
  });
});

describe('mapsReverseQuerySchema', () => {
  it('requires lat and lng as strings (the route parses them downstream)', () => {
    expect(mapsReverseQuerySchema.safeParse({ lat: '52.5', lng: '13.4' }).success).toBe(true);
    expect(mapsReverseQuerySchema.safeParse({ lat: '52.5' }).success).toBe(false);
  });
});

describe('mapsResolveUrlRequestSchema', () => {
  it('requires a non-empty url', () => {
    expect(
      mapsResolveUrlRequestSchema.safeParse({
        url: 'https://maps.app.goo.gl/x',
      }).success,
    ).toBe(true);
    expect(mapsResolveUrlRequestSchema.safeParse({ url: '' }).success).toBe(false);
  });
});

describe('mapsMapboxSessionResultSchema', () => {
  it('accepts enabled proxy sessions and quota fallback responses', () => {
    expect(
      mapsMapboxSessionResultSchema.safeParse({
        enabled: true,
        sessionId: 'session-1',
        styleUrl: '/api/maps/mapbox/style?style=mapbox%3A%2F%2Fstyles%2Fmapbox%2Fstandard&session=session-1',
        fallbackProvider: 'maplibre-gl',
        month: '2026-07',
        used: 1,
        limit: 45000,
        remaining: 44999,
      }).success,
    ).toBe(true);

    expect(
      mapsMapboxSessionResultSchema.safeParse({
        enabled: false,
        fallbackProvider: 'maplibre-gl',
        month: '2026-07',
        used: 45000,
        limit: 45000,
        remaining: 0,
        reason: 'quota_exhausted',
      }).success,
    ).toBe(true);
  });

  it('rejects token-bearing or unknown fallback providers', () => {
    expect(
      mapsMapboxSessionResultSchema.safeParse({
        enabled: true,
        access_token: 'pk.leak',
        fallbackProvider: 'leaflet',
        month: '2026-07',
        used: 1,
        limit: 45000,
        remaining: 44999,
      }).success,
    ).toBe(false);
  });
});
