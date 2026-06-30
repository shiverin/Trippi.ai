import { getEntitlementsForUser, type ResolvedEntitlements } from '../../services/entitlementService';
import { getBillingCustomerForUser } from '../../services/subscriptionService';
import type { User } from '../../types';
import { BillingConfigError, getAllowedPlan, resolveBillingConfig, resolveBillingRedirectUrls } from './billing.config';
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
}

export interface BillingEntitlementsResult {
  entitlements: ResolvedEntitlements;
  billing: BillingUpgradeAvailability;
}

const CHECKOUT_PLAN_PRIORITY = ['pro', 'agency', 'trial'] as const;

@Injectable()
export class BillingService {
  constructor(private readonly stripe: StripeClient) {}

  async getEntitlements(user: User): Promise<BillingEntitlementsResult> {
    const entitlements = await getEntitlementsForUser(user.id);
    return {
      entitlements,
      billing: resolveUpgradeAvailability(entitlements.planKey, entitlements.subscribed),
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
      params.set('subscription_data[metadata][user_id]', String(user.id));
      params.set('subscription_data[metadata][plan_id]', plan.id);

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

function pickDefaultCheckoutPlan(currentPlanKey: string, planIds: string[]): string | null {
  const candidates = planIds.filter((id) => id !== 'free' && id !== currentPlanKey);
  for (const preferred of CHECKOUT_PLAN_PRIORITY) {
    if (candidates.includes(preferred)) return preferred;
  }
  return candidates[0] ?? null;
}

export function resolveUpgradeAvailability(currentPlanKey: string, subscribed = false): BillingUpgradeAvailability {
  const config = resolveBillingConfig();
  const defaultPlanId = pickDefaultCheckoutPlan(currentPlanKey, Array.from(config.plans.keys()));
  const checkoutAvailable = Boolean(config.stripeSecretKey && defaultPlanId);

  return {
    checkoutAvailable,
    defaultPlanId: checkoutAvailable ? defaultPlanId : null,
    portalAvailable: Boolean(config.stripeSecretKey && subscribed),
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
