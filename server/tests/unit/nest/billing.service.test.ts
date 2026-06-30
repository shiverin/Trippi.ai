import { BillingError, BillingService } from '../../../src/nest/billing/billing.service';
import type { StripeClient } from '../../../src/nest/billing/stripe-client';
import { StripeRequestError } from '../../../src/nest/billing/stripe-client';
import type { BillingCustomer } from '../../../src/services/subscriptionService';
import type { User } from '../../../src/types';

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getBillingCustomerForUserMock, getEntitlementsForUserMock } = vi.hoisted(() => ({
  getBillingCustomerForUserMock: vi.fn(),
  getEntitlementsForUserMock: vi.fn(),
}));

vi.mock('../../../src/services/subscriptionService', () => ({
  getBillingCustomerForUser: getBillingCustomerForUserMock,
}));
vi.mock('../../../src/services/entitlementService', () => ({
  getEntitlementsForUser: getEntitlementsForUserMock,
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
        mcpAutomation: { maxTokens: 10, maxConcurrentSessions: 200, requestsPerMinute: 300 },
        activeTrips: 3,
        groupSize: 3,
      },
    });
  });

  it('returns entitlement data with checkout availability derived from billing config', async () => {
    const result = await withEnv(
      {
        APP_URL: 'https://app.example.test',
        STRIPE_SECRET_KEY: 'sk_test_123',
        STRIPE_ORGANIZER_PLANS: 'agency=price_agency,pro=price_pro_monthly',
      },
      () => service({}).getEntitlements(user),
    );

    expect(getEntitlementsForUserMock).toHaveBeenCalledWith(user.id);
    expect(result).toMatchObject({
      entitlements: { planKey: 'free', limits: { activeTrips: 3, groupSize: 3 } },
      billing: { checkoutAvailable: true, defaultPlanId: 'pro', portalAvailable: false },
    });
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

    expect(result.billing).toEqual({ checkoutAvailable: false, defaultPlanId: null, portalAvailable: false });
  });

  it('creates a hosted subscription checkout session for an allowlisted organizer plan', async () => {
    const createCheckoutSession = vi
      .fn()
      .mockResolvedValue({ id: 'cs_test_123', url: 'https://checkout.stripe.test/cs' });
    const result = await withEnv(
      {
        APP_URL: 'https://app.example.test',
        STRIPE_SECRET_KEY: 'sk_test_123',
        STRIPE_ORGANIZER_PLANS: 'pro=price_pro_monthly',
      },
      () => service({ createCheckoutSession }).createCheckoutSession(user, { planId: 'pro' }),
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
    expect(params.get('metadata[plan_id]')).toBe('pro');
    expect(params.get('subscription_data[metadata][user_id]')).toBe('7');
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
        STRIPE_ORGANIZER_PLANS: 'pro=price_pro_monthly',
      },
      () => service({ createCheckoutSession }).createCheckoutSession(user, { planId: 'pro' }),
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
      STRIPE_ORGANIZER_PLANS: 'pro=price_pro_monthly',
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
            planId: 'pro',
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
          STRIPE_ORGANIZER_PLANS: 'pro=price_pro_monthly',
        },
        () => billingError(() => service({ createCheckoutSession }).createCheckoutSession(user, { planId: 'pro' })),
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
          STRIPE_ORGANIZER_PLANS: 'pro=price_pro_monthly',
        },
        () =>
          billingError(() =>
            service({ createCheckoutSession: vi.fn() }).createCheckoutSession(user, { planId: 'pro' }),
          ),
      ),
    ).resolves.toEqual({ status: 503, message: 'Billing is not configured.' });
  });
});
