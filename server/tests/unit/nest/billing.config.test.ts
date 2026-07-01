import {
  BillingConfigError,
  getAllowedPlan,
  resolveBillingConfig,
  resolveBillingRedirectUrls,
  STRIPE_API_VERSION,
} from '../../../src/nest/billing/billing.config';

import { describe, expect, it } from 'vitest';

describe('billing config', () => {
  it('parses organizer plan allowlists from JSON config', () => {
    const config = resolveBillingConfig({
      APP_URL: 'https://app.example.test/',
      STRIPE_SECRET_KEY: 'sk_test_123',
      STRIPE_ORGANIZER_PLANS: '{"pro":"price_pro","agency":"price_agency"}',
    });

    expect(config.stripeApiVersion).toBe(STRIPE_API_VERSION);
    expect(getAllowedPlan(config, 'pro')).toMatchObject({
      id: 'pro',
      planKey: 'pro',
      stripePriceId: 'price_pro',
      priceLabel: '$1.99',
    });
  });

  it('parses organizer plan allowlists from comma-delimited config', () => {
    const config = resolveBillingConfig({
      STRIPE_ORGANIZER_PLANS: 'pro=price_pro, agency=price_agency',
    });

    expect(getAllowedPlan(config, 'agency')).toMatchObject({
      id: 'agency',
      planKey: 'agency',
      stripePriceId: 'price_agency',
      priceLabel: '$49',
    });
  });

  it('keeps display plan ids separate from entitlement plan keys', () => {
    const config = resolveBillingConfig({
      STRIPE_ORGANIZER_PLANS: JSON.stringify({
        pro_monthly: { stripePriceId: 'price_monthly', planKey: 'pro', label: 'Monthly Pro' },
        pro_annual: 'price_annual',
        agency_annual: 'price_agency_annual',
      }),
    });

    expect(getAllowedPlan(config, 'pro_monthly')).toMatchObject({
      id: 'pro_monthly',
      planKey: 'pro',
      stripePriceId: 'price_monthly',
      label: 'Monthly Pro',
    });
    expect(getAllowedPlan(config, 'pro_annual')).toMatchObject({
      id: 'pro_annual',
      planKey: 'pro',
      label: 'Pro for 12 months',
      priceLabel: '$9.99',
    });
    expect(getAllowedPlan(config, 'agency_annual')).toMatchObject({ id: 'agency_annual', planKey: 'agency' });
    expect(Array.from(config.plans.keys())).toEqual(['pro_monthly', 'pro_annual', 'agency_annual']);
  });

  it('rejects missing or unknown plan IDs with a friendly message', () => {
    const config = resolveBillingConfig({ STRIPE_ORGANIZER_PLANS: 'pro=price_pro' });

    expect(() => getAllowedPlan(config, undefined)).toThrow(new BillingConfigError('Choose a valid billing plan.'));
    expect(() => getAllowedPlan(config, 'enterprise')).toThrow(new BillingConfigError('Choose a valid billing plan.'));
  });

  it('resolves return URLs only on configured origins', () => {
    const config = resolveBillingConfig({
      APP_URL: 'https://app.example.test',
      ALLOWED_ORIGINS: 'https://preview.example.test',
      STRIPE_ORGANIZER_PLANS: 'pro=price_pro',
    });

    expect(resolveBillingRedirectUrls(config, { successUrl: '/thanks' }).successUrl).toBe(
      'https://app.example.test/thanks',
    );
    expect(
      resolveBillingRedirectUrls(config, { returnUrl: 'https://preview.example.test/billing' }).portalReturnUrl,
    ).toBe('https://preview.example.test/billing');
    expect(() => resolveBillingRedirectUrls(config, { cancelUrl: 'https://evil.example.test' })).toThrow(
      new BillingConfigError('Invalid return URL.'),
    );
  });
});
