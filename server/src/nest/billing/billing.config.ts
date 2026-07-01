import type { BillingPlanKey } from '../../services/subscriptionService';

export const STRIPE_API_VERSION = '2026-06-24.dahlia';

export interface BillingPlanConfig {
  id: string;
  planKey: BillingPlanKey;
  stripePriceId: string;
  label: string;
  priceLabel: string;
  intervalLabel: string;
  description: string;
  badge?: string;
  featured?: boolean;
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

const DEFAULT_PLAN_DETAILS: Record<
  string,
  Omit<BillingPlanConfig, 'id' | 'stripePriceId'> & { aliases?: string[] }
> = {
  pro_monthly: {
    planKey: 'pro',
    label: 'Pro',
    priceLabel: '$1.99',
    intervalLabel: 'per month',
    description: 'Full Pro planning for one month.',
    aliases: ['pro'],
  },
  pro_annual: {
    planKey: 'pro',
    label: 'Pro for 12 months',
    priceLabel: '$9.99',
    intervalLabel: 'per 12 months',
    description: 'A year of Pro for frequent travelers.',
    badge: 'Best value',
    featured: true,
  },
  agency_annual: {
    planKey: 'agency',
    label: 'Agency',
    priceLabel: '$49',
    intervalLabel: 'per month',
    description: 'Agency-scale limits for teams and trip operators.',
  },
  pro: {
    planKey: 'pro',
    label: 'Pro',
    priceLabel: '$1.99',
    intervalLabel: 'per month',
    description: 'Full Pro planning for one month.',
  },
  agency: {
    planKey: 'agency',
    label: 'Agency',
    priceLabel: '$49',
    intervalLabel: 'per month',
    description: 'Agency-scale limits for teams and trip operators.',
  },
};

const PLAN_DISPLAY_ORDER = ['pro_monthly', 'pro_annual', 'agency_annual', 'pro', 'agency', 'trial'];

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

function defaultPlanDetails(id: string): Omit<BillingPlanConfig, 'id' | 'stripePriceId'> {
  if (DEFAULT_PLAN_DETAILS[id]) return DEFAULT_PLAN_DETAILS[id];
  if (id.startsWith('pro_')) return DEFAULT_PLAN_DETAILS.pro_monthly;
  if (id.startsWith('agency_')) return DEFAULT_PLAN_DETAILS.agency_annual;
  return {
    planKey: id as BillingPlanKey,
    label: id,
    priceLabel: '',
    intervalLabel: '',
    description: '',
  };
}

function planKeyFromId(id: string, override: unknown): BillingPlanKey {
  if (typeof override === 'string' && override.trim()) return override.trim().toLowerCase();
  return defaultPlanDetails(id).planKey;
}

function parsePlanRecord(id: unknown, value: unknown): BillingPlanConfig | null {
  if (typeof id !== 'string') return null;
  const planId = id.trim();
  if (!planId) return null;
  const defaults = defaultPlanDetails(planId);

  if (typeof value === 'string') {
    const priceId = value.trim();
    if (!priceId) return null;
    return { id: planId, stripePriceId: priceId, ...defaults };
  }

  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const item = value as Record<string, unknown>;
  const rawPriceId = item.stripePriceId ?? item.priceId ?? item.stripe_price_id;
  if (typeof rawPriceId !== 'string') return null;
  const priceId = rawPriceId.trim();
  if (!planId || !priceId) return null;
  return {
    id: planId,
    stripePriceId: priceId,
    planKey: planKeyFromId(planId, item.planKey ?? item.entitlementPlanKey ?? item.entitlement),
    label: typeof item.label === 'string' && item.label.trim() ? item.label.trim() : defaults.label,
    priceLabel:
      typeof item.priceLabel === 'string' && item.priceLabel.trim() ? item.priceLabel.trim() : defaults.priceLabel,
    intervalLabel:
      typeof item.intervalLabel === 'string' && item.intervalLabel.trim()
        ? item.intervalLabel.trim()
        : defaults.intervalLabel,
    description:
      typeof item.description === 'string' && item.description.trim() ? item.description.trim() : defaults.description,
    badge: typeof item.badge === 'string' && item.badge.trim() ? item.badge.trim() : defaults.badge,
    featured: typeof item.featured === 'boolean' ? item.featured : defaults.featured,
  };
}

function parseJsonPlans(raw: string): BillingPlanConfig[] | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) {
      return parsed
        .map((entry) => {
          if (!entry || typeof entry !== 'object') return null;
          const item = entry as Record<string, unknown>;
          return parsePlanRecord(item.id ?? item.planId ?? item.key, item);
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

function sortPlans(plans: BillingPlanConfig[]): BillingPlanConfig[] {
  return plans
    .map((plan, index) => ({ plan, index }))
    .sort((a, b) => {
      const aRank = PLAN_DISPLAY_ORDER.indexOf(a.plan.id);
      const bRank = PLAN_DISPLAY_ORDER.indexOf(b.plan.id);
      const normalizedARank = aRank === -1 ? Number.MAX_SAFE_INTEGER : aRank;
      const normalizedBRank = bRank === -1 ? Number.MAX_SAFE_INTEGER : bRank;
      return normalizedARank - normalizedBRank || a.index - b.index;
    })
    .map(({ plan }) => plan);
}

/**
 * STRIPE_ORGANIZER_PLANS accepts either JSON
 * (`{"pro_monthly":"price_..."}` or full plan objects) or comma-delimited pairs
 * (`pro_monthly=price_...,pro_annual=price_...,agency_annual=price_...`).
 */
export function resolveBillingConfig(env: NodeJS.ProcessEnv = process.env): BillingRuntimeConfig {
  const rawPlans = env.STRIPE_ORGANIZER_PLANS?.trim() || '';
  const parsedPlans = rawPlans ? (parseJsonPlans(rawPlans) ?? parseDelimitedPlans(rawPlans)) : [];
  const plans = new Map<string, BillingPlanConfig>();
  sortPlans(parsedPlans).forEach((plan) => plans.set(plan.id, plan));

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
