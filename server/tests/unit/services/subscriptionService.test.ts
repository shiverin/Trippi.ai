import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

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

import { createTables } from '../../../src/db/schema';
import { runMigrations } from '../../../src/db/migrations';
import { createUser } from '../../helpers/factories';
import { resetTestDb } from '../../helpers/test-db';
import {
  getBillingSubscriptionByStripeId,
  getBillingSubscriptionForUser,
  upsertStripeSubscriptionState,
} from '../../../src/services/subscriptionService';

beforeAll(() => {
  createTables(testDb);
  runMigrations(testDb);
});

beforeEach(() => {
  resetTestDb(testDb);
});

afterAll(() => {
  testDb.close();
});

describe('subscriptionService', () => {
  it('returns a free state when no Stripe subscription exists', async () => {
    const { user } = createUser(testDb);

    await expect(getBillingSubscriptionForUser(user.id)).resolves.toMatchObject({
      user_id: user.id,
      status: 'free',
      plan_key: 'free',
      stripe_customer_id: null,
      stripe_subscription_id: null,
    });
  });

  it('stores Stripe customer and active subscription state for a user', async () => {
    const { user } = createUser(testDb);

    const state = await upsertStripeSubscriptionState({
      userId: user.id,
      stripeCustomerId: 'cus_123',
      stripeSubscriptionId: 'sub_123',
      status: 'active',
      planKey: 'pro',
      stripePriceId: 'price_pro_monthly',
      currentPeriodStart: new Date('2026-06-01T00:00:00.000Z'),
      currentPeriodEnd: '2026-07-01T00:00:00.000Z',
      trialStart: null,
      trialEnd: null,
      cancelAtPeriodEnd: false,
    });

    expect(state).toMatchObject({
      user_id: user.id,
      stripe_customer_id: 'cus_123',
      stripe_subscription_id: 'sub_123',
      status: 'active',
      plan_key: 'pro',
      stripe_price_id: 'price_pro_monthly',
      current_period_start: '2026-06-01T00:00:00.000Z',
      current_period_end: '2026-07-01T00:00:00.000Z',
      cancel_at_period_end: 0,
      customer: {
        user_id: user.id,
        stripe_customer_id: 'cus_123',
      },
    });
  });

  it('updates repeated webhook-style subscription state idempotently', async () => {
    const { user } = createUser(testDb);

    await upsertStripeSubscriptionState({
      userId: user.id,
      stripeCustomerId: 'cus_repeat',
      stripeSubscriptionId: 'sub_repeat',
      status: 'trialing',
      planKey: 'trial',
      stripePriceId: 'price_trial',
      trialEnd: '2026-07-15T00:00:00.000Z',
    });

    const updated = await upsertStripeSubscriptionState({
      userId: user.id,
      stripeCustomerId: 'cus_repeat',
      stripeSubscriptionId: 'sub_repeat',
      status: 'past_due',
      planKey: 'pro',
      stripePriceId: 'price_pro_monthly',
      currentPeriodEnd: '2026-08-01T00:00:00.000Z',
      cancelAtPeriodEnd: true,
    });

    expect(updated).toMatchObject({
      status: 'past_due',
      plan_key: 'pro',
      stripe_price_id: 'price_pro_monthly',
      current_period_end: '2026-08-01T00:00:00.000Z',
      cancel_at_period_end: 1,
    });

    const count = testDb
      .prepare('SELECT COUNT(*) AS count FROM billing_subscriptions WHERE stripe_subscription_id = ?')
      .get('sub_repeat') as { count: number };
    expect(count.count).toBe(1);
  });

  it('preserves canceled and unpaid states for later entitlement checks', async () => {
    const { user: canceledUser } = createUser(testDb);
    const { user: unpaidUser } = createUser(testDb);

    await upsertStripeSubscriptionState({
      userId: canceledUser.id,
      stripeCustomerId: 'cus_canceled',
      stripeSubscriptionId: 'sub_canceled',
      status: 'canceled',
      planKey: 'pro',
      stripePriceId: 'price_pro_monthly',
      canceledAt: '2026-06-20T00:00:00.000Z',
    });
    await upsertStripeSubscriptionState({
      userId: unpaidUser.id,
      stripeCustomerId: 'cus_unpaid',
      stripeSubscriptionId: 'sub_unpaid',
      status: 'unpaid',
      planKey: 'agency',
      stripePriceId: 'price_agency_monthly',
      currentPeriodEnd: '2026-06-30T00:00:00.000Z',
    });

    await expect(getBillingSubscriptionForUser(canceledUser.id)).resolves.toMatchObject({
      status: 'canceled',
      canceled_at: '2026-06-20T00:00:00.000Z',
    });
    await expect(getBillingSubscriptionForUser(unpaidUser.id)).resolves.toMatchObject({
      status: 'unpaid',
      plan_key: 'agency',
    });
  });

  it('can look up subscription state by Stripe subscription id', async () => {
    const { user } = createUser(testDb);

    await upsertStripeSubscriptionState({
      userId: user.id,
      stripeCustomerId: 'cus_lookup',
      stripeSubscriptionId: 'sub_lookup',
      status: 'active',
      planKey: 'pro',
    });

    await expect(getBillingSubscriptionByStripeId('sub_lookup')).resolves.toMatchObject({
      user_id: user.id,
      stripe_customer_id: 'cus_lookup',
      stripe_subscription_id: 'sub_lookup',
    });
  });
});
