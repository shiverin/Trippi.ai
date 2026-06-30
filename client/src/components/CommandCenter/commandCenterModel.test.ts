import { describe, expect, it } from 'vitest';
import {
  buildAssignment,
  buildBudgetItem,
  buildDay,
  buildPackingItem,
  buildReservation,
  buildTodoItem,
  buildTrip,
} from '../../../tests/helpers/factories';
import { buildTripCommandCenter } from './commandCenterModel';

describe('buildTripCommandCenter', () => {
  it('summarizes decisions, budget, bookings, packing, conflicts, and deadlines', () => {
    const trip = buildTrip({
      id: 8,
      title: 'Lisbon Crew',
      start_date: '2026-07-02',
      end_date: '2026-07-06',
      currency: 'EUR',
    });
    const day = buildDay({ id: 101, trip_id: trip.id, day_number: 1, date: '2026-07-02', title: 'Arrival' });
    const emptyDay = buildDay({ id: 102, trip_id: trip.id, day_number: 2, date: '2026-07-03' });
    const firstStop = buildAssignment({
      id: 201,
      day_id: day.id,
      assignment_time: '10:00',
      assignment_end_time: '11:00',
      place: { ...buildAssignment().place, id: 301, name: 'Tile museum' },
    });
    const secondStop = buildAssignment({
      id: 202,
      day_id: day.id,
      assignment_time: '10:30',
      assignment_end_time: '12:00',
      place: { ...buildAssignment().place, id: 302, name: 'Lunch market' },
    });
    const hotel = buildReservation({
      id: 401,
      trip_id: trip.id,
      type: 'hotel',
      status: 'pending',
      confirmation_number: null,
      reservation_time: '2026-07-02T15:00:00',
      day_id: day.id,
      title: 'Check in at Casa',
    });
    const todos = [
      buildTodoItem({
        id: 501,
        trip_id: trip.id,
        name: 'Vote on Fado night',
        category: 'Decision',
        due_date: '2026-07-01',
      }),
      buildTodoItem({
        id: 502,
        trip_id: trip.id,
        name: 'Book airport transfer',
        category: 'Booking',
        due_date: '2026-06-30',
      }),
    ];

    const center = buildTripCommandCenter({
      trip,
      days: [day, emptyDay],
      assignments: { [String(day.id)]: [firstStop, secondStop], [String(emptyDay.id)]: [] },
      reservations: [hotel],
      budgetItems: [
        buildBudgetItem({ id: 601, trip_id: trip.id, name: 'Hotel deposit', total_price: 320, payers: [] }),
      ],
      packingItems: [buildPackingItem({ id: 701, trip_id: trip.id, name: 'Shared charger', checked: 0, bag_id: null })],
      todoItems: todos,
      tripMembers: [{ id: 1, username: 'alice', avatar_url: null } as any],
      now: new Date('2026-06-30T12:00:00Z'),
    });

    expect(center.phase).toBe('before');
    expect(center.modules.map((module) => module.id)).toEqual([
      'decisions',
      'budget',
      'bookings',
      'packing',
      'plan',
      'deadlines',
    ]);
    expect(center.modules.find((module) => module.id === 'decisions')?.count).toBeGreaterThan(1);
    expect(center.modules.find((module) => module.id === 'budget')?.status).toBe('attention');
    expect(center.modules.find((module) => module.id === 'bookings')?.count).toBeGreaterThan(0);
    expect(center.modules.find((module) => module.id === 'packing')?.summary).toContain('1 item');
    expect(center.modules.find((module) => module.id === 'plan')?.items[0]?.title).toContain('overlaps');
    expect(center.modules.find((module) => module.id === 'deadlines')?.items[0]?.meta).toContain('Today');
  });

  it('returns organizer guidance when backing subsystems are empty', () => {
    const trip = buildTrip({ id: 8, title: 'New Group Trip', start_date: null, end_date: null });
    const center = buildTripCommandCenter({
      trip,
      days: [],
      assignments: {},
      reservations: [],
      budgetItems: [],
      packingItems: [],
      todoItems: [],
      tripMembers: [],
      now: new Date('2026-06-30T12:00:00Z'),
    });

    expect(center.phase).toBe('unscheduled');
    expect(center.modules.find((module) => module.id === 'decisions')?.emptyText).toContain('Add a decision task');
    expect(center.modules.find((module) => module.id === 'bookings')?.actionLabel).toBe('Add booking intent');
    expect(center.modules.find((module) => module.id === 'packing')?.emptyText).toContain('Create a packing list');
    expect(center.modules.find((module) => module.id === 'plan')?.status).toBe('good');
  });
});
