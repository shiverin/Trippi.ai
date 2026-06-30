import type { BillingPlanKey } from '../../services/subscriptionService';

export const STRIPE_API_VERSION = '2026-06-24.dahlia';

export interface BillingPlanConfig {
  id: BillingPlanKey;
  stripePriceId: string;
}

export interface BillingRedirectUrls {
  successUrl: string;
  cancelUrl: string;
  portalReturnUrl: string;
}

export interface BillingRuntimeConfig {
  appUrl: string;
  allowedOrigins: string[];
  plans: Map<string, BillingPlanConfig>;
  stripeApiVersion: string;
  stripeSecretKey: string | null;
}

export class BillingConfigError extends Error {}

const DEFAULT_SUCCESS_PATH = '/billing/success?session_id={CHECKOUT_SESSION_ID}';
const DEFAULT_CANCEL_PATH = '/billing';
const DEFAULT_PORTAL_RETURN_PATH = '/settings/billing';

function cleanOrigin(value: string | undefined | null): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  try {
    const parsed = new URL(trimmed);
    return parsed.origin;
  } catch {
    return null;
  }
}

function cleanBaseUrl(value: string | undefined | null): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  try {
    const parsed = new URL(trimmed);
    return parsed.toString().replace(/\/+$/, '');
  } catch {
    return null;
  }
}

function fallbackAppUrl(env: NodeJS.ProcessEnv): string {
  const appUrl = cleanBaseUrl(env.APP_URL);
  if (appUrl) return appUrl;

  const firstAllowedOrigin = env.ALLOWED_ORIGINS?.split(',').map(cleanBaseUrl).find(Boolean);
  if (firstAllowedOrigin) return firstAllowedOrigin;

  const port = Number(env.PORT) || 3001;
  return `http://localhost:${port}`;
}

function parsePlanRecord(id: unknown, stripePriceId: unknown): BillingPlanConfig | null {
  if (typeof id !== 'string' || typeof stripePriceId !== 'string') return null;
  const planId = id.trim();
  const priceId = stripePriceId.trim();
  if (!planId || !priceId) return null;
  return { id: planId, stripePriceId: priceId };
}

function parseJsonPlans(raw: string): BillingPlanConfig[] | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) {
      return parsed
        .map((entry) => {
          if (!entry || typeof entry !== 'object') return null;
          const item = entry as Record<string, unknown>;
          return parsePlanRecord(item.id ?? item.planId ?? item.key, item.stripePriceId ?? item.priceId);
        })
        .filter((plan): plan is BillingPlanConfig => Boolean(plan));
    }
    if (parsed && typeof parsed === 'object') {
      return Object.entries(parsed as Record<string, unknown>)
        .map(([id, priceId]) => parsePlanRecord(id, priceId))
        .filter((plan): plan is BillingPlanConfig => Boolean(plan));
    }
  } catch {
    return null;
  }
  return null;
}

function parseDelimitedPlans(raw: string): BillingPlanConfig[] {
  return raw
    .split(',')
    .map((pair) => {
      const [id, stripePriceId] = pair.split('=');
      return parsePlanRecord(id, stripePriceId);
    })
    .filter((plan): plan is BillingPlanConfig => Boolean(plan));
}

/**
 * STRIPE_ORGANIZER_PLANS accepts either JSON (`{"pro":"price_..."}`) or
 * comma-delimited pairs (`pro=price_...,agency=price_...`).
 */
export function resolveBillingConfig(env: NodeJS.ProcessEnv = process.env): BillingRuntimeConfig {
  const rawPlans = env.STRIPE_ORGANIZER_PLANS?.trim() || '';
  const parsedPlans = rawPlans ? (parseJsonPlans(rawPlans) ?? parseDelimitedPlans(rawPlans)) : [];
  const plans = new Map<string, BillingPlanConfig>();
  parsedPlans.forEach((plan) => plans.set(plan.id, plan));

  const appUrl = fallbackAppUrl(env);
  const allowedOrigins = Array.from(
    new Set(
      [cleanOrigin(appUrl), ...(env.ALLOWED_ORIGINS?.split(',').map(cleanOrigin) ?? [])].filter(
        (origin): origin is string => Boolean(origin),
      ),
    ),
  );

  return {
    appUrl,
    allowedOrigins,
    plans,
    stripeApiVersion: env.STRIPE_API_VERSION?.trim() || STRIPE_API_VERSION,
    stripeSecretKey: env.STRIPE_SECRET_KEY?.trim() || null,
  };
}

export function requireStripeSecret(config: BillingRuntimeConfig): string {
  if (!config.stripeSecretKey) {
    throw new BillingConfigError('Billing is not configured.');
  }
  return config.stripeSecretKey;
}

export function getAllowedPlan(config: BillingRuntimeConfig, planId: unknown): BillingPlanConfig {
  if (typeof planId !== 'string' || !planId.trim()) {
    throw new BillingConfigError('Choose a valid billing plan.');
  }

  const plan = config.plans.get(planId.trim());
  if (!plan) {
    throw new BillingConfigError('Choose a valid billing plan.');
  }
  return plan;
}

function resolveRedirectUrl(config: BillingRuntimeConfig, input: unknown, fallbackPath: string): string {
  if (input !== undefined && typeof input !== 'string') {
    throw new BillingConfigError('Invalid return URL.');
  }

  const raw = typeof input === 'string' && input.trim() ? input.trim() : fallbackPath;
  let resolved: URL;
  try {
    resolved = new URL(raw, config.appUrl);
  } catch {
    throw new BillingConfigError('Invalid return URL.');
  }

  if (!config.allowedOrigins.includes(resolved.origin)) {
    throw new BillingConfigError('Invalid return URL.');
  }

  return resolved.href.replaceAll('%7B', '{').replaceAll('%7D', '}');
}

export function resolveBillingRedirectUrls(
  config: BillingRuntimeConfig,
  input: { successUrl?: unknown; cancelUrl?: unknown; returnUrl?: unknown } = {},
): BillingRedirectUrls {
  return {
    successUrl: resolveRedirectUrl(config, input.successUrl, DEFAULT_SUCCESS_PATH),
    cancelUrl: resolveRedirectUrl(config, input.cancelUrl, DEFAULT_CANCEL_PATH),
    portalReturnUrl: resolveRedirectUrl(config, input.returnUrl, DEFAULT_PORTAL_RETURN_PATH),
  };
}
