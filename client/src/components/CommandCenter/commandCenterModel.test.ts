import { describe, expect, it } from 'vitest';
import {
  buildAssignment,
  buildBudgetItem,
  buildDay,
  buildPackingItem,
  buildReservation,
  buildTodoItem,
  buildTrip,
  buildTripFile,
} from '../../../tests/helpers/factories';
import type { GroupDecision } from '../Decisions/groupDecisionModel';
import { buildTripCommandCenter } from './commandCenterModel';

function buildDecision(overrides: Partial<GroupDecision> = {}): GroupDecision {
  return {
    id: 20,
    trip_id: 8,
    created_by: 1,
    created_by_username: 'Maya',
    created_by_avatar: null,
    title: 'Approve flight option',
    description: null,
    deadline: '2026-07-01',
    state: 'open',
    final_option_id: null,
    final_option: null,
    options: [
      {
        id: 301,
        decision_id: 20,
        booking_option_id: 901,
        label: 'Nonstop Flight',
        description: null,
        sort_order: 0,
        metadata: null,
        created_at: '2026-06-29T10:00:00Z',
      },
      {
        id: 302,
        decision_id: 20,
        booking_option_id: 902,
        label: 'Flexible Flight',
        description: null,
        sort_order: 1,
        metadata: null,
        created_at: '2026-06-29T10:00:00Z',
      },
    ],
    responses: [],
    links: [
      { id: 1, decision_id: 20, target_type: 'booking_intent', target_id: 701, created_at: '2026-06-29T10:00:00Z' },
    ],
    created_at: '2026-06-29T10:00:00Z',
    updated_at: '2026-06-29T10:00:00Z',
    ...overrides,
  };
}

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
      files: [],
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
    expect(center.modules.find((module) => module.id === 'packing')?.summary).toContain('1 packing blocker');
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
      files: [],
      tripMembers: [],
      now: new Date('2026-06-30T12:00:00Z'),
    });

    expect(center.phase).toBe('unscheduled');
    expect(center.modules.find((module) => module.id === 'decisions')?.emptyText).toContain('Add a decision task');
    expect(center.modules.find((module) => module.id === 'bookings')?.actionLabel).toBe('Add booking intent');
    expect(center.modules.find((module) => module.id === 'packing')?.emptyText).toContain('Create a packing list');
    expect(center.modules.find((module) => module.id === 'plan')?.status).toBe('good');
  });

  it('shows pending booking-linked decisions in booking tasks', () => {
    const trip = buildTrip({ id: 8, title: 'Lisbon Crew', start_date: '2026-07-02', end_date: '2026-07-06' });
    const decision = buildDecision();

    const center = buildTripCommandCenter({
      trip,
      days: [],
      assignments: {},
      reservations: [],
      budgetItems: [],
      packingItems: [],
      todoItems: [],
      files: [],
      tripMembers: [{ id: 1, username: 'Maya', avatar_url: null } as any],
      groupDecisions: [decision],
      now: new Date('2026-06-30T12:00:00Z'),
    });

    const bookingModule = center.modules.find((module) => module.id === 'bookings');
    expect(bookingModule?.status).toBe('attention');
    expect(bookingModule?.items[0]).toMatchObject({
      id: `booking-decision-${decision.id}`,
      title: 'Approve flight option',
      meta: 'Due tomorrow - 0 responses',
    });
  });

  it('surfaces critical unpacked or unassigned packing blockers ahead of regular open items', () => {
    const trip = buildTrip({
      id: 12,
      title: 'Kyoto Crew',
      start_date: '2026-07-10',
      end_date: '2026-07-14',
    });

    const center = buildTripCommandCenter({
      trip,
      days: [],
      assignments: {},
      reservations: [],
      budgetItems: [],
      packingItems: [
        buildPackingItem({ id: 901, trip_id: trip.id, name: 'Passport', category: 'Documents', checked: 0 }),
        buildPackingItem({ id: 902, trip_id: trip.id, name: 'Prescription meds', category: 'Health', checked: 1 }),
        buildPackingItem({ id: 903, trip_id: trip.id, name: 'Rain jacket', category: 'Clothing', checked: 0 }),
        buildPackingItem({ id: 904, trip_id: trip.id, name: '...', category: 'Empty category', checked: 0 }),
      ],
      packingCategoryAssignees: {
        Documents: [{ user_id: 2, username: 'Alice', avatar: null }],
        Clothing: [{ user_id: 2, username: 'Alice', avatar: null }],
      },
      todoItems: [],
      files: [],
      tripMembers: [{ id: 2, username: 'Alice', avatar_url: null } as any],
      now: new Date('2026-06-30T12:00:00Z'),
    });

    const packing = center.modules.find((module) => module.id === 'packing');
    expect(packing?.status).toBe('urgent');
    expect(packing?.count).toBe(2);
    expect(packing?.items[0]).toMatchObject({
      title: 'Passport',
      meta: 'Critical item open - Alice',
      tone: 'urgent',
    });
    expect(packing?.items[1]).toMatchObject({
      title: 'Prescription meds',
      meta: 'Critical item needs owner',
      tone: 'urgent',
    });
    expect(packing?.items[2]).toMatchObject({
      title: 'Rain jacket',
      meta: 'Alice - Clothing',
      tone: 'good',
    });
    expect(packing?.items.map((item) => item.title)).not.toContain('...');
  });

  it('builds readiness checklist items and updates when source data is resolved', () => {
    const trip = buildTrip({
      id: 13,
      title: 'Readiness Trip',
      start_date: '2026-07-10',
      end_date: '2026-07-14',
      currency: 'USD',
    });
    const flight = buildReservation({
      id: 401,
      trip_id: trip.id,
      type: 'flight',
      status: 'pending',
      confirmation_number: null,
      title: 'Flight to Porto',
    });
    const decisionTodo = buildTodoItem({
      id: 501,
      trip_id: trip.id,
      name: 'Decide airport transfer',
      category: 'Decision',
    });
    const documentTodo = buildTodoItem({
      id: 502,
      trip_id: trip.id,
      name: 'Upload travel insurance docs',
      category: 'Documents',
    });
    const bookingTodo = buildTodoItem({
      id: 503,
      trip_id: trip.id,
      name: 'Book museum tickets',
      category: 'Booking',
    });
    const unpaidExpense = buildBudgetItem({
      id: 601,
      trip_id: trip.id,
      name: 'Apartment balance',
      payers: [{ user_id: 1, amount: 400, username: 'Alice' }],
      members: [{ user_id: 2, paid: 0, username: 'Bob' }],
    });
    const unpackedItem = buildPackingItem({ id: 701, trip_id: trip.id, name: 'Adapter', checked: 0 });

    const center = buildTripCommandCenter({
      trip,
      days: [],
      assignments: {},
      reservations: [flight],
      budgetItems: [unpaidExpense],
      packingItems: [unpackedItem],
      todoItems: [decisionTodo, documentTodo, bookingTodo],
      files: [],
      tripMembers: [],
      now: new Date('2026-06-30T12:00:00Z'),
    });

    expect(center.readinessChecklist.items.map((item) => [item.id, item.action, item.count])).toEqual([
      ['decisions', 'decisions', 1],
      ['balances', 'budget', 1],
      ['bookings', 'bookings', 2],
      ['packing', 'packing', 1],
      ['documents', 'files', 2],
    ]);
    expect(center.readinessChecklist.status).toBe('attention');
    expect(center.readinessChecklist.caveat).toContain('inferred from uploaded files');

    const resolvedCenter = buildTripCommandCenter({
      trip,
      days: [],
      assignments: {},
      reservations: [
        buildReservation({
          ...flight,
          status: 'confirmed',
          confirmation_number: 'TP123',
        }),
      ],
      budgetItems: [
        buildBudgetItem({
          ...unpaidExpense,
          members: [{ user_id: 2, paid: 1, username: 'Bob' }],
        }),
      ],
      packingItems: [buildPackingItem({ ...unpackedItem, checked: 1 })],
      todoItems: [
        buildTodoItem({ ...decisionTodo, checked: 1 }),
        buildTodoItem({ ...documentTodo, checked: 1 }),
        buildTodoItem({ ...bookingTodo, checked: 1 }),
      ],
      files: [buildTripFile({ trip_id: trip.id, reservation_id: flight.id, original_name: 'boarding-pass.pdf' })],
      tripMembers: [],
      now: new Date('2026-06-30T12:00:00Z'),
    });

    expect(resolvedCenter.readinessChecklist.items.every((item) => item.status === 'good')).toBe(true);
    expect(resolvedCenter.readinessChecklist.summary).toBe('5/5 checks ready');
  });
});
