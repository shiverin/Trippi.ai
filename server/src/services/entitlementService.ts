import { asyncDb } from '../db/asyncDatabase';
import { getBillingSubscriptionForUser } from './subscriptionService';

export type EntitlementLimit = number | null;
export type EntitlementFeature =
  | 'aiWorkers'
  | 'priceWatches'
  | 'mcpTokens'
  | 'mcpConcurrentSessions'
  | 'mcpRequestsPerMinute'
  | 'activeTrips'
  | 'groupSize';

export interface McpAutomationLimits {
  maxTokens: EntitlementLimit;
  maxConcurrentSessions: EntitlementLimit;
  requestsPerMinute: EntitlementLimit;
}

export interface EntitlementPlanLimits {
  aiWorkers: EntitlementLimit;
  priceWatches: EntitlementLimit;
  mcpAutomation: McpAutomationLimits;
  activeTrips: EntitlementLimit;
  groupSize: EntitlementLimit;
}

export interface ResolvedEntitlements {
  userId: number;
  planKey: string;
  billingPlanKey: string;
  billingStatus: string;
  subscribed: boolean;
  trialing: boolean;
  limits: EntitlementPlanLimits;
}

export interface EntitlementCheck {
  allowed: boolean;
  feature: EntitlementFeature;
  planKey: string;
  current: number;
  requested: number;
  limit: EntitlementLimit;
  message?: string;
}

type PartialMcpLimits = Partial<Record<keyof McpAutomationLimits, EntitlementLimit | string | number | null>>;
type PartialPlanLimits = Partial<
  Omit<Record<keyof EntitlementPlanLimits, EntitlementLimit | string | number | null>, 'mcpAutomation'> & {
    mcpAutomation: PartialMcpLimits;
  }
>;

const PLAN_KEYS = ['free', 'trial', 'pro', 'agency'] as const;
const DEFAULT_MCP_TOKENS = 10;
const DEFAULT_MCP_SESSIONS = 200;
const DEFAULT_MCP_REQUESTS_PER_MINUTE = 300;

const FEATURE_LABELS: Record<EntitlementFeature, string> = {
  aiWorkers: 'AI workers',
  priceWatches: 'price watches',
  mcpTokens: 'MCP tokens',
  mcpConcurrentSessions: 'MCP sessions',
  mcpRequestsPerMinute: 'MCP requests per minute',
  activeTrips: 'active trips',
  groupSize: 'trip members',
};

export class EntitlementLimitError extends Error {
  readonly status = 403;
  readonly code = 'ENTITLEMENT_LIMIT_REACHED';

  constructor(readonly check: EntitlementCheck) {
    super(check.message ?? 'Entitlement limit reached');
  }
}

function parseLimit(value: unknown, fallback: EntitlementLimit): EntitlementLimit {
  if (value === undefined) return fallback;
  if (value === null) return null;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return fallback;
    return value < 0 ? null : Math.floor(value);
  }
  if (typeof value !== 'string') return fallback;

  const normalized = value.trim().toLowerCase();
  if (!normalized) return fallback;
  if (['unlimited', 'infinite', 'infinity', 'none', '-1'].includes(normalized)) return null;

  const parsed = Number.parseInt(normalized, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return parsed < 0 ? null : parsed;
}

function envLimit(name: string, fallback: EntitlementLimit): EntitlementLimit {
  return parseLimit(process.env[name], fallback);
}

function positiveEnvLimit(name: string, fallback: EntitlementLimit): EntitlementLimit {
  const parsed = parseLimit(process.env[name], fallback);
  if (parsed === null) return null;
  return parsed > 0 ? parsed : fallback;
}

function defaultMcpLimits(): McpAutomationLimits {
  return {
    maxTokens: envLimit('MCP_MAX_TOKENS_PER_USER', DEFAULT_MCP_TOKENS),
    maxConcurrentSessions: positiveEnvLimit('MCP_MAX_SESSION_PER_USER', DEFAULT_MCP_SESSIONS),
    requestsPerMinute: positiveEnvLimit('MCP_RATE_LIMIT', DEFAULT_MCP_REQUESTS_PER_MINUTE),
  };
}

function defaultPlans(): Record<string, EntitlementPlanLimits> {
  const mcp = defaultMcpLimits();
  return {
    free: {
      aiWorkers: 0,
      priceWatches: 0,
      mcpAutomation: { ...mcp },
      activeTrips: 3,
      groupSize: 3,
    },
    trial: {
      aiWorkers: 1,
      priceWatches: 10,
      mcpAutomation: { ...mcp },
      activeTrips: 10,
      groupSize: 6,
    },
    pro: {
      aiWorkers: 3,
      priceWatches: 25,
      mcpAutomation: { ...mcp },
      activeTrips: 25,
      groupSize: 10,
    },
    agency: {
      aiWorkers: null,
      priceWatches: null,
      mcpAutomation: {
        maxTokens: null,
        maxConcurrentSessions: null,
        requestsPerMinute: null,
      },
      activeTrips: null,
      groupSize: null,
    },
  };
}

function mergePlan(base: EntitlementPlanLimits, override: PartialPlanLimits): EntitlementPlanLimits {
  return {
    aiWorkers: parseLimit(override.aiWorkers, base.aiWorkers),
    priceWatches: parseLimit(override.priceWatches, base.priceWatches),
    activeTrips: parseLimit(override.activeTrips, base.activeTrips),
    groupSize: parseLimit(override.groupSize, base.groupSize),
    mcpAutomation: {
      maxTokens: parseLimit(override.mcpAutomation?.maxTokens, base.mcpAutomation.maxTokens),
      maxConcurrentSessions: parseLimit(
        override.mcpAutomation?.maxConcurrentSessions,
        base.mcpAutomation.maxConcurrentSessions,
      ),
      requestsPerMinute: parseLimit(override.mcpAutomation?.requestsPerMinute, base.mcpAutomation.requestsPerMinute),
    },
  };
}

function parseJsonPlanOverrides(): Record<string, PartialPlanLimits> {
  const raw = process.env.TRIPPI_ENTITLEMENT_PLANS || process.env.TRIPPI_PLAN_ENTITLEMENTS || '';
  if (!raw.trim()) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return parsed as Record<string, PartialPlanLimits>;
  } catch (err) {
    console.warn(
      `[entitlements] Ignoring invalid TRIPPI_ENTITLEMENT_PLANS: ${err instanceof Error ? err.message : err}`,
    );
    return {};
  }
}

function applyEnvOverrides(plans: Record<string, EntitlementPlanLimits>): Record<string, EntitlementPlanLimits> {
  const next = { ...plans };
  for (const plan of PLAN_KEYS) {
    const prefix = `TRIPPI_ENTITLEMENTS_${plan.toUpperCase()}`;
    next[plan] = mergePlan(next[plan], {
      aiWorkers: process.env[`${prefix}_AI_WORKERS`],
      priceWatches: process.env[`${prefix}_PRICE_WATCHES`],
      activeTrips: process.env[`${prefix}_ACTIVE_TRIPS`],
      groupSize: process.env[`${prefix}_GROUP_SIZE`],
      mcpAutomation: {
        maxTokens: process.env[`${prefix}_MCP_TOKENS`],
        maxConcurrentSessions: process.env[`${prefix}_MCP_SESSIONS`],
        requestsPerMinute: process.env[`${prefix}_MCP_REQUESTS_PER_MINUTE`],
      },
    });
  }
  return next;
}

export function getEntitlementPlanDefinitions(): Record<string, EntitlementPlanLimits> {
  const plans = applyEnvOverrides(defaultPlans());
  const jsonOverrides = parseJsonPlanOverrides();
  for (const [planKey, override] of Object.entries(jsonOverrides)) {
    plans[planKey] = mergePlan(plans[planKey] ?? plans.pro, override);
  }
  return plans;
}

function normalizePlanKey(value: string | null | undefined): string {
  return (value || 'free').trim().toLowerCase() || 'free';
}

function resolveEffectivePlanKey(
  status: string,
  billingPlanKey: string,
  plans: Record<string, EntitlementPlanLimits>,
): string {
  const normalizedStatus = status.toLowerCase();
  if (normalizedStatus === 'trialing') return 'trial';
  if (normalizedStatus !== 'active') return 'free';

  const normalizedPlan = normalizePlanKey(billingPlanKey);
  if (plans[normalizedPlan]) return normalizedPlan;
  return 'pro';
}

export async function getEntitlementsForUser(userId: number): Promise<ResolvedEntitlements> {
  const billing = await getBillingSubscriptionForUser(userId);
  const plans = getEntitlementPlanDefinitions();
  const billingPlanKey = normalizePlanKey(billing.plan_key);
  const billingStatus = billing.status.toLowerCase();
  const planKey = resolveEffectivePlanKey(billingStatus, billingPlanKey, plans);

  return {
    userId,
    planKey,
    billingPlanKey,
    billingStatus,
    subscribed: billingStatus === 'active',
    trialing: billingStatus === 'trialing',
    limits: plans[planKey] ?? plans.free,
  };
}

export function limitAllows(limit: EntitlementLimit, current: number, requested = 1): boolean {
  if (limit === null) return true;
  return current + requested <= limit;
}

function limitMessage(feature: EntitlementFeature, check: Pick<EntitlementCheck, 'planKey' | 'limit'>): string {
  if (check.limit === null) return '';
  const label = FEATURE_LABELS[feature];
  return `Your ${check.planKey} plan allows up to ${check.limit} ${label}.`;
}

export function checkEntitlementLimit(
  entitlements: ResolvedEntitlements,
  feature: EntitlementFeature,
  limit: EntitlementLimit,
  current: number,
  requested = 1,
): EntitlementCheck {
  const allowed = limitAllows(limit, current, requested);
  const check: EntitlementCheck = {
    allowed,
    feature,
    planKey: entitlements.planKey,
    current,
    requested,
    limit,
  };
  if (!allowed) check.message = limitMessage(feature, check);
  return check;
}

export function throwIfEntitlementDenied(check: EntitlementCheck): void {
  if (!check.allowed) throw new EntitlementLimitError(check);
}

export async function countActiveTripsForUser(userId: number): Promise<number> {
  const row = await asyncDb
    .prepare('SELECT COUNT(*) AS count FROM trips WHERE user_id = ? AND is_archived = 0')
    .get<{ count: number }>(userId);
  return row?.count ?? 0;
}

export async function countTripGroupSize(tripId: string | number): Promise<number> {
  const row = await asyncDb
    .prepare(
      `
      SELECT 1 + COUNT(tm.id) AS count
      FROM trips t
      LEFT JOIN trip_members tm ON tm.trip_id = t.id
      WHERE t.id = ?
      GROUP BY t.id
    `,
    )
    .get<{ count: number }>(tripId);
  return row?.count ?? 0;
}

export async function countMcpTokensForUser(userId: number): Promise<number> {
  const row = await asyncDb
    .prepare('SELECT COUNT(*) AS count FROM mcp_tokens WHERE user_id = ?')
    .get<{ count: number }>(userId);
  return row?.count ?? 0;
}

export async function checkActiveTripCapacity(userId: number, requested = 1): Promise<EntitlementCheck> {
  const entitlements = await getEntitlementsForUser(userId);
  const current = await countActiveTripsForUser(userId);
  return checkEntitlementLimit(entitlements, 'activeTrips', entitlements.limits.activeTrips, current, requested);
}

export async function checkTripGroupCapacity(
  ownerId: number,
  tripId: string | number,
  requested = 1,
): Promise<EntitlementCheck> {
  const entitlements = await getEntitlementsForUser(ownerId);
  const current = await countTripGroupSize(tripId);
  return checkEntitlementLimit(entitlements, 'groupSize', entitlements.limits.groupSize, current, requested);
}

export async function checkMcpTokenCapacity(userId: number, requested = 1): Promise<EntitlementCheck> {
  const entitlements = await getEntitlementsForUser(userId);
  const current = await countMcpTokensForUser(userId);
  return checkEntitlementLimit(
    entitlements,
    'mcpTokens',
    entitlements.limits.mcpAutomation.maxTokens,
    current,
    requested,
  );
}
