import {
  MockTravelSearchAdapter,
  createMockTravelSearchAdapter,
  type TravelSearchAdapter,
  type TravelSearchRequest,
} from '../../../src/services/travelSearch';

import { describe, expect, it } from 'vitest';

const flightIntent: TravelSearchRequest = {
  bookingIntentId: 'intent-123',
  tripId: 42,
  userId: 7,
  type: 'flight',
  origin: { code: 'SIN', name: 'Singapore Changi', timezone: 'Asia/Singapore' },
  destination: { code: 'HND', name: 'Tokyo Haneda', timezone: 'Asia/Tokyo' },
  startsAt: '2026-11-01T09:00:00+08:00',
  endsAt: '2026-11-01T17:00:00+09:00',
  party: { adults: 2 },
  budget: { currency: 'SGD', maxPrice: 800 },
  metadata: { source: 'booking-intent' },
};

describe('travel search provider adapter boundary', () => {
  it('accepts booking-intent-shaped search input and returns normalized mock results', async () => {
    const adapter: TravelSearchAdapter = createMockTravelSearchAdapter();

    const results = await adapter.search(flightIntent, { limit: 1 });

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      provider: 'mock-travel',
      title: 'Flexible Flight: SIN to HND',
      price: expect.any(Number),
      currency: 'SGD',
      timing: {
        startsAt: '2026-11-01T09:00:00+08:00',
        endsAt: '2026-11-01T17:00:00+09:00',
        timezone: 'Asia/Tokyo',
        durationMinutes: 420,
      },
      cancellationHint: expect.any(String),
      refundHint: expect.any(String),
      metadata: {
        mock: true,
        rank: 1,
        requestType: 'flight',
        bookingIntentId: 'intent-123',
      },
    });
    expect(results[0].externalId).toMatch(/^flight-[a-f0-9]{10}-1$/);
    expect(results[0].deepLink).toContain('https://trippi.example/mock-search/mock-travel/');
  });

  it('is deterministic for repeatable local development and tests', async () => {
    const adapter = new MockTravelSearchAdapter();

    const first = await adapter.search(flightIntent);
    const second = await adapter.search(flightIntent);

    expect(second).toEqual(first);
  });

  it('can be fixture-backed and filtered by request type', async () => {
    const adapter = createMockTravelSearchAdapter({
      provider: 'fixture-provider',
      fixtures: [
        {
          type: 'hotel',
          externalId: 'hotel-kyoto-1',
          title: 'Fixture Ryokan Kyoto',
          price: 240,
          currency: 'JPY',
          cancellationHint: 'Fixture cancellation hint',
          refundHint: 'Fixture refund hint',
          deepLink: 'https://trippi.example/fixtures/hotel-kyoto-1',
          metadata: { fixture: true },
        },
        {
          type: 'flight',
          externalId: 'flight-not-returned',
          title: 'Fixture Flight',
        },
      ],
    });

    const results = await adapter.search({
      bookingIntentId: 'hotel-intent',
      type: 'hotel',
      location: { name: 'Kyoto', timezone: 'Asia/Tokyo' },
      startsAt: '2026-11-02',
      endsAt: '2026-11-05',
    });

    expect(results).toEqual([
      {
        provider: 'fixture-provider',
        externalId: 'hotel-kyoto-1',
        title: 'Fixture Ryokan Kyoto',
        price: 240,
        currency: 'JPY',
        timing: {
          startsAt: '2026-11-02',
          endsAt: '2026-11-05',
          timezone: 'Asia/Tokyo',
          durationMinutes: 4320,
        },
        cancellationHint: 'Fixture cancellation hint',
        refundHint: 'Fixture refund hint',
        deepLink: 'https://trippi.example/fixtures/hotel-kyoto-1',
        metadata: { fixture: true },
      },
    ]);
  });

  it('honors result limits without provider-specific contracts', async () => {
    const adapter = createMockTravelSearchAdapter();

    await expect(adapter.search(flightIntent, { limit: 0 })).resolves.toEqual([]);
    await expect(adapter.search(flightIntent, { limit: 1 })).resolves.toHaveLength(1);
    await expect(adapter.search(flightIntent, { limit: 20 })).resolves.toHaveLength(2);
  });
});
