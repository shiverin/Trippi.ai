import { BillingError, BillingService } from '../../../src/nest/billing/billing.service';
import type { StripeClient } from '../../../src/nest/billing/stripe-client';
import { StripeRequestError } from '../../../src/nest/billing/stripe-client';
import type { BillingCustomer } from '../../../src/services/subscriptionService';
import type { User } from '../../../src/types';

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getBillingCustomerForUserMock, getBillingSubscriptionForUserMock, getEntitlementsForUserMock, getOwnedTripUsageForUserMock } = vi.hoisted(() => ({
  getBillingCustomerForUserMock: vi.fn(),
  getBillingSubscriptionForUserMock: vi.fn(),
  getEntitlementsForUserMock: vi.fn(),
  getOwnedTripUsageForUserMock: vi.fn(),
}));

vi.mock('../../../src/services/subscriptionService', () => ({
  getBillingCustomerForUser: getBillingCustomerForUserMock,
  getBillingSubscriptionForUser: getBillingSubscriptionForUserMock,
}));
vi.mock('../../../src/services/entitlementService', () => ({
  getEntitlementsForUser: getEntitlementsForUserMock,
  getOwnedTripUsageForUser: getOwnedTripUsageForUserMock,
}));

const user = { id: 7, email: 'organizer@example.test', role: 'user' } as User;

async function withEnv<T>(env: NodeJS.ProcessEnv, fn: () => T | Promise<T>): Promise<T> {
  const original = { ...process.env };
  process.env = { ...original, ...env };
  try {
    return await fn();
  } finally {
    process.env = original;
  }
}

function service(stripe: Partial<StripeClient>): BillingService {
  return new BillingService(stripe as StripeClient);
}

async function billingError(fn: () => Promise<unknown>): Promise<{ status: number; message: string }> {
  try {
    await fn();
  } catch (err) {
    expect(err).toBeInstanceOf(BillingError);
    const billing = err as BillingError;
    return { status: billing.status, message: billing.message };
  }
  throw new Error('expected BillingError');
}

describe('BillingService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getBillingCustomerForUserMock.mockResolvedValue(undefined);
    getBillingSubscriptionForUserMock.mockResolvedValue({
      user_id: user.id,
      status: 'free',
      plan_key: 'free',
      current_period_end: null,
      trial_end: null,
      cancel_at_period_end: 0,
    });
    getEntitlementsForUserMock.mockResolvedValue({
      userId: user.id,
      planKey: 'free',
      billingPlanKey: 'free',
      billingStatus: 'free',
      subscribed: false,
      trialing: false,
      limits: {
        aiWorkers: 0,
        priceWatches: 0,
        mcpAutomation: { maxTokens: 0, maxConcurrentSessions: 0, requestsPerMinute: 0 },
        activeTrips: 5,
        groupSize: 1,
      },
      referralBonus: {
        active: false,
        activeUntil: null,
        pendingDays: 0,
        daysRemaining: 0,
        expiresSoon: false,
        maxDays: 90,
      },
    });
    getOwnedTripUsageForUserMock.mockResolvedValue({
      lifetimeTrips: 3,
      lockedTrips: 0,
      editableFreeTrips: 5,
    });
  });

  it('returns entitlement data with checkout availability derived from billing config', async () => {
    const result = await withEnv(
      {
        APP_URL: 'https://app.example.test',
        STRIPE_SECRET_KEY: 'sk_test_123',
        STRIPE_ORGANIZER_PLANS:
          'agency_annual=price_agency,pro_annual=price_pro_annual,pro_monthly=price_pro_monthly',
      },
      () => service({}).getEntitlements(user),
    );

    expect(getEntitlementsForUserMock).toHaveBeenCalledWith(user.id);
    expect(result).toMatchObject({
      entitlements: { planKey: 'free', limits: { activeTrips: 5, groupSize: 1 } },
      access: { source: 'free', activeUntil: null, daysRemaining: null },
      usage: { lifetimeTrips: { current: 3, limit: 5, locked: 0 }, groupSize: { limit: 1 } },
      billing: { checkoutAvailable: true, defaultPlanId: 'pro_monthly', portalAvailable: false },
    });
    expect(result.billing.plans).toEqual([
      expect.objectContaining({ id: 'pro_monthly', planKey: 'pro', priceLabel: '$1.99' }),
      expect.objectContaining({ id: 'pro_annual', planKey: 'pro', priceLabel: '$9.99' }),
      expect.objectContaining({ id: 'agency_annual', planKey: 'agency', priceLabel: '$49' }),
    ]);
  });

  it('includes paid subscription renewal access details', async () => {
    getEntitlementsForUserMock.mockResolvedValue({
      userId: user.id,
      planKey: 'pro',
      billingPlanKey: 'pro',
      billingStatus: 'active',
      subscribed: true,
      trialing: false,
      limits: {
        aiWorkers: 0,
        priceWatches: 0,
        mcpAutomation: { maxTokens: 0, maxConcurrentSessions: 0, requestsPerMinute: 0 },
        activeTrips: 100,
        groupSize: null,
      },
      referralBonus: {
        active: false,
        activeUntil: null,
        pendingDays: 7,
        daysRemaining: 0,
        expiresSoon: false,
        maxDays: 90,
      },
    });
    getBillingSubscriptionForUserMock.mockResolvedValue({
      user_id: user.id,
      status: 'active',
      plan_key: 'pro',
      current_period_end: '2999-01-01T00:00:00.000Z',
      trial_end: null,
      cancel_at_period_end: 0,
    });
    getOwnedTripUsageForUserMock.mockResolvedValue({ lifetimeTrips: 8, lockedTrips: 0, editableFreeTrips: 5 });

    const result = await withEnv(
      {
        APP_URL: 'https://app.example.test',
        STRIPE_SECRET_KEY: 'sk_test_123',
        STRIPE_ORGANIZER_PLANS: 'pro_monthly=price_pro_monthly',
      },
      () => service({}).getEntitlements(user),
    );

    expect(result.access).toMatchObject({
      source: 'paid_subscription',
      planKey: 'pro',
      activeUntil: '2999-01-01T00:00:00.000Z',
      renews: true,
      cancelAtPeriodEnd: false,
    });
    expect(result.access.daysRemaining).toBeGreaterThan(0);
    expect(result.usage).toMatchObject({
      lifetimeTrips: { current: 8, limit: 100, locked: 0 },
      groupSize: { limit: null },
      referralBonus: { activeDays: 0, pendingDays: 7, maxDays: 90 },
    });
  });

  it('marks cancel-at-period-end paid access as ending instead of renewing', async () => {
    getEntitlementsForUserMock.mockResolvedValue({
      userId: user.id,
      planKey: 'pro',
      billingPlanKey: 'pro',
      billingStatus: 'active',
      subscribed: true,
      trialing: false,
      limits: {
        aiWorkers: 0,
        priceWatches: 0,
        mcpAutomation: { maxTokens: 0, maxConcurrentSessions: 0, requestsPerMinute: 0 },
        activeTrips: 100,
        groupSize: null,
      },
      referralBonus: {
        active: false,
        activeUntil: null,
        pendingDays: 0,
        daysRemaining: 0,
        expiresSoon: false,
        maxDays: 90,
      },
    });
    getBillingSubscriptionForUserMock.mockResolvedValue({
      user_id: user.id,
      status: 'active',
      plan_key: 'pro',
      current_period_end: '2999-02-01T00:00:00.000Z',
      trial_end: null,
      cancel_at_period_end: 1,
    });

    const result = await withEnv(
      {
        APP_URL: 'https://app.example.test',
        STRIPE_SECRET_KEY: 'sk_test_123',
        STRIPE_ORGANIZER_PLANS: 'pro_monthly=price_pro_monthly',
      },
      () => service({}).getEntitlements(user),
    );

    expect(result.access).toMatchObject({
      source: 'paid_subscription',
      activeUntil: '2999-02-01T00:00:00.000Z',
      renews: false,
      cancelAtPeriodEnd: true,
    });
  });

  it('includes trial and referral bonus access details', async () => {
    getEntitlementsForUserMock.mockResolvedValueOnce({
      userId: user.id,
      planKey: 'trial',
      billingPlanKey: 'trial',
      billingStatus: 'trialing',
      subscribed: false,
      trialing: true,
      limits: {
        aiWorkers: 0,
        priceWatches: 0,
        mcpAutomation: { maxTokens: 0, maxConcurrentSessions: 0, requestsPerMinute: 0 },
        activeTrips: 100,
        groupSize: null,
      },
      referralBonus: {
        active: false,
        activeUntil: null,
        pendingDays: 0,
        daysRemaining: 0,
        expiresSoon: false,
        maxDays: 90,
      },
    });
    getBillingSubscriptionForUserMock.mockResolvedValueOnce({
      user_id: user.id,
      status: 'trialing',
      plan_key: 'pro',
      current_period_end: '2999-03-01T00:00:00.000Z',
      trial_end: '2999-02-15T00:00:00.000Z',
      cancel_at_period_end: 0,
    });

    const trial = await withEnv({ STRIPE_ORGANIZER_PLANS: 'pro_monthly=price_pro_monthly' }, () =>
      service({}).getEntitlements(user),
    );
    expect(trial.access).toMatchObject({
      source: 'paid_trial',
      activeUntil: '2999-02-15T00:00:00.000Z',
      renews: false,
    });

    getEntitlementsForUserMock.mockResolvedValueOnce({
      userId: user.id,
      planKey: 'pro',
      billingPlanKey: 'referral_bonus',
      billingStatus: 'referral_bonus',
      subscribed: false,
      trialing: false,
      limits: {
        aiWorkers: 0,
        priceWatches: 0,
        mcpAutomation: { maxTokens: 0, maxConcurrentSessions: 0, requestsPerMinute: 0 },
        activeTrips: 100,
        groupSize: null,
      },
      referralBonus: {
        active: true,
        activeUntil: '2999-04-01T00:00:00.000Z',
        pendingDays: 0,
        daysRemaining: 7,
        expiresSoon: false,
        maxDays: 90,
      },
    });
    getBillingSubscriptionForUserMock.mockResolvedValueOnce({
      user_id: user.id,
      status: 'free',
      plan_key: 'free',
      current_period_end: null,
      trial_end: null,
      cancel_at_period_end: 0,
    });
    const referral = await withEnv({ STRIPE_ORGANIZER_PLANS: 'pro_monthly=price_pro_monthly' }, () =>
      service({}).getEntitlements(user),
    );
    expect(referral.access).toMatchObject({
      source: 'referral_bonus',
      activeUntil: '2999-04-01T00:00:00.000Z',
      renews: false,
    });
    expect(referral.access.daysRemaining).toBeGreaterThan(0);
  });

  it('returns a coming-soon billing state when checkout is not configured', async () => {
    const result = await withEnv(
      {
        APP_URL: 'https://app.example.test',
        STRIPE_SECRET_KEY: '',
        STRIPE_ORGANIZER_PLANS: 'pro=price_pro_monthly',
      },
      () => service({}).getEntitlements(user),
    );

    expect(result.billing).toMatchObject({ checkoutAvailable: false, defaultPlanId: null, portalAvailable: false });
    expect(result.billing.plans).toEqual([expect.objectContaining({ id: 'pro', planKey: 'pro' })]);
  });

  it('creates a hosted subscription checkout session for an allowlisted organizer plan', async () => {
    const createCheckoutSession = vi
      .fn()
      .mockResolvedValue({ id: 'cs_test_123', url: 'https://checkout.stripe.test/cs' });
    const result = await withEnv(
      {
        APP_URL: 'https://app.example.test',
        STRIPE_SECRET_KEY: 'sk_test_123',
        STRIPE_ORGANIZER_PLANS: 'pro_monthly=price_pro_monthly',
      },
      () => service({ createCheckoutSession }).createCheckoutSession(user, { planId: 'pro_monthly' }),
    );

    expect(result).toEqual({ url: 'https://checkout.stripe.test/cs' });
    expect(createCheckoutSession).toHaveBeenCalledTimes(1);
    const params = createCheckoutSession.mock.calls[0][0] as URLSearchParams;
    expect(params.get('mode')).toBe('subscription');
    expect(params.get('line_items[0][price]')).toBe('price_pro_monthly');
    expect(params.get('line_items[0][quantity]')).toBe('1');
    expect(params.get('success_url')).toBe('https://app.example.test/billing/success?session_id={CHECKOUT_SESSION_ID}');
    expect(params.get('cancel_url')).toBe('https://app.example.test/billing');
    expect(params.get('client_reference_id')).toBe('7');
    expect(params.get('metadata[plan_id]')).toBe('pro_monthly');
    expect(params.get('metadata[plan_key]')).toBe('pro');
    expect(params.get('subscription_data[metadata][user_id]')).toBe('7');
    expect(params.get('subscription_data[metadata][plan_id]')).toBe('pro_monthly');
    expect(params.get('subscription_data[metadata][plan_key]')).toBe('pro');
    expect(params.get('customer_email')).toBe('organizer@example.test');
    expect(params.get('customer')).toBeNull();
  });

  it('reuses an existing Stripe customer for checkout', async () => {
    getBillingCustomerForUserMock.mockResolvedValue({
      stripe_customer_id: 'cus_existing',
    } as BillingCustomer);
    const createCheckoutSession = vi
      .fn()
      .mockResolvedValue({ id: 'cs_test_123', url: 'https://checkout.stripe.test/cs' });

    await withEnv(
      {
        APP_URL: 'https://app.example.test',
        STRIPE_SECRET_KEY: 'sk_test_123',
        STRIPE_ORGANIZER_PLANS: 'pro_monthly=price_pro_monthly',
      },
      () => service({ createCheckoutSession }).createCheckoutSession(user, { planId: 'pro_monthly' }),
    );

    const params = createCheckoutSession.mock.calls[0][0] as URLSearchParams;
    expect(params.get('customer')).toBe('cus_existing');
    expect(params.get('customer_email')).toBeNull();
  });

  it('does not call Stripe for unknown plans or unsafe redirect URLs', async () => {
    const createCheckoutSession = vi.fn();
    const env = {
      APP_URL: 'https://app.example.test',
      STRIPE_SECRET_KEY: 'sk_test_123',
      STRIPE_ORGANIZER_PLANS: 'pro_monthly=price_pro_monthly',
    };

    await expect(
      withEnv(env, () =>
        billingError(() => service({ createCheckoutSession }).createCheckoutSession(user, { planId: 'bad' })),
      ),
    ).resolves.toEqual({ status: 400, message: 'Choose a valid billing plan.' });
    await expect(
      withEnv(env, () =>
        billingError(() =>
          service({ createCheckoutSession }).createCheckoutSession(user, {
            planId: 'pro_monthly',
            successUrl: 'https://evil.example.test/success',
          }),
        ),
      ),
    ).resolves.toEqual({ status: 400, message: 'Invalid return URL.' });
    expect(createCheckoutSession).not.toHaveBeenCalled();
  });

  it('returns a friendly checkout error when Stripe rejects the request', async () => {
    const createCheckoutSession = vi.fn().mockRejectedValue(new StripeRequestError('nope', 400));

    await expect(
      withEnv(
        {
          APP_URL: 'https://app.example.test',
          STRIPE_SECRET_KEY: 'sk_test_123',
          STRIPE_ORGANIZER_PLANS: 'pro_monthly=price_pro_monthly',
        },
        () =>
          billingError(() =>
            service({ createCheckoutSession }).createCheckoutSession(user, { planId: 'pro_monthly' }),
          ),
      ),
    ).resolves.toEqual({ status: 502, message: 'Billing is temporarily unavailable. Please try again later.' });
  });

  it('creates a billing portal session for an existing customer', async () => {
    getBillingCustomerForUserMock.mockResolvedValue({
      stripe_customer_id: 'cus_existing',
    } as BillingCustomer);
    const createBillingPortalSession = vi
      .fn()
      .mockResolvedValue({ id: 'bps_test_123', url: 'https://billing.stripe.test/session' });

    const result = await withEnv(
      {
        APP_URL: 'https://app.example.test',
        STRIPE_SECRET_KEY: 'sk_test_123',
        STRIPE_ORGANIZER_PLANS: 'pro=price_pro_monthly',
      },
      () => service({ createBillingPortalSession }).createPortalSession(user, { returnUrl: '/account/billing' }),
    );

    expect(result).toEqual({ url: 'https://billing.stripe.test/session' });
    const params = createBillingPortalSession.mock.calls[0][0] as URLSearchParams;
    expect(params.get('customer')).toBe('cus_existing');
    expect(params.get('return_url')).toBe('https://app.example.test/account/billing');
  });

  it('requires an existing billing customer before creating a portal session', async () => {
    const createBillingPortalSession = vi.fn();

    await expect(
      withEnv(
        {
          APP_URL: 'https://app.example.test',
          STRIPE_SECRET_KEY: 'sk_test_123',
          STRIPE_ORGANIZER_PLANS: 'pro=price_pro_monthly',
        },
        () => billingError(() => service({ createBillingPortalSession }).createPortalSession(user, {})),
      ),
    ).resolves.toEqual({ status: 400, message: 'No billing customer found for this account.' });
    expect(createBillingPortalSession).not.toHaveBeenCalled();
  });

  it('reports a configuration error when Stripe secrets are missing', async () => {
    await expect(
      withEnv(
        {
          APP_URL: 'https://app.example.test',
          STRIPE_SECRET_KEY: '',
          STRIPE_ORGANIZER_PLANS: 'pro_monthly=price_pro_monthly',
        },
        () =>
          billingError(() =>
            service({ createCheckoutSession: vi.fn() }).createCheckoutSession(user, { planId: 'pro_monthly' }),
          ),
      ),
    ).resolves.toEqual({ status: 503, message: 'Billing is not configured.' });
  });
});
