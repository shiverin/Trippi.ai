import {
  rankTravelSearchResults,
  type RankedTravelSearchResult,
  type TravelSearchRequest,
  type TravelSearchResult,
} from '../../../src/services/travelSearch';

import { describe, expect, it } from 'vitest';

const request: TravelSearchRequest = {
  bookingIntentId: 'intent-ranking',
  type: 'flight',
  origin: { code: 'SIN', timezone: 'Asia/Singapore' },
  destination: { code: 'HND', timezone: 'Asia/Tokyo' },
  startsAt: '2026-11-01T09:00:00+08:00',
  endsAt: '2026-11-01T17:00:00+09:00',
  party: { adults: 2, children: 1 },
  budget: { maxPrice: 900, currency: 'SGD' },
};

function option(overrides: Partial<TravelSearchResult>): TravelSearchResult {
  return {
    provider: 'fixture',
    externalId: 'option',
    title: 'Fixture option',
    price: 500,
    currency: 'SGD',
    timing: {
      startsAt: request.startsAt ?? null,
      endsAt: request.endsAt ?? null,
      timezone: 'Asia/Tokyo',
      durationMinutes: 420,
    },
    cancellationHint: 'Standard cancellation policy',
    refundHint: 'Partial refund before departure',
    deepLink: 'https://example.test/option',
    metadata: {
      stopCount: 0,
      capacity: 3,
    },
    ...overrides,
  };
}

function ids(ranked: RankedTravelSearchResult[]): string[] {
  return ranked.map((entry) => entry.result.externalId);
}

describe('booking option ranking', () => {
  it('ranks the cheapest option first when other factors are comparable', () => {
    const ranked = rankTravelSearchResults(request, [
      option({ externalId: 'standard', price: 520 }),
      option({ externalId: 'cheapest', price: 410 }),
      option({ externalId: 'premium', price: 650 }),
    ]);

    expect(ids(ranked)).toEqual(['cheapest', 'standard', 'premium']);
    expect(ranked[0]).toMatchObject({
      rank: 1,
      score: expect.any(Number),
      breakdown: { price: 100 },
    });
    expect(ranked[0].reasons).toContain('Lowest price at SGD 410.');
  });

  it('does not let an inconvenient cheap option outrank a materially better itinerary', () => {
    const ranked = rankTravelSearchResults(request, [
      option({
        externalId: 'cheap-inconvenient',
        price: 350,
        timing: {
          startsAt: request.startsAt ?? null,
          endsAt: '2026-11-01T22:00:00+09:00',
          timezone: 'Asia/Tokyo',
          durationMinutes: 720,
        },
        cancellationHint: 'Strict cancellation policy',
        refundHint: 'Non-refundable fare',
        metadata: { stopCount: 3, capacity: 3, warnings: ['Long self-transfer'] },
      }),
      option({
        externalId: 'direct-balanced',
        price: 510,
        metadata: { stopCount: 0, capacity: 3 },
        cancellationHint: 'Flexible change policy',
        refundHint: 'Partial refund before departure',
      }),
    ]);

    expect(ids(ranked)).toEqual(['direct-balanced', 'cheap-inconvenient']);
    expect(ranked[1].reasons).toEqual(
      expect.arrayContaining([
        '3 stops make this less convenient.',
        '5h longer than requested.',
        'Strict or non-refundable terms reduce flexibility.',
        'Warning: Long self-transfer',
      ]),
    );
  });

  it('penalizes options with a schedule mismatch', () => {
    const ranked = rankTravelSearchResults(request, [
      option({
        externalId: 'bad-time-cheap',
        price: 300,
        timing: {
          startsAt: '2026-11-01T21:00:00+08:00',
          endsAt: '2026-11-02T05:00:00+09:00',
          timezone: 'Asia/Tokyo',
          durationMinutes: 420,
        },
      }),
      option({ externalId: 'matches-request', price: 460 }),
    ]);

    expect(ids(ranked)).toEqual(['matches-request', 'bad-time-cheap']);
    expect(ranked[1].breakdown.scheduleFit).toBeLessThan(40);
    expect(ranked[1].reasons).toContain('Schedule is 12h away from the requested time.');
  });

  it('rewards flexible and refundable options enough to break a close price tradeoff', () => {
    const ranked = rankTravelSearchResults(request, [
      option({
        externalId: 'cheap-strict',
        price: 300,
        cancellationHint: 'No cancellation after purchase',
        refundHint: 'Non-refundable fare',
      }),
      option({
        externalId: 'flexible-refundable',
        price: 335,
        cancellationHint: 'Free cancellation until 24 hours before departure',
        refundHint: 'Fully refundable fare',
        metadata: { stopCount: 0, capacity: 3, refundable: true },
      }),
    ]);

    expect(ids(ranked)).toEqual(['flexible-refundable', 'cheap-strict']);
    expect(ranked[0].reasons).toContain('Refundable or flexible policy improves this option.');
    expect(ranked[0].breakdown.flexibility).toBeGreaterThan(ranked[1].breakdown.flexibility);
  });

  it('accounts for group constraints and provider warnings', () => {
    const ranked = rankTravelSearchResults(request, [
      option({
        externalId: 'too-small',
        price: 450,
        metadata: { stopCount: 0, capacity: 2, warnings: ['Only two seats left'] },
      }),
      option({
        externalId: 'group-fit',
        price: 470,
        metadata: { stopCount: 0, capacity: 3 },
      }),
    ]);

    expect(ids(ranked)).toEqual(['group-fit', 'too-small']);
    expect(ranked[1].breakdown.groupFit).toBe(0);
    expect(ranked[1].breakdown.warnings).toBe(75);
    expect(ranked[1].reasons).toEqual(
      expect.arrayContaining(['Only fits 2 of 3 travelers.', 'Warning: Only two seats left']),
    );
  });

  it('is deterministic for repeatable ranking tests', () => {
    const results = [
      option({ externalId: 'a', price: 480 }),
      option({ externalId: 'b', price: 480 }),
      option({ externalId: 'c', price: 480 }),
    ];

    expect(rankTravelSearchResults(request, results)).toEqual(rankTravelSearchResults(request, results));
  });
});
