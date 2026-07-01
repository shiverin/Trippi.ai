import {
  getEntitlementsForUser,
  getOwnedTripUsageForUser,
  type EntitlementLimit,
  type ResolvedEntitlements,
} from '../../services/entitlementService';
import { getBillingCustomerForUser, getBillingSubscriptionForUser } from '../../services/subscriptionService';
import type { User } from '../../types';
import {
  BillingConfigError,
  getAllowedPlan,
  resolveBillingConfig,
  resolveBillingRedirectUrls,
  type BillingPlanConfig,
} from './billing.config';
import { StripeClient, StripeRequestError } from './stripe-client';
import { Injectable } from '@nestjs/common';

export class BillingError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export interface CreateCheckoutSessionInput {
  planId?: unknown;
  successUrl?: unknown;
  cancelUrl?: unknown;
}

export interface CreatePortalSessionInput {
  returnUrl?: unknown;
}

export interface BillingSessionResult {
  url: string;
}

export interface BillingUpgradeAvailability {
  checkoutAvailable: boolean;
  defaultPlanId: string | null;
  portalAvailable: boolean;
  plans: BillingPlanOption[];
}

export interface BillingPlanOption {
  id: string;
  planKey: string;
  label: string;
  priceLabel: string;
  intervalLabel: string;
  description: string;
  badge?: string;
  featured?: boolean;
}

export interface BillingEntitlementsResult {
  entitlements: ResolvedEntitlements;
  access: BillingAccessSummary;
  usage: BillingUsageSummary;
  billing: BillingUpgradeAvailability;
}

export type BillingAccessSource = 'free' | 'paid_subscription' | 'paid_trial' | 'referral_bonus' | 'admin';

export interface BillingAccessSummary {
  source: BillingAccessSource;
  planKey: string;
  activeUntil: string | null;
  daysRemaining: number | null;
  renews: boolean;
  cancelAtPeriodEnd: boolean;
}

export interface BillingUsageSummary {
  lifetimeTrips: {
    current: number;
    limit: EntitlementLimit;
    locked: number;
    editableFreeTrips: number;
  };
  groupSize: {
    limit: EntitlementLimit;
  };
  referralBonus: {
    activeDays: number;
    pendingDays: number;
    maxDays: number;
  };
}

const CHECKOUT_PLAN_PRIORITY = ['pro_monthly', 'pro_annual', 'agency_annual', 'pro', 'agency', 'trial'] as const;
const DAY_MS = 24 * 60 * 60 * 1000;

function parseFutureIso(value: string | null | undefined, now = Date.now()): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()) || parsed.getTime() <= now) return null;
  return parsed.toISOString();
}

function daysRemainingUntil(value: string | null, now = Date.now()): number | null {
  if (!value) return null;
  const parsed = new Date(value).getTime();
  if (Number.isNaN(parsed) || parsed <= now) return null;
  return Math.floor((parsed - now) / DAY_MS);
}

function resolveAccessSummary(
  user: Pick<User, 'role'>,
  entitlements: ResolvedEntitlements,
  billing: Awaited<ReturnType<typeof getBillingSubscriptionForUser>>,
): BillingAccessSummary {
  if (user.role === 'admin') {
    return {
      source: 'admin',
      planKey: entitlements.planKey,
      activeUntil: null,
      daysRemaining: null,
      renews: false,
      cancelAtPeriodEnd: false,
    };
  }

  if (entitlements.billingPlanKey === 'referral_bonus' || entitlements.billingStatus === 'referral_bonus') {
    const activeUntil = parseFutureIso(entitlements.referralBonus.activeUntil);
    return {
      source: 'referral_bonus',
      planKey: entitlements.planKey,
      activeUntil,
      daysRemaining: daysRemainingUntil(activeUntil),
      renews: false,
      cancelAtPeriodEnd: false,
    };
  }

  const billingStatus = billing.status.toLowerCase();
  if (billingStatus === 'trialing') {
    const activeUntil = parseFutureIso(billing.trial_end) ?? parseFutureIso(billing.current_period_end);
    return {
      source: 'paid_trial',
      planKey: entitlements.planKey,
      activeUntil,
      daysRemaining: daysRemainingUntil(activeUntil),
      renews: false,
      cancelAtPeriodEnd: !!billing.cancel_at_period_end,
    };
  }

  if (billingStatus === 'active') {
    const activeUntil = parseFutureIso(billing.current_period_end);
    const cancelAtPeriodEnd = !!billing.cancel_at_period_end;
    return {
      source: 'paid_subscription',
      planKey: entitlements.planKey,
      activeUntil,
      daysRemaining: daysRemainingUntil(activeUntil),
      renews: !cancelAtPeriodEnd,
      cancelAtPeriodEnd,
    };
  }

  return {
    source: 'free',
    planKey: entitlements.planKey,
    activeUntil: null,
    daysRemaining: null,
    renews: false,
    cancelAtPeriodEnd: false,
  };
}

@Injectable()
export class BillingService {
  constructor(private readonly stripe: StripeClient) {}

  async getEntitlements(user: User): Promise<BillingEntitlementsResult> {
    const [entitlements, billing] = await Promise.all([
      getEntitlementsForUser(user.id),
      getBillingSubscriptionForUser(user.id),
    ]);
    const tripUsage = await getOwnedTripUsageForUser(user.id, entitlements);
    const upgradeCurrentPlanKey = entitlements.billingPlanKey === 'referral_bonus' ? 'free' : entitlements.planKey;
    return {
      entitlements,
      access: resolveAccessSummary(user, entitlements, billing),
      usage: {
        lifetimeTrips: {
          current: tripUsage.lifetimeTrips,
          limit: entitlements.limits.activeTrips,
          locked: tripUsage.lockedTrips,
          editableFreeTrips: tripUsage.editableFreeTrips,
        },
        groupSize: {
          limit: entitlements.limits.groupSize,
        },
        referralBonus: {
          activeDays: entitlements.referralBonus.daysRemaining,
          pendingDays: entitlements.referralBonus.pendingDays,
          maxDays: entitlements.referralBonus.maxDays,
        },
      },
      billing: resolveUpgradeAvailability(upgradeCurrentPlanKey, entitlements.subscribed),
    };
  }

  async createCheckoutSession(user: User, input: CreateCheckoutSessionInput): Promise<BillingSessionResult> {
    try {
      const config = resolveBillingConfig();
      resolveBillingConfigReady(config);
      const plan = getAllowedPlan(config, input.planId);
      const urls = resolveBillingRedirectUrls(config, {
        successUrl: input.successUrl,
        cancelUrl: input.cancelUrl,
      });
      const customer = await getBillingCustomerForUser(user.id);

      const params = new URLSearchParams();
      params.set('mode', 'subscription');
      params.set('line_items[0][price]', plan.stripePriceId);
      params.set('line_items[0][quantity]', '1');
      params.set('success_url', urls.successUrl);
      params.set('cancel_url', urls.cancelUrl);
      params.set('client_reference_id', String(user.id));
      params.set('metadata[user_id]', String(user.id));
      params.set('metadata[plan_id]', plan.id);
      params.set('metadata[plan_key]', plan.planKey);
      params.set('subscription_data[metadata][user_id]', String(user.id));
      params.set('subscription_data[metadata][plan_id]', plan.id);
      params.set('subscription_data[metadata][plan_key]', plan.planKey);

      if (customer?.stripe_customer_id) {
        params.set('customer', customer.stripe_customer_id);
      } else if (user.email) {
        params.set('customer_email', user.email);
      }

      const session = await this.stripe.createCheckoutSession(params);
      if (!session.url) {
        throw new BillingError(502, 'Unable to start checkout right now. Please try again later.');
      }

      return { url: session.url };
    } catch (err) {
      throw toBillingError(err);
    }
  }

  async createPortalSession(user: User, input: CreatePortalSessionInput): Promise<BillingSessionResult> {
    try {
      const config = resolveBillingConfig();
      resolveBillingConfigReady(config);
      const urls = resolveBillingRedirectUrls(config, { returnUrl: input.returnUrl });
      const customer = await getBillingCustomerForUser(user.id);

      if (!customer?.stripe_customer_id) {
        throw new BillingError(400, 'No billing customer found for this account.');
      }

      const params = new URLSearchParams();
      params.set('customer', customer.stripe_customer_id);
      params.set('return_url', urls.portalReturnUrl);

      const session = await this.stripe.createBillingPortalSession(params);
      return { url: session.url };
    } catch (err) {
      throw toBillingError(err);
    }
  }
}

function toPlanOption(plan: BillingPlanConfig): BillingPlanOption {
  return {
    id: plan.id,
    planKey: plan.planKey,
    label: plan.label,
    priceLabel: plan.priceLabel,
    intervalLabel: plan.intervalLabel,
    description: plan.description,
    badge: plan.badge,
    featured: plan.featured,
  };
}

function pickDefaultCheckoutPlan(currentPlanKey: string, plans: BillingPlanOption[]): string | null {
  const candidates = plans.filter((plan) => plan.planKey !== 'free' && plan.planKey !== currentPlanKey);
  for (const preferred of CHECKOUT_PLAN_PRIORITY) {
    if (candidates.some((plan) => plan.id === preferred)) return preferred;
  }
  return candidates[0]?.id ?? null;
}

export function resolveUpgradeAvailability(currentPlanKey: string, subscribed = false): BillingUpgradeAvailability {
  const config = resolveBillingConfig();
  const plans = Array.from(config.plans.values()).map(toPlanOption);
  const defaultPlanId = pickDefaultCheckoutPlan(currentPlanKey, plans);
  const checkoutAvailable = Boolean(config.stripeSecretKey && defaultPlanId);

  return {
    checkoutAvailable,
    defaultPlanId: checkoutAvailable ? defaultPlanId : null,
    portalAvailable: Boolean(config.stripeSecretKey && subscribed),
    plans: checkoutAvailable ? plans : plans.map((plan) => ({ ...plan })),
  };
}

function resolveBillingConfigReady(config: ReturnType<typeof resolveBillingConfig>): void {
  if (!config.stripeSecretKey) {
    throw new BillingConfigError('Billing is not configured.');
  }
}

function toBillingError(err: unknown): BillingError {
  if (err instanceof BillingError) return err;
  if (err instanceof BillingConfigError) {
    const status = err.message === 'Billing is not configured.' ? 503 : 400;
    return new BillingError(status, err.message);
  }
  if (err instanceof StripeRequestError) {
    return new BillingError(502, 'Billing is temporarily unavailable. Please try again later.');
  }
  console.error('Billing endpoint failed', err);
  return new BillingError(500, 'Unable to complete the billing request.');
}
