/**
 * Unit tests for MCP group decision tools:
 * create_group_decision, list_group_decisions, list_unresolved_group_decisions,
 * get_group_decision_status, close_group_decision, finalize_group_decision.
 */
import { runMigrations } from '../../../src/db/migrations';
import { createTables } from '../../../src/db/schema';
import { invalidatePermissionsCache } from '../../../src/services/permissions';
import {
  addTripMember,
  createDay,
  createPackingItem,
  createPlace,
  createReservation,
  createTrip,
  createUser,
} from '../../helpers/factories';
import { createMcpHarness, parseToolResult, type McpHarness } from '../../helpers/mcp-harness';
import { resetTestDb } from '../../helpers/test-db';

import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from 'vitest';

const { testDb, dbMock } = vi.hoisted(() => {
  const Database = require('better-sqlite3');
  const db = new Database(':memory:');
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA busy_timeout = 5000');
  const mock = {
    db,
    closeDb: () => {},
    reinitialize: () => {},
    getPlaceWithTags: () => null,
    canAccessTrip: (tripId: any, userId: number) =>
      db
        .prepare(
          `SELECT t.id, t.user_id FROM trips t
           LEFT JOIN trip_members m ON m.trip_id = t.id AND m.user_id = ?
           WHERE t.id = ? AND (t.user_id = ? OR m.user_id IS NOT NULL)`,
        )
        .get(userId, tripId, userId),
    isOwner: (tripId: any, userId: number) =>
      !!db.prepare('SELECT id FROM trips WHERE id = ? AND user_id = ?').get(tripId, userId),
  };
  return { testDb: db, dbMock: mock };
});

vi.mock('../../../src/db/database', () => dbMock);
vi.mock('../../../src/config', () => ({
  JWT_SECRET: 'test-jwt-secret-for-trippi-testing-only',
  ENCRYPTION_KEY: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6a7b8c9d0e1f2a3b4c5d6a7b8c9d0e1f2',
  updateJwtSecret: () => {},
}));

const { broadcastMock } = vi.hoisted(() => ({ broadcastMock: vi.fn() }));
vi.mock('../../../src/websocket', () => ({ broadcast: broadcastMock }));

vi.mock('../../../src/services/adminService', () => ({
  isAddonEnabled: vi.fn().mockReturnValue(true),
  isAddonEnabledAsync: vi.fn().mockResolvedValue(true),
  getCollabFeatures: vi.fn().mockReturnValue({ chat: true, notes: true, polls: true, whatsnext: true }),
  getCollabFeaturesAsync: vi.fn().mockResolvedValue({ chat: true, notes: true, polls: true, whatsnext: true }),
}));

beforeAll(() => {
  createTables(testDb);
  runMigrations(testDb);
});

beforeEach(() => {
  resetTestDb(testDb);
  invalidatePermissionsCache();
  broadcastMock.mockClear();
  delete process.env.DEMO_MODE;
});

afterAll(() => {
  testDb.close();
});

async function withHarness(userId: number, fn: (h: McpHarness) => Promise<void>, scopes: string[] | null = null) {
  const h = await createMcpHarness({ userId, withResources: false, scopes });
  try {
    await fn(h);
  } finally {
    await h.cleanup();
  }
}

describe('group decision MCP registration', () => {
  it('registers read tools with collab:read and write tools only with collab:write', async () => {
    const { user } = createUser(testDb);

    await withHarness(
      user.id,
      async (h) => {
        const names = (await h.client.listTools()).tools.map((tool) => tool.name);
        expect(names).toContain('list_group_decisions');
        expect(names).toContain('list_unresolved_group_decisions');
        expect(names).toContain('get_group_decision_status');
        expect(names).not.toContain('create_group_decision');
        expect(names).not.toContain('finalize_group_decision');
      },
      ['collab:read'],
    );

    await withHarness(
      user.id,
      async (h) => {
        const names = (await h.client.listTools()).tools.map((tool) => tool.name);
        expect(names).toContain('create_group_decision');
        expect(names).toContain('close_group_decision');
        expect(names).toContain('finalize_group_decision');
        expect(names).toContain('get_group_decision_status');
      },
      ['collab:write'],
    );
  });
});

describe('create_group_decision', () => {
  it('creates a decision linked to trip planning objects and returns a concise summary', async () => {
    const { user } = createUser(testDb);
    const trip = createTrip(testDb, user.id);
    const day = createDay(testDb, trip.id);
    const place = createPlace(testDb, trip.id, { name: 'Museum' });
    const reservation = createReservation(testDb, trip.id, { title: 'Train' });
    const packingItem = createPackingItem(testDb, trip.id, { name: 'Adapter' });
    const bookingIntent = testDb
      .prepare("INSERT INTO booking_intents (trip_id, created_by, type, status) VALUES (?, ?, 'hotel', 'draft')")
      .run(trip.id, user.id);

    await withHarness(user.id, async (h) => {
      const result = await h.client.callTool({
        name: 'create_group_decision',
        arguments: {
          tripId: trip.id,
          title: 'Where should we stay?',
          description: 'Pick the base for the first weekend.',
          deadline: '2026-07-15T12:00:00Z',
          options: [{ label: 'Near the station' }, { label: 'Old town' }],
          links: [
            { target_type: 'trip', target_id: trip.id },
            { target_type: 'day', target_id: day.id },
            { target_type: 'place', target_id: place.id },
            { target_type: 'reservation', target_id: reservation.id },
            { target_type: 'booking_intent', target_id: Number(bookingIntent.lastInsertRowid) },
            { target_type: 'packing_item', target_id: packingItem.id },
          ],
        },
      });

      const data = parseToolResult(result) as any;
      expect(data.decision).toMatchObject({
        title: 'Where should we stay?',
        state: 'open',
        unresolved: true,
        response_count: 0,
        participant_count: 1,
      });
      expect(data.decision.options.map((option: any) => option.label)).toEqual(['Near the station', 'Old town']);
      expect(data.decision.links.map((link: any) => link.target_type).sort()).toEqual([
        'booking_intent',
        'day',
        'packing_item',
        'place',
        'reservation',
        'trip',
      ]);
      expect(data.decision.responses).toBeUndefined();
      expect(broadcastMock).toHaveBeenCalledWith(trip.id, 'decision:created', expect.any(Object));
    });
  });

  it('rejects links to entities from another trip', async () => {
    const { user } = createUser(testDb);
    const trip = createTrip(testDb, user.id);
    const otherTrip = createTrip(testDb, user.id);
    const otherPlace = createPlace(testDb, otherTrip.id, { name: 'Wrong trip' });

    await withHarness(user.id, async (h) => {
      const result = await h.client.callTool({
        name: 'create_group_decision',
        arguments: {
          tripId: trip.id,
          title: 'Invalid link',
          options: ['A', 'B'],
          links: [{ target_type: 'place', target_id: otherPlace.id }],
        },
      });

      expect(result.isError).toBe(true);
      const text = result.content.find((item: any) => item.type === 'text') as { text: string };
      expect(text.text).toContain('Linked place');
    });
  });

  it('requires trip edit permission for member-created decisions', async () => {
    const { user: owner } = createUser(testDb);
    const { user: member } = createUser(testDb);
    const trip = createTrip(testDb, owner.id);
    addTripMember(testDb, trip.id, member.id);

    await withHarness(member.id, async (h) => {
      const denied = await h.client.callTool({
        name: 'create_group_decision',
        arguments: { tripId: trip.id, title: 'Member decision', options: ['A', 'B'] },
      });
      expect(denied.isError).toBe(true);
    });

    testDb.prepare("INSERT INTO app_settings (key, value) VALUES ('perm_trip_edit', 'trip_member')").run();
    invalidatePermissionsCache();

    await withHarness(member.id, async (h) => {
      const allowed = await h.client.callTool({
        name: 'create_group_decision',
        arguments: { tripId: trip.id, title: 'Member decision', options: ['A', 'B'] },
      });
      const data = parseToolResult(allowed) as any;
      expect(data.decision.title).toBe('Member decision');
    });
  });
});

describe('decision status and unresolved summaries', () => {
  it('reads vote status with option counts, responses, and pending member count', async () => {
    const { user: owner } = createUser(testDb);
    const { user: member } = createUser(testDb);
    const trip = createTrip(testDb, owner.id);
    addTripMember(testDb, trip.id, member.id);

    await withHarness(owner.id, async (h) => {
      const created = parseToolResult(
        await h.client.callTool({
          name: 'create_group_decision',
          arguments: { tripId: trip.id, title: 'Dinner plan', options: ['Ramen', 'Tapas'] },
        }),
      ) as any;
      const decisionId = created.decision.id;
      const tapasOptionId = created.decision.options[1].id;

      testDb
        .prepare(
          `INSERT INTO group_decision_responses (decision_id, option_id, user_id, response, comment)
           VALUES (?, ?, ?, 'selected', ?)`,
        )
        .run(decisionId, tapasOptionId, member.id, 'Tapas works for me.');

      const status = parseToolResult(
        await h.client.callTool({
          name: 'get_group_decision_status',
          arguments: { tripId: trip.id, decisionId },
        }),
      ) as any;

      expect(status.decision.response_count).toBe(1);
      expect(status.decision.pending_response_count).toBe(1);
      expect(status.decision.responses).toEqual([
        expect.objectContaining({
          user_id: member.id,
          username: member.username,
          response: 'selected',
          option_id: tapasOptionId,
          option_label: 'Tapas',
          comment: 'Tapas works for me.',
        }),
      ]);
      expect(status.decision.options[1].counts.selected).toBe(1);
    });
  });

  it('lists only unresolved decisions for blockers', async () => {
    const { user } = createUser(testDb);
    const trip = createTrip(testDb, user.id);

    await withHarness(user.id, async (h) => {
      const open = parseToolResult(
        await h.client.callTool({
          name: 'create_group_decision',
          arguments: { tripId: trip.id, title: 'Open decision', options: ['A', 'B'] },
        }),
      ) as any;
      const decided = parseToolResult(
        await h.client.callTool({
          name: 'create_group_decision',
          arguments: { tripId: trip.id, title: 'Decided decision', options: ['C', 'D'] },
        }),
      ) as any;

      await h.client.callTool({
        name: 'finalize_group_decision',
        arguments: {
          tripId: trip.id,
          decisionId: decided.decision.id,
          optionId: decided.decision.options[0].id,
        },
      });

      const unresolved = parseToolResult(
        await h.client.callTool({ name: 'list_unresolved_group_decisions', arguments: { tripId: trip.id } }),
      ) as any;

      expect(unresolved.unresolved_count).toBe(1);
      expect(unresolved.decisions.map((decision: any) => decision.id)).toEqual([open.decision.id]);
      expect(unresolved.decisions[0].next_step).toContain('Waiting');
    });
  });
});

describe('close_group_decision and finalize_group_decision', () => {
  it('closes a decision and then finalizes it when the owner chooses an option', async () => {
    const { user } = createUser(testDb);
    const trip = createTrip(testDb, user.id);

    await withHarness(user.id, async (h) => {
      const created = parseToolResult(
        await h.client.callTool({
          name: 'create_group_decision',
          arguments: { tripId: trip.id, title: 'Hotel choice', options: ['Station', 'Old town'] },
        }),
      ) as any;

      const closed = parseToolResult(
        await h.client.callTool({
          name: 'close_group_decision',
          arguments: { tripId: trip.id, decisionId: created.decision.id },
        }),
      ) as any;
      expect(closed.decision.state).toBe('closed');
      expect(closed.decision.next_step).toContain('choose a final option');

      const finalized = parseToolResult(
        await h.client.callTool({
          name: 'finalize_group_decision',
          arguments: {
            tripId: trip.id,
            decisionId: created.decision.id,
            optionId: created.decision.options[1].id,
          },
        }),
      ) as any;

      expect(finalized.decision.state).toBe('decided');
      expect(finalized.decision.final_option).toEqual({ id: created.decision.options[1].id, label: 'Old town' });
      expect(finalized.decision.unresolved).toBe(false);
      expect(broadcastMock).toHaveBeenCalledWith(trip.id, 'decision:updated', expect.any(Object));
    });
  });

  it('requires trip edit permission to finalize a member-accessible decision', async () => {
    const { user: owner } = createUser(testDb);
    const { user: member } = createUser(testDb);
    const trip = createTrip(testDb, owner.id);
    addTripMember(testDb, trip.id, member.id);

    const decisionId = Number(
      testDb
        .prepare(
          `INSERT INTO group_decisions (trip_id, created_by, title, state)
           VALUES (?, ?, 'Owner decision', 'open')`,
        )
        .run(trip.id, owner.id).lastInsertRowid,
    );
    const optionId = Number(
      testDb
        .prepare('INSERT INTO group_decision_options (decision_id, label, sort_order) VALUES (?, ?, 0)')
        .run(decisionId, 'A').lastInsertRowid,
    );
    testDb
      .prepare('INSERT INTO group_decision_options (decision_id, label, sort_order) VALUES (?, ?, 1)')
      .run(decisionId, 'B');

    await withHarness(member.id, async (h) => {
      const denied = await h.client.callTool({
        name: 'finalize_group_decision',
        arguments: { tripId: trip.id, decisionId, optionId },
      });
      expect(denied.isError).toBe(true);
      const stillOpen = testDb.prepare('SELECT state FROM group_decisions WHERE id = ?').get(decisionId) as {
        state: string;
      };
      expect(stillOpen.state).toBe('open');
    });
  });
});
