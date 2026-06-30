import { runMigrations } from '../../../src/db/migrations';
import { createTables } from '../../../src/db/schema';
import {
  checkActiveTripCapacity,
  checkMcpTokenCapacity,
  checkTripGroupCapacity,
  getEntitlementPlanDefinitions,
  getEntitlementsForUser,
} from '../../../src/services/entitlementService';
import { upsertStripeSubscriptionState } from '../../../src/services/subscriptionService';
import { createTrip, createUser, addTripMember } from '../../helpers/factories';
import { resetTestDb } from '../../helpers/test-db';

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const { testDb, dbMock } = vi.hoisted(() => {
  const Database = require('better-sqlite3');
  const db = new Database(':memory:');
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA busy_timeout = 5000');
  return {
    testDb: db,
    dbMock: {
      db,
      closeDb: () => {},
      reinitialize: () => {},
      getPlaceWithTags: () => null,
      canAccessTrip: () => null,
      isOwner: () => false,
    },
  };
});

vi.mock('../../../src/db/database', () => dbMock);
vi.mock('../../../src/config', () => ({
  JWT_SECRET: 'test-secret',
  ENCRYPTION_KEY: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6a7b8c9d0e1f2a3b4c5d6a7b8c9d0e1f2',
  updateJwtSecret: () => {},
}));

const ENV_KEYS = [
  'TRIPPI_ENTITLEMENT_PLANS',
  'TRIPPI_PLAN_ENTITLEMENTS',
  'TRIPPI_ENTITLEMENTS_FREE_ACTIVE_TRIPS',
  'TRIPPI_ENTITLEMENTS_FREE_GROUP_SIZE',
  'TRIPPI_ENTITLEMENTS_FREE_MCP_TOKENS',
  'TRIPPI_ENTITLEMENTS_FREE_MCP_SESSIONS',
  'TRIPPI_ENTITLEMENTS_FREE_MCP_REQUESTS_PER_MINUTE',
];

const originalEnv = new Map<string, string | undefined>();

beforeAll(() => {
  for (const key of ENV_KEYS) originalEnv.set(key, process.env[key]);
  createTables(testDb);
  runMigrations(testDb);
});

beforeEach(() => {
  resetTestDb(testDb);
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    const original = originalEnv.get(key);
    if (original === undefined) delete process.env[key];
    else process.env[key] = original;
  }
});

afterAll(() => {
  testDb.close();
});

describe('entitlementService', () => {
  it('defines every entitlement dimension for the built-in plans', () => {
    const plans = getEntitlementPlanDefinitions();

    for (const plan of ['free', 'trial', 'pro', 'agency']) {
      expect(plans[plan]).toHaveProperty('aiWorkers');
      expect(plans[plan]).toHaveProperty('priceWatches');
      expect(plans[plan]).toHaveProperty('activeTrips');
      expect(plans[plan]).toHaveProperty('groupSize');
      expect(plans[plan].mcpAutomation).toHaveProperty('maxTokens');
      expect(plans[plan].mcpAutomation).toHaveProperty('maxConcurrentSessions');
      expect(plans[plan].mcpAutomation).toHaveProperty('requestsPerMinute');
    }

    expect(plans.free).toMatchObject({
      activeTrips: 5,
      groupSize: 1,
      mcpAutomation: { maxTokens: 0, maxConcurrentSessions: 0, requestsPerMinute: 0 },
    });
    expect(plans.trial).toMatchObject({
      activeTrips: 100,
      groupSize: null,
      mcpAutomation: { maxTokens: 0, maxConcurrentSessions: 0, requestsPerMinute: 0 },
    });
    expect(plans.pro).toMatchObject({
      activeTrips: 100,
      groupSize: null,
      mcpAutomation: { maxTokens: 0, maxConcurrentSessions: 0, requestsPerMinute: 0 },
    });
    expect(plans.agency).toMatchObject({
      activeTrips: null,
      groupSize: null,
      mcpAutomation: { maxTokens: null, maxConcurrentSessions: null, requestsPerMinute: null },
    });
  });

  it('resolves free entitlements when the user has no billing subscription', async () => {
    const { user } = createUser(testDb);

    await expect(getEntitlementsForUser(user.id)).resolves.toMatchObject({
      userId: user.id,
      planKey: 'free',
      billingStatus: 'free',
      billingPlanKey: 'free',
      subscribed: false,
      trialing: false,
    });
  });

  it.each([
    ['active subscribed pro', 'active', 'pro', 'pro', true, false],
    ['active subscribed agency', 'active', 'agency', 'agency', true, false],
    ['trialing subscription', 'trialing', 'pro', 'trial', false, true],
    ['canceled subscription', 'canceled', 'pro', 'free', false, false],
    ['unpaid subscription', 'unpaid', 'agency', 'free', false, false],
  ])('resolves %s state', async (_label, status, billingPlan, expectedPlan, subscribed, trialing) => {
    const { user } = createUser(testDb);
    await upsertStripeSubscriptionState({
      userId: user.id,
      stripeCustomerId: `cus_${status}_${billingPlan}_${user.id}`,
      stripeSubscriptionId: `sub_${status}_${billingPlan}_${user.id}`,
      status,
      planKey: billingPlan,
    });

    await expect(getEntitlementsForUser(user.id)).resolves.toMatchObject({
      planKey: expectedPlan,
      billingStatus: status,
      billingPlanKey: billingPlan,
      subscribed,
      trialing,
    });
  });

  it('accepts JSON and env overrides without schema changes', async () => {
    process.env.TRIPPI_ENTITLEMENT_PLANS = JSON.stringify({
      plus: {
        aiWorkers: 2,
        priceWatches: 12,
        activeTrips: 8,
        groupSize: 4,
        mcpAutomation: { maxTokens: 6, maxConcurrentSessions: 7, requestsPerMinute: 80 },
      },
    });
    process.env.TRIPPI_ENTITLEMENTS_FREE_ACTIVE_TRIPS = '1';
    process.env.TRIPPI_ENTITLEMENTS_FREE_MCP_SESSIONS = '9';

    const { user } = createUser(testDb);
    await upsertStripeSubscriptionState({
      userId: user.id,
      stripeCustomerId: 'cus_plus',
      stripeSubscriptionId: 'sub_plus',
      status: 'active',
      planKey: 'plus',
    });

    await expect(getEntitlementsForUser(user.id)).resolves.toMatchObject({
      planKey: 'plus',
      limits: {
        aiWorkers: 2,
        priceWatches: 12,
        activeTrips: 8,
        groupSize: 4,
        mcpAutomation: { maxTokens: 6, maxConcurrentSessions: 7, requestsPerMinute: 80 },
      },
    });
    expect(getEntitlementPlanDefinitions().free).toMatchObject({
      activeTrips: 1,
      mcpAutomation: expect.objectContaining({ maxConcurrentSessions: 9 }),
    });
  });

  it('checks trip capacity against all lifetime owned trips', async () => {
    process.env.TRIPPI_ENTITLEMENTS_FREE_ACTIVE_TRIPS = '1';
    const { user } = createUser(testDb);
    createTrip(testDb, user.id, { title: 'Current' });
    const archived = createTrip(testDb, user.id, { title: 'Archived' });
    testDb.prepare('UPDATE trips SET is_archived = 1 WHERE id = ?').run(archived.id);

    await expect(checkActiveTripCapacity(user.id)).resolves.toMatchObject({
      allowed: false,
      feature: 'activeTrips',
      current: 2,
      limit: 1,
    });
  });

  it('checks group size capacity as owner plus collaborators', async () => {
    process.env.TRIPPI_ENTITLEMENTS_FREE_GROUP_SIZE = '2';
    const { user: owner } = createUser(testDb);
    const { user: member } = createUser(testDb);
    const trip = createTrip(testDb, owner.id);
    addTripMember(testDb, trip.id, member.id);

    await expect(checkTripGroupCapacity(owner.id, trip.id)).resolves.toMatchObject({
      allowed: false,
      feature: 'groupSize',
      current: 2,
      limit: 2,
    });
  });

  it('checks MCP token capacity from the same entitlement definitions', async () => {
    process.env.TRIPPI_ENTITLEMENTS_FREE_MCP_TOKENS = '1';
    const { user } = createUser(testDb);
    testDb
      .prepare('INSERT INTO mcp_tokens (user_id, name, token_hash, token_prefix) VALUES (?, ?, ?, ?)')
      .run(user.id, 'Existing', 'hash_existing', 'trippi_exist');

    await expect(checkMcpTokenCapacity(user.id)).resolves.toMatchObject({
      allowed: false,
      feature: 'mcpTokens',
      current: 1,
      limit: 1,
    });
  });
});
