import { http, HttpResponse } from 'msw';
import {
  buildBudgetItem,
  buildDay,
  buildPackingItem,
  buildPlace,
  buildReservation,
  buildTodoItem,
  buildTrip,
  buildTripFile,
  buildUser,
} from '../../factories';

function buildOverview(tripId: number, title = 'Test Trip') {
  return {
    generated_at: '2026-06-30T12:00:00.000Z',
    trip: {
      id: tripId,
      title,
      start_date: '2026-07-01',
      end_date: '2026-07-10',
      currency: 'USD',
    },
    summary: {
      phase: 'before',
      subtitle: 'Pre-trip readiness',
      trip_date_label: 'Jul 1 - Jul 10',
      trip_length_label: '10 days',
      traveler_label: '1 traveler',
      next_deadline_label: 'Tomorrow',
      flagged_count: 0,
      clear_count: 1,
    },
    readiness: {
      title: 'Trip readiness checklist',
      summary: '5/5 checks ready',
      status: 'good',
      completed_count: 5,
      total_count: 5,
      caveat: 'Document follow-ups use explicit document tasks and files linked to reservations.',
      items: [
        {
          id: 'bookings',
          title: 'Confirm bookings',
          summary: 'No booking follow-ups',
          status: 'good',
          count: 0,
          action: 'bookings',
          action_label: 'Review bookings',
        },
      ],
    },
    boards: [
      {
        id: 'bookings',
        title: 'Booking tasks',
        summary: 'Bookings look settled',
        status: 'good',
        count: 0,
        action: 'bookings',
        action_label: 'Review bookings',
        empty_title: 'No bookings yet',
        empty_text: 'Add reservations or booking intents so confirmations have a home.',
        items: [],
      },
    ],
  };
}

export const tripsHandlers = [
  // List all trips (active or archived)
  http.get('/api/trips', ({ request }) => {
    const url = new URL(request.url);
    const archived = url.searchParams.get('archived');
    if (archived) {
      return HttpResponse.json({ trips: [] });
    }
    const trip1 = buildTrip({ title: 'Paris Adventure', start_date: '2026-07-01', end_date: '2026-07-10' });
    const trip2 = buildTrip({ title: 'Tokyo Trip', start_date: '2026-09-01', end_date: '2026-09-15' });
    return HttpResponse.json({ trips: [trip1, trip2] });
  }),

  http.get('/api/trips/:id', ({ params }) => {
    const trip = buildTrip({ id: Number(params.id) });
    return HttpResponse.json({ trip });
  }),

  http.get('/api/trips/:id/overview', ({ params }) => {
    const tripId = Number(params.id);
    return HttpResponse.json({ overview: buildOverview(tripId) });
  }),

  http.get('/api/trips/:id/days', ({ params }) => {
    const tripId = Number(params.id);
    const day1 = buildDay({ trip_id: tripId, assignments: [], notes_items: [] });
    const day2 = buildDay({ trip_id: tripId, assignments: [], notes_items: [] });
    return HttpResponse.json({ days: [day1, day2] });
  }),

  http.put('/api/trips/:id', async ({ params, request }) => {
    const body = (await request.json()) as Record<string, unknown>;
    const trip = buildTrip({ id: Number(params.id), ...body });
    return HttpResponse.json({ trip });
  }),

  http.post('/api/trips', async ({ request }) => {
    const body = (await request.json()) as Record<string, unknown>;
    const trip = buildTrip({ ...body });
    return HttpResponse.json({ trip });
  }),

  http.get('/api/trips/:id/members', ({ params }) => {
    const owner = buildUser();
    return HttpResponse.json({ owner, members: [] });
  }),

  http.get('/api/trips/:id/accommodations', () => {
    return HttpResponse.json({ accommodations: [] });
  }),

  http.get('/api/trips/:id/decisions', () => {
    return HttpResponse.json({ decisions: [] });
  }),

  http.get('/api/trips/:id/bundle', ({ params }) => {
    const tripId = Number(params.id);
    const trip = buildTrip({ id: tripId });
    const day = buildDay({ trip_id: tripId, assignments: [], notes_items: [] });
    return HttpResponse.json({
      trip,
      days: [day],
      places: [buildPlace({ trip_id: tripId })],
      packingItems: [buildPackingItem({ trip_id: tripId })],
      todoItems: [buildTodoItem({ trip_id: tripId })],
      budgetItems: [buildBudgetItem({ trip_id: tripId })],
      reservations: [buildReservation({ trip_id: tripId })],
      files: [buildTripFile({ trip_id: tripId })],
    });
  }),

  http.delete('/api/trips/:id', () => {
    return HttpResponse.json({ success: true });
  }),

  http.post('/api/trips/:id/copy', async ({ params, request }) => {
    const body = (await request.json()) as Record<string, unknown>;
    const trip = buildTrip({ id: Number(params.id) + 1000, ...body });
    return HttpResponse.json({ trip });
  }),
];
