import { closeDb, db } from '../../../src/db/database';
import { BookingIntentsService } from '../../../src/nest/booking-intents/booking-intents.service';
import { BookingOptionsService } from '../../../src/nest/booking-options/booking-options.service';
import { processNextAgentJob } from '../../../src/services/agentJobWorker';
import { bookingPriceWatchHandlers } from '../../../src/services/bookingPriceWatch';
import { createTrip, createUser } from '../../helpers/factories';
import { resetTestDb } from '../../helpers/test-db';

import { afterAll, beforeEach, describe, expect, it } from 'vitest';

beforeEach(() => {
  resetTestDb(db);
});

afterAll(() => {
  closeDb();
});

describe('booking price watch worker', () => {
  it('uses mock provider results to populate options and update watch status', async () => {
    const { user } = createUser(db);
    const trip = createTrip(db, user.id, { title: 'Kyoto planning' });
    const intents = new BookingIntentsService();
    const options = new BookingOptionsService();
    const intent = await intents.create(String(trip.id), user.id, {
      type: 'hotel',
      destination: 'Kyoto',
      dates: { checkIn: '2026-11-02', checkOut: '2026-11-05' },
      party_constraints: { adults: 2, rooms: 1 },
      budget: { max: 900, currency: 'USD' },
      preferences: { refundable: true },
    });

    await intents.startWatch(String(trip.id), String(intent!.id));
    const result = await processNextAgentJob({
      workerId: 'price-watch-test-worker',
      handlers: bookingPriceWatchHandlers,
    });

    expect(result.status).toBe('succeeded');
    if (result.status !== 'succeeded') throw new Error('expected price watch job to succeed');
    expect(result.job.resultMetadata).toMatchObject({
      bookingIntentId: intent!.id,
      tripId: trip.id,
      provider: 'mock-travel',
      providerMode: 'mock-development-provider',
      mockProvider: true,
      resultCount: 2,
      upsertedOptions: 2,
    });

    const refreshed = await intents.list(String(trip.id), 'options_ready');
    expect(refreshed).toHaveLength(1);
    expect(refreshed[0]).toMatchObject({
      id: intent!.id,
      status: 'options_ready',
      watch_status: 'checked',
    });
    expect(refreshed[0].last_checked_at).toEqual(expect.any(String));

    const populated = await options.list(String(trip.id), String(intent!.id));
    expect(populated).toHaveLength(2);
    expect(populated?.[0]).toMatchObject({
      provider: 'mock-travel',
      status: 'current',
      price: expect.any(Number),
      currency: 'USD',
      score: expect.any(Number),
      metadata: {
        source: 'mock-development-provider',
        mock: true,
        provider_metadata: {
          mock: true,
          requestType: 'hotel',
          bookingIntentId: intent!.id,
        },
        ranking: {
          rank: expect.any(Number),
          score: expect.any(Number),
          reasons: expect.any(Array),
          breakdown: expect.any(Object),
        },
      },
    });
    expect(populated?.[0].checkout_url).toContain('https://trippi.example/mock-search/mock-travel/');
  });
});
