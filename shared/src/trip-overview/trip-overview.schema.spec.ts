import { tripOverviewResponseSchema } from './trip-overview.schema';

import { describe, expect, it } from 'vitest';

describe('tripOverviewResponseSchema', () => {
  it('accepts the production overview board contract', () => {
    const parsed = tripOverviewResponseSchema.parse({
      overview: {
        generated_at: '2026-06-30T10:00:00.000Z',
        trip: {
          id: 1,
          title: 'China Trip',
          start_date: '2026-12-07',
          end_date: '2026-12-17',
          currency: 'USD',
        },
        summary: {
          phase: 'before',
          subtitle: 'Pre-trip readiness',
          trip_date_label: 'Dec 7 - Dec 17',
          trip_length_label: '11 days',
          traveler_label: '4 travelers',
          next_deadline_label: 'In 160d',
          flagged_count: 2,
          clear_count: 1,
        },
        readiness: {
          title: 'Trip readiness checklist',
          summary: '3/5 checks ready',
          status: 'attention',
          completed_count: 3,
          total_count: 5,
          caveat: 'Document follow-ups use explicit tasks and linked reservation files.',
          items: [
            {
              id: 'bookings',
              title: 'Confirm bookings',
              summary: '2 booking follow-ups',
              status: 'attention',
              count: 2,
              action: 'bookings',
              action_label: 'Open bookings',
            },
          ],
        },
        boards: [
          {
            id: 'bookings',
            title: 'Booking tasks',
            summary: '2 booking follow-ups',
            status: 'attention',
            count: 2,
            action: 'bookings',
            action_label: 'Review bookings',
            items: [
              {
                id: 'reservation-10',
                source: 'reservation',
                source_id: 10,
                title: 'Flight to Beijing',
                meta: 'Missing confirmation code',
                status: 'attention',
              },
            ],
          },
        ],
      },
    });

    expect(parsed.overview.boards[0]!.items[0]!.source).toBe('reservation');
  });
});
