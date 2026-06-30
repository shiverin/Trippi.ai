import { runMigrations } from '../../../src/db/migrations';
import { createTables } from '../../../src/db/schema';
import { StripeWebhookService } from '../../../src/nest/billing/stripe-webhook.service';
import { getBillingSubscriptionForUser, upsertBillingCustomer } from '../../../src/services/subscriptionService';
import { createUser } from '../../helpers/factories';

import type Stripe from 'stripe';
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

function stripeEvent(
  type: string,
  object: Record<string, unknown>,
  id = `evt_${type.replace(/\W/g, '_')}`,
): Stripe.Event {
  return {
    id,
    object: 'event',
    api_version: '2026-02-25.clover',
    created: 1782864000,
    data: { object },
    livemode: false,
    pending_webhooks: 1,
    request: { id: null, idempotency_key: null },
    type,
  } as Stripe.Event;
}

function subscription(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'sub_123',
    object: 'subscription',
    customer: 'cus_123',
    status: 'active',
    metadata: { plan_key: 'pro' },
    items: {
      object: 'list',
      data: [
        {
          id: 'si_123',
          object: 'subscription_item',
          current_period_start: 1780272000,
          current_period_end: 1782864000,
          price: { id: 'price_pro_monthly', object: 'price', lookup_key: 'pro' },
        },
      ],
    },
    trial_start: null,
    trial_end: null,
    cancel_at_period_end: false,
    canceled_at: null,
    ...overrides,
  };
}

beforeAll(() => {
  createTables(testDb);
  runMigrations(testDb);
});

beforeEach(() => {
  testDb.exec(`
    PRAGMA foreign_keys = OFF;
    DELETE FROM billing_webhook_events;
    DELETE FROM billing_subscriptions;
    DELETE FROM billing_customers;
    DELETE FROM users;
    PRAGMA foreign_keys = ON;
  `);
});

afterAll(() => {
  testDb.close();
});

describe('StripeWebhookService', () => {
  it('stores customer.subscription.created state using subscription metadata', async () => {
    const { user } = createUser(testDb);
    const service = new StripeWebhookService();

    await expect(
      service.handleEvent(
        stripeEvent(
          'customer.subscription.created',
          subscription({ metadata: { user_id: String(user.id), plan_key: 'pro' } }),
        ),
      ),
    ).resolves.toEqual({ duplicate: false, handled: true });

    await expect(getBillingSubscriptionForUser(user.id)).resolves.toMatchObject({
      user_id: user.id,
      stripe_customer_id: 'cus_123',
      stripe_subscription_id: 'sub_123',
      status: 'active',
      plan_key: 'pro',
      stripe_price_id: 'price_pro_monthly',
      current_period_start: '2026-06-01T00:00:00.000Z',
      current_period_end: '2026-07-01T00:00:00.000Z',
    });
  });

  it('uses customer events to map later subscription events to a user', async () => {
    const { user } = createUser(testDb);
    const service = new StripeWebhookService();

    await expect(
      service.handleEvent(
        stripeEvent(
          'customer.created',
          {
            id: 'cus_from_customer_event',
            object: 'customer',
            metadata: { trippi_user_id: String(user.id) },
          },
          'evt_customer_created',
        ),
      ),
    ).resolves.toEqual({ duplicate: false, handled: true });
    await service.handleEvent(
      stripeEvent(
        'customer.subscription.created',
        subscription({ customer: 'cus_from_customer_event', metadata: { plan_key: 'pro' } }),
        'evt_subscription_after_customer',
      ),
    );

    await expect(getBillingSubscriptionForUser(user.id)).resolves.toMatchObject({
      stripe_customer_id: 'cus_from_customer_event',
      stripe_subscription_id: 'sub_123',
      status: 'active',
    });
  });

  it('updates an existing subscription on customer.subscription.updated', async () => {
    const { user } = createUser(testDb);
    await upsertBillingCustomer(user.id, 'cus_123');
    const service = new StripeWebhookService();

    await service.handleEvent(stripeEvent('customer.subscription.created', subscription()));
    await service.handleEvent(
      stripeEvent(
        'customer.subscription.updated',
        subscription({
          status: 'trialing',
          metadata: { plan_key: 'trial' },
          trial_start: 1780272000,
          trial_end: 1782864000,
          items: {
            data: [
              {
                current_period_start: 1780272000,
                current_period_end: 1782864000,
                price: { id: 'price_trial', lookup_key: 'trial' },
              },
            ],
          },
        }),
        'evt_updated',
      ),
    );

    await expect(getBillingSubscriptionForUser(user.id)).resolves.toMatchObject({
      status: 'trialing',
      plan_key: 'trial',
      stripe_price_id: 'price_trial',
      trial_start: '2026-06-01T00:00:00.000Z',
      trial_end: '2026-07-01T00:00:00.000Z',
    });
  });

  it('stores canceled and unpaid subscription states', async () => {
    const { user: canceledUser } = createUser(testDb);
    const { user: unpaidUser } = createUser(testDb);
    await upsertBillingCustomer(canceledUser.id, 'cus_canceled');
    await upsertBillingCustomer(unpaidUser.id, 'cus_unpaid');
    const service = new StripeWebhookService();

    await service.handleEvent(
      stripeEvent(
        'customer.subscription.deleted',
        subscription({
          id: 'sub_canceled',
          customer: 'cus_canceled',
          status: 'canceled',
          cancel_at_period_end: true,
          canceled_at: 1780358400,
        }),
        'evt_canceled',
      ),
    );
    await expect(getBillingSubscriptionForUser(canceledUser.id)).resolves.toMatchObject({
      status: 'canceled',
      cancel_at_period_end: 1,
      canceled_at: '2026-06-02T00:00:00.000Z',
    });

    await service.handleEvent(
      stripeEvent(
        'customer.subscription.updated',
        subscription({ id: 'sub_unpaid', customer: 'cus_unpaid', status: 'unpaid' }),
        'evt_unpaid',
      ),
    );
    await expect(getBillingSubscriptionForUser(unpaidUser.id)).resolves.toMatchObject({ status: 'unpaid' });
  });

  it('marks known subscriptions past_due on invoice.payment_failed', async () => {
    const { user } = createUser(testDb);
    await upsertBillingCustomer(user.id, 'cus_123');
    const service = new StripeWebhookService();

    await service.handleEvent(stripeEvent('customer.subscription.created', subscription()));
    await service.handleEvent(
      stripeEvent(
        'invoice.payment_failed',
        {
          id: 'in_failed',
          object: 'invoice',
          customer: 'cus_123',
          parent: { subscription_details: { subscription: 'sub_123' } },
        },
        'evt_invoice_failed',
      ),
    );

    await expect(getBillingSubscriptionForUser(user.id)).resolves.toMatchObject({ status: 'past_due' });
  });

  it('skips repeated Stripe event ids without applying them twice', async () => {
    const { user } = createUser(testDb);
    const service = new StripeWebhookService();
    const event = stripeEvent(
      'customer.subscription.created',
      subscription({ metadata: { user_id: String(user.id), plan_key: 'pro' } }),
      'evt_repeat',
    );

    await expect(service.handleEvent(event)).resolves.toEqual({ duplicate: false, handled: true });
    await expect(service.handleEvent(event)).resolves.toEqual({ duplicate: true, handled: false });

    const subscriptions = testDb
      .prepare('SELECT * FROM billing_subscriptions WHERE stripe_subscription_id = ?')
      .all('sub_123');
    const receipts = testDb.prepare('SELECT * FROM billing_webhook_events WHERE id = ?').all('evt_repeat');
    expect(subscriptions).toHaveLength(1);
    expect(receipts).toHaveLength(1);
  });
});
