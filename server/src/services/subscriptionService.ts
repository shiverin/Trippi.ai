import { asyncDb } from '../db/asyncDatabase';

export const STRIPE_SUBSCRIPTION_STATUSES = [
  'incomplete',
  'incomplete_expired',
  'trialing',
  'active',
  'past_due',
  'canceled',
  'unpaid',
  'paused',
] as const;

export type StripeSubscriptionStatus = (typeof STRIPE_SUBSCRIPTION_STATUSES)[number];
export type BillingPlanKey = 'free' | 'trial' | 'pro' | 'agency' | string;

export interface BillingCustomer {
  id: number;
  user_id: number;
  stripe_customer_id: string;
  created_at: string;
  updated_at: string;
}

export interface BillingSubscription {
  id: number;
  user_id: number;
  billing_customer_id: number;
  stripe_customer_id: string;
  stripe_subscription_id: string;
  status: StripeSubscriptionStatus | string;
  plan_key: BillingPlanKey;
  stripe_price_id: string | null;
  current_period_start: string | null;
  current_period_end: string | null;
  trial_start: string | null;
  trial_end: string | null;
  cancel_at_period_end: 0 | 1;
  canceled_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface BillingSubscriptionState extends BillingSubscription {
  customer: BillingCustomer;
}

export interface UpsertStripeSubscriptionInput {
  userId: number;
  stripeCustomerId: string;
  stripeSubscriptionId: string;
  status: StripeSubscriptionStatus | string;
  planKey: BillingPlanKey;
  stripePriceId?: string | null;
  currentPeriodStart?: string | Date | null;
  currentPeriodEnd?: string | Date | null;
  trialStart?: string | Date | null;
  trialEnd?: string | Date | null;
  cancelAtPeriodEnd?: boolean;
  canceledAt?: string | Date | null;
}

export interface FreeBillingState {
  user_id: number;
  status: 'free';
  plan_key: 'free';
  stripe_customer_id: null;
  stripe_subscription_id: null;
  stripe_price_id: null;
  current_period_start: null;
  current_period_end: null;
  trial_start: null;
  trial_end: null;
  cancel_at_period_end: 0;
  canceled_at: null;
}

function isoOrNull(value: string | Date | null | undefined): string | null {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : value;
}

async function getBillingCustomerByUserId(userId: number): Promise<BillingCustomer | undefined> {
  return asyncDb.prepare('SELECT * FROM billing_customers WHERE user_id = ?').get<BillingCustomer>(userId);
}

async function upsertBillingCustomer(userId: number, stripeCustomerId: string): Promise<BillingCustomer> {
  await asyncDb
    .prepare(
      `
      INSERT INTO billing_customers (user_id, stripe_customer_id, updated_at)
      VALUES (?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(user_id) DO UPDATE SET
        stripe_customer_id = excluded.stripe_customer_id,
        updated_at = CURRENT_TIMESTAMP
    `,
    )
    .run(userId, stripeCustomerId);

  const customer = await getBillingCustomerByUserId(userId);
  if (!customer) throw new Error('Failed to persist billing customer.');
  return customer;
}

export function freeBillingState(userId: number): FreeBillingState {
  return {
    user_id: userId,
    status: 'free',
    plan_key: 'free',
    stripe_customer_id: null,
    stripe_subscription_id: null,
    stripe_price_id: null,
    current_period_start: null,
    current_period_end: null,
    trial_start: null,
    trial_end: null,
    cancel_at_period_end: 0,
    canceled_at: null,
  };
}

export async function getBillingSubscriptionForUser(
  userId: number,
): Promise<BillingSubscriptionState | FreeBillingState> {
  const row = await asyncDb
    .prepare(
      `
      SELECT
        s.*,
        c.id AS customer_id,
        c.user_id AS customer_user_id,
        c.stripe_customer_id AS customer_stripe_customer_id,
        c.created_at AS customer_created_at,
        c.updated_at AS customer_updated_at
      FROM billing_subscriptions s
      JOIN billing_customers c ON c.id = s.billing_customer_id
      WHERE s.user_id = ?
      ORDER BY
        CASE
          WHEN s.status IN ('active', 'trialing') THEN 0
          WHEN s.status IN ('past_due', 'unpaid') THEN 1
          ELSE 2
        END,
        s.updated_at DESC,
        s.id DESC
      LIMIT 1
    `,
    )
    .get<
      BillingSubscription & {
        customer_id: number;
        customer_user_id: number;
        customer_stripe_customer_id: string;
        customer_created_at: string;
        customer_updated_at: string;
      }
    >(userId);

  if (!row) return freeBillingState(userId);

  const {
    customer_id,
    customer_user_id,
    customer_stripe_customer_id,
    customer_created_at,
    customer_updated_at,
    ...subscription
  } = row;

  return {
    ...subscription,
    customer: {
      id: customer_id,
      user_id: customer_user_id,
      stripe_customer_id: customer_stripe_customer_id,
      created_at: customer_created_at,
      updated_at: customer_updated_at,
    },
  };
}

export async function getBillingSubscriptionByStripeId(
  stripeSubscriptionId: string,
): Promise<BillingSubscription | undefined> {
  return asyncDb
    .prepare('SELECT * FROM billing_subscriptions WHERE stripe_subscription_id = ?')
    .get<BillingSubscription>(stripeSubscriptionId);
}

export async function upsertStripeSubscriptionState(
  input: UpsertStripeSubscriptionInput,
): Promise<BillingSubscriptionState> {
  return asyncDb.transaction(async () => {
    const customer = await upsertBillingCustomer(input.userId, input.stripeCustomerId);

    await asyncDb
      .prepare(
        `
        INSERT INTO billing_subscriptions (
          user_id,
          billing_customer_id,
          stripe_customer_id,
          stripe_subscription_id,
          status,
          plan_key,
          stripe_price_id,
          current_period_start,
          current_period_end,
          trial_start,
          trial_end,
          cancel_at_period_end,
          canceled_at,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(stripe_subscription_id) DO UPDATE SET
          user_id = excluded.user_id,
          billing_customer_id = excluded.billing_customer_id,
          stripe_customer_id = excluded.stripe_customer_id,
          status = excluded.status,
          plan_key = excluded.plan_key,
          stripe_price_id = excluded.stripe_price_id,
          current_period_start = excluded.current_period_start,
          current_period_end = excluded.current_period_end,
          trial_start = excluded.trial_start,
          trial_end = excluded.trial_end,
          cancel_at_period_end = excluded.cancel_at_period_end,
          canceled_at = excluded.canceled_at,
          updated_at = CURRENT_TIMESTAMP
      `,
      )
      .run(
        input.userId,
        customer.id,
        input.stripeCustomerId,
        input.stripeSubscriptionId,
        input.status,
        input.planKey,
        input.stripePriceId ?? null,
        isoOrNull(input.currentPeriodStart),
        isoOrNull(input.currentPeriodEnd),
        isoOrNull(input.trialStart),
        isoOrNull(input.trialEnd),
        input.cancelAtPeriodEnd ? 1 : 0,
        isoOrNull(input.canceledAt),
      );

    const state = await getBillingSubscriptionForUser(input.userId);
    if ('customer' in state) return state;
    throw new Error('Failed to persist billing subscription.');
  })();
}
