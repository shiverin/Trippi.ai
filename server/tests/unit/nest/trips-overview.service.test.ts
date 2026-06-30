import { TripsOverviewService } from '../../../src/nest/trips/trips-overview.service';
import { tripOverviewResponseSchema } from '@trippi/shared';

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { asyncDbMock, canAccessTripAsync } = vi.hoisted(() => {
  const asyncDbMock = {
    prepare: vi.fn((sql: string) => {
      if (sql.includes('FROM trips WHERE id = ?')) {
        return {
          get: vi.fn().mockResolvedValue({
            id: 42,
            title: 'Fallback Trip',
            start_date: null,
            end_date: null,
            currency: 'USD',
          }),
          all: vi.fn().mockResolvedValue([]),
        };
      }
      if (sql.includes('group_decisions') || sql.includes('booking_intents') || sql.includes('trip_members')) {
        throw new Error('ORA-00942: table or view does not exist');
      }
      return {
        get: vi.fn().mockResolvedValue(undefined),
        all: vi.fn().mockResolvedValue([]),
      };
    }),
  };

  return {
    asyncDbMock,
    canAccessTripAsync: vi.fn().mockResolvedValue({ id: 42, user_id: 7 }),
  };
});

vi.mock('../../../src/db/asyncDatabase', () => ({
  asyncDb: asyncDbMock,
  canAccessTripAsync,
}));

const serviceMocks = vi.hoisted(() => ({
  listDays: vi.fn(() => {
    throw new Error('sync day query failed');
  }),
  listReservations: vi.fn().mockRejectedValue(new Error('reservation query failed')),
  listBudgetItems: vi.fn().mockResolvedValue([]),
  listPackingItems: vi.fn().mockResolvedValue([]),
  listBags: vi.fn().mockResolvedValue([]),
  getCategoryAssignees: vi.fn().mockResolvedValue({}),
  listTodoItems: vi.fn().mockResolvedValue([]),
  listFilesAsync: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../../src/services/dayService', () => ({
  listDays: serviceMocks.listDays,
}));
vi.mock('../../../src/services/reservationService', () => ({
  listReservations: serviceMocks.listReservations,
}));
vi.mock('../../../src/services/budgetService', () => ({
  listBudgetItems: serviceMocks.listBudgetItems,
}));
vi.mock('../../../src/services/packingService', () => ({
  listItems: serviceMocks.listPackingItems,
  listBags: serviceMocks.listBags,
  getCategoryAssignees: serviceMocks.getCategoryAssignees,
}));
vi.mock('../../../src/services/todoService', () => ({
  listItems: serviceMocks.listTodoItems,
}));
vi.mock('../../../src/services/fileService', () => ({
  listFilesAsync: serviceMocks.listFilesAsync,
}));

describe('TripsOverviewService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns an overview when optional board sources fail', async () => {
    const overview = await new TripsOverviewService().getOverview('42', 7, new Date('2026-01-01T00:00:00Z'));

    expect(overview).not.toBeNull();
    expect(tripOverviewResponseSchema.parse({ overview })).toMatchObject({
      overview: {
        trip: { id: 42, title: 'Fallback Trip' },
        summary: { phase: 'unscheduled' },
      },
    });
    expect(overview?.boards.map((board) => board.id)).toEqual([
      'decisions',
      'budget',
      'bookings',
      'packing',
      'plan',
      'deadlines',
      'files',
    ]);
    expect(overview?.boards.every((board) => Array.isArray(board.items))).toBe(true);
  });
});
