/**
 * Unit tests for MCP booking-intent tools:
 * create_booking_intent, list_booking_intents, update_booking_intent,
 * start_booking_price_watch, list_ranked_booking_options,
 * prepare_booking_checkout_handoff.
 */
import { runMigrations } from '../../../src/db/migrations';
import { createTables } from '../../../src/db/schema';
import { SCOPE_INFO } from '../../../src/mcp/scopes';
import { invalidatePermissionsCache } from '../../../src/services/permissions';
import { addTripMember, createTrip, createUser } from '../../helpers/factories';
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

function textResult(result: Awaited<ReturnType<McpHarness['client']['callTool']>>): string {
  const text = result.content.find((item: any) => item.type === 'text') as { text: string } | undefined;
  return text?.text ?? '';
}

function seedIntent(
  tripId: number,
  userId: number,
  overrides: Partial<{
    type: string;
    origin: string | null;
    destination: string | null;
    status: string;
  }> = {},
): number {
  return Number(
    testDb
      .prepare(
        `
        INSERT INTO booking_intents
          (trip_id, created_by, type, origin, destination, status, dates, party_constraints, budget, preferences)
        VALUES (?, ?, ?, ?, ?, ?, '{}', '{}', '{}', '{}')
      `,
      )
      .run(
        tripId,
        userId,
        overrides.type ?? 'flight',
        overrides.origin ?? 'SIN',
        overrides.destination ?? 'HND',
        overrides.status ?? 'draft',
      ).lastInsertRowid,
  );
}

function seedOption(
  intentId: number,
  overrides: Partial<{
    provider: string;
    externalId: string;
    title: string;
    price: number;
    currency: string;
    score: number;
    checkoutUrl: string;
    status: string;
    expiresAt: string;
  }> = {},
): number {
  return Number(
    testDb
      .prepare(
        `
        INSERT INTO booking_options
          (booking_intent_id, provider, external_id, title, price, currency, score, expires_at, checkout_url, status, metadata)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '{}')
      `,
      )
      .run(
        intentId,
        overrides.provider ?? 'mock-travel',
        overrides.externalId ?? `option-${intentId}-${Math.random().toString(36).slice(2)}`,
        overrides.title ?? 'Flexible Flight',
        overrides.price ?? 420,
        overrides.currency ?? 'USD',
        overrides.score ?? 0.8,
        overrides.expiresAt ?? '2999-01-01T00:00:00.000Z',
        overrides.checkoutUrl ?? 'https://provider.example/checkout/flexible-flight',
        overrides.status ?? 'current',
      ).lastInsertRowid,
  );
}

function seedApprovedDecision(tripId: number, userId: number, intentId: number, optionId: number): number {
  const decisionId = Number(
    testDb
      .prepare(
        `INSERT INTO group_decisions (trip_id, created_by, title, state)
         VALUES (?, ?, 'Approve booking option', 'decided')`,
      )
      .run(tripId, userId).lastInsertRowid,
  );
  testDb
    .prepare('INSERT INTO group_decision_links (decision_id, target_type, target_id) VALUES (?, ?, ?)')
    .run(decisionId, 'booking_intent', intentId);
  const groupOptionId = Number(
    testDb
      .prepare(
        `INSERT INTO group_decision_options (decision_id, label, sort_order, booking_option_id)
         VALUES (?, 'Flexible Flight', 0, ?)`,
      )
      .run(decisionId, optionId).lastInsertRowid,
  );
  testDb.prepare('UPDATE group_decisions SET final_option_id = ? WHERE id = ?').run(groupOptionId, decisionId);
  return decisionId;
}

describe('booking intent MCP registration and scopes', () => {
  it('registers read tools with reservations:read and write tools only with reservations:write', async () => {
    const { user } = createUser(testDb);

    await withHarness(
      user.id,
      async (h) => {
        const tools = (await h.client.listTools()).tools;
        const names = tools.map((tool) => tool.name);
        expect(names).toContain('list_booking_intents');
        expect(names).toContain('list_ranked_booking_options');
        expect(names).not.toContain('create_booking_intent');
        expect(names).not.toContain('start_booking_price_watch');
        expect(names).not.toContain('prepare_booking_checkout_handoff');
      },
      ['reservations:read'],
    );

    await withHarness(
      user.id,
      async (h) => {
        const tools = (await h.client.listTools()).tools;
        const names = tools.map((tool) => tool.name);
        expect(names).toEqual(
          expect.arrayContaining([
            'create_booking_intent',
            'list_booking_intents',
            'update_booking_intent',
            'start_booking_price_watch',
            'list_ranked_booking_options',
            'prepare_booking_checkout_handoff',
          ]),
        );
        const checkout = tools.find((tool) => tool.name === 'prepare_booking_checkout_handoff');
        expect(checkout?.description).toMatch(/does not purchase travel/i);
      },
      ['reservations:write'],
    );

    expect(SCOPE_INFO['reservations:read'].description).toMatch(/booking intents/i);
    expect(SCOPE_INFO['reservations:write'].description).toMatch(/does not let Trippi purchase travel/i);
  });
});

describe('booking intent MCP CRUD and access checks', () => {
  it('creates, lists, updates, and archives booking intents with summaries', async () => {
    const { user } = createUser(testDb);
    const trip = createTrip(testDb, user.id);

    await withHarness(user.id, async (h) => {
      const created = parseToolResult(
        await h.client.callTool({
          name: 'create_booking_intent',
          arguments: {
            tripId: trip.id,
            type: 'flight',
            origin: 'SIN',
            destination: 'HND',
            dates: { depart_after: '2026-10-01', return_before: '2026-10-08' },
            budget: { max: 900, currency: 'USD' },
            preferences: { nonstop: true },
          },
        }),
      ) as any;

      expect(created.booking_intent).toMatchObject({
        type: 'flight',
        route: { origin: 'SIN', destination: 'HND', label: 'SIN to HND' },
        status: 'draft',
        summary: expect.stringContaining('booking intent'),
      });
      expect(created.booking_intent.next_step).toContain('Ready');
      expect(broadcastMock).toHaveBeenCalledWith(trip.id, 'booking-intent:created', expect.any(Object));

      const listed = parseToolResult(
        await h.client.callTool({ name: 'list_booking_intents', arguments: { tripId: trip.id } }),
      ) as any;
      expect(listed.count).toBe(1);
      expect(listed.booking_intents[0].id).toBe(created.booking_intent.id);

      const updated = parseToolResult(
        await h.client.callTool({
          name: 'update_booking_intent',
          arguments: {
            tripId: trip.id,
            bookingIntentId: created.booking_intent.id,
            destination: 'NRT',
            status: 'options_ready',
          },
        }),
      ) as any;
      expect(updated.booking_intent).toMatchObject({
        id: created.booking_intent.id,
        route: { destination: 'NRT', label: 'SIN to NRT' },
        status: 'options_ready',
      });

      const deniedArchive = await h.client.callTool({
        name: 'update_booking_intent',
        arguments: { tripId: trip.id, bookingIntentId: created.booking_intent.id, status: 'archived' },
      });
      expect(deniedArchive.isError).toBe(true);
      expect(textResult(deniedArchive)).toContain('confirm_archive');

      const archived = parseToolResult(
        await h.client.callTool({
          name: 'update_booking_intent',
          arguments: {
            tripId: trip.id,
            bookingIntentId: created.booking_intent.id,
            status: 'archived',
            confirm_archive: true,
          },
        }),
      ) as any;
      expect(archived.booking_intent.status).toBe('archived');
      expect(broadcastMock).toHaveBeenCalledWith(trip.id, 'booking-intent:archived', expect.any(Object));
    });
  });

  it('enforces trip access and reservation_edit permission', async () => {
    const { user: owner } = createUser(testDb);
    const { user: member } = createUser(testDb);
    const { user: stranger } = createUser(testDb);
    const trip = createTrip(testDb, owner.id);
    addTripMember(testDb, trip.id, member.id);
    testDb
      .prepare("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('perm_reservation_edit', 'trip_owner')")
      .run();
    invalidatePermissionsCache();

    await withHarness(stranger.id, async (h) => {
      const result = await h.client.callTool({ name: 'list_booking_intents', arguments: { tripId: trip.id } });
      expect(result.isError).toBe(true);
      expect(textResult(result)).toContain('access denied');
    });

    await withHarness(member.id, async (h) => {
      const result = await h.client.callTool({
        name: 'create_booking_intent',
        arguments: { tripId: trip.id, type: 'hotel', destination: 'Tokyo' },
      });
      expect(result.isError).toBe(true);
      expect(textResult(result)).toContain('permission');
    });
  });
});

describe('booking price watch and ranked options MCP tools', () => {
  it('starts a price watch and lists ranked options for the intent', async () => {
    const { user } = createUser(testDb);
    const trip = createTrip(testDb, user.id);
    const intentId = seedIntent(trip.id, user.id, { status: 'draft' });

    await withHarness(user.id, async (h) => {
      const watch = parseToolResult(
        await h.client.callTool({
          name: 'start_booking_price_watch',
          arguments: { tripId: trip.id, bookingIntentId: intentId },
        }),
      ) as any;
      expect(watch.booking_intent).toMatchObject({
        id: intentId,
        status: 'watching',
        watch_status: 'queued',
      });
      expect(watch.agent_job).toMatchObject({ status: 'queued', provider: 'mock-travel' });
      expect(watch.summary).toContain('Price watch queued');
      expect(broadcastMock).toHaveBeenCalledWith(trip.id, 'booking-intent:watch-started', expect.any(Object));

      const lowerScore = seedOption(intentId, {
        externalId: 'lower-score',
        title: 'Cheaper but lower score',
        price: 300,
        score: 0.7,
      });
      const best = seedOption(intentId, {
        externalId: 'best-score',
        title: 'Best ranked flight',
        price: 420,
        score: 0.92,
      });
      seedOption(intentId, {
        externalId: 'expired',
        title: 'Expired fare',
        price: 250,
        score: 0.99,
        status: 'expired',
      });

      const ranked = parseToolResult(
        await h.client.callTool({
          name: 'list_ranked_booking_options',
          arguments: { tripId: trip.id, bookingIntentId: intentId, status: 'current' },
        }),
      ) as any;
      expect(ranked.count).toBe(2);
      expect(ranked.best_option).toMatchObject({
        id: best,
        rank: 1,
        title: 'Best ranked flight',
        has_checkout_handoff: true,
      });
      expect(ranked.booking_options.map((option: any) => option.id)).toEqual([best, lowerScore]);
      expect(ranked.booking_options[0].summary).toContain('#1');
    });
  });
});

describe('booking checkout handoff MCP tool', () => {
  it('prepares a provider handoff for an approved option without marking the intent booked', async () => {
    const { user } = createUser(testDb);
    const trip = createTrip(testDb, user.id);
    const intentId = seedIntent(trip.id, user.id, { status: 'approved' });
    const optionId = seedOption(intentId, {
      externalId: 'flight-flex',
      checkoutUrl: 'https://provider.example/checkout/flight-flex',
      title: 'Flexible Flight',
      score: 0.9,
    });
    seedApprovedDecision(trip.id, user.id, intentId, optionId);

    await withHarness(user.id, async (h) => {
      const result = parseToolResult(
        await h.client.callTool({
          name: 'prepare_booking_checkout_handoff',
          arguments: { tripId: trip.id, bookingIntentId: intentId },
        }),
      ) as any;

      expect(result.booking_intent).toMatchObject({
        id: intentId,
        status: 'pending_checkout',
        checkout: {
          option_id: optionId,
          provider: 'mock-travel',
          checkout_url: 'https://provider.example/checkout/flight-flex',
        },
      });
      expect(result.handoff).toMatchObject({
        provider: 'mock-travel',
        option_id: optionId,
        checkout_url: 'https://provider.example/checkout/flight-flex',
      });
      expect(result.handoff.summary).toMatch(/did not book or charge/i);
      expect(broadcastMock).toHaveBeenCalledWith(trip.id, 'booking-intent:checkout-started', expect.any(Object));

      const row = testDb.prepare('SELECT status, booked_at FROM booking_intents WHERE id = ?').get(intentId) as {
        status: string;
        booked_at: string | null;
      };
      expect(row).toEqual({ status: 'pending_checkout', booked_at: null });
    });
  });
});
