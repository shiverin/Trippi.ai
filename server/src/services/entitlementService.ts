import { asyncDb } from '../db/asyncDatabase';
import type { User } from '../types';
import { getReferralBonusState, type ReferralBonusState } from './referralService';
import { getBillingSubscriptionForUser } from './subscriptionService';
import { ensureUserPlanOverrideColumn, normalizeNonAdminUserPlan } from './userPlanService';

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
  referralBonus: ReferralBonusState;
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

export interface OwnedTripUsage {
  lifetimeTrips: number;
  lockedTrips: number;
  editableFreeTrips: number;
}

type PartialMcpLimits = Partial<Record<keyof McpAutomationLimits, EntitlementLimit | string | number | null>>;
type PartialPlanLimits = Partial<
  Omit<Record<keyof EntitlementPlanLimits, EntitlementLimit | string | number | null>, 'mcpAutomation'> & {
    mcpAutomation: PartialMcpLimits;
  }
>;

const PLAN_KEYS = ['free', 'trial', 'pro', 'agency'] as const;

const FEATURE_LABELS: Record<EntitlementFeature, string> = {
  aiWorkers: 'automation',
  priceWatches: 'automation',
  mcpTokens: 'MCP tokens',
  mcpConcurrentSessions: 'MCP sessions',
  mcpRequestsPerMinute: 'MCP requests per minute',
  activeTrips: 'lifetime trips',
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

function defaultPlans(): Record<string, EntitlementPlanLimits> {
  const noMcp: McpAutomationLimits = {
    maxTokens: 0,
    maxConcurrentSessions: 0,
    requestsPerMinute: 0,
  };
  return {
    free: {
      aiWorkers: 0,
      priceWatches: 0,
      mcpAutomation: { ...noMcp },
      activeTrips: 5,
      groupSize: 1,
    },
    trial: {
      aiWorkers: 0,
      priceWatches: 0,
      mcpAutomation: { ...noMcp },
      activeTrips: 100,
      groupSize: null,
    },
    pro: {
      aiWorkers: 0,
      priceWatches: 0,
      mcpAutomation: { ...noMcp },
      activeTrips: 100,
      groupSize: null,
    },
    agency: {
      aiWorkers: 0,
      priceWatches: 0,
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

async function getUserPlanProfileForEntitlements(
  userId: number,
): Promise<{ role: string | null; billing_plan_override: string | null }> {
  await ensureUserPlanOverrideColumn();
  const user = await asyncDb
    .prepare('SELECT role, billing_plan_override FROM users WHERE id = ?')
    .get<{ role: string | null; billing_plan_override: string | null }>(userId);
  return { role: user?.role ?? null, billing_plan_override: user?.billing_plan_override ?? null };
}

export async function getEntitlementsForUser(userId: number): Promise<ResolvedEntitlements> {
  const [billing, userProfile] = await Promise.all([
    getBillingSubscriptionForUser(userId),
    getUserPlanProfileForEntitlements(userId),
  ]);
  const plans = getEntitlementPlanDefinitions();
  const userRole = userProfile.role;
  const adminOverridePlan = userRole === 'admin' ? null : normalizeNonAdminUserPlan(userProfile.billing_plan_override);
  const billingPlanKey = normalizePlanKey(billing.plan_key);
  const billingStatus = billing.status.toLowerCase();
  const paidAccessActive = billingStatus === 'active' || billingStatus === 'trialing';
  const referralBonus = await getReferralBonusState(userId, {
    paidAccessActive:
      paidAccessActive || userRole === 'admin' || (adminOverridePlan !== null && adminOverridePlan !== 'free'),
  });
  if (adminOverridePlan) {
    return {
      userId,
      planKey: adminOverridePlan,
      billingPlanKey: adminOverridePlan,
      billingStatus: 'admin_override',
      subscribed: false,
      trialing: false,
      limits: plans[adminOverridePlan] ?? plans.free,
      referralBonus,
    };
  }

  let planKey =
    userRole === 'admin' && plans.agency ? 'agency' : resolveEffectivePlanKey(billingStatus, billingPlanKey, plans);
  let effectiveBillingPlanKey = billingPlanKey;
  let effectiveBillingStatus = billingStatus;
  if (planKey === 'free' && referralBonus.active && plans.pro) {
    planKey = 'pro';
    effectiveBillingPlanKey = 'referral_bonus';
    effectiveBillingStatus = 'referral_bonus';
  }

  return {
    userId,
    planKey,
    billingPlanKey: effectiveBillingPlanKey,
    billingStatus: effectiveBillingStatus,
    subscribed: billingStatus === 'active',
    trialing: billingStatus === 'trialing',
    limits: plans[planKey] ?? plans.free,
    referralBonus,
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

export async function countLifetimeTripsForUser(userId: number): Promise<number> {
  const row = await asyncDb
    .prepare('SELECT COUNT(*) AS count FROM trips WHERE user_id = ?')
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

async function listOwnedTripIdsByLockOrder(userId: number): Promise<Array<{ id: number }>> {
  return asyncDb
    .prepare(
      `
      SELECT id
      FROM trips
      WHERE user_id = ?
      ORDER BY created_at DESC, id DESC
    `,
    )
    .all<{ id: number }>(userId);
}

export async function getOwnedTripUsageForUser(
  userId: number,
  entitlements: Pick<ResolvedEntitlements, 'planKey'>,
  editableLimit = 5,
): Promise<OwnedTripUsage> {
  const rows = await listOwnedTripIdsByLockOrder(userId);
  const lockedTrips = entitlements.planKey === 'free' && rows.length > editableLimit ? rows.length - editableLimit : 0;
  return {
    lifetimeTrips: rows.length,
    lockedTrips,
    editableFreeTrips: editableLimit,
  };
}

export interface TripEditLockInfo {
  id: number;
  edit_locked: boolean;
  edit_lock_reason?: 'FREE_SURPLUS_TRIP';
}

export async function getLockedOwnedTripIdsForUser(userId: number, editableLimit = 5): Promise<Set<number>> {
  const entitlements = await getEntitlementsForUser(userId);
  if (entitlements.planKey !== 'free') return new Set();

  const rows = await listOwnedTripIdsByLockOrder(userId);

  if (rows.length <= editableLimit) return new Set();
  return new Set(rows.slice(editableLimit).map((row) => Number(row.id)));
}

export async function isTripEditLockedForActor(
  tripId: string | number,
  actor: Pick<User, 'id' | 'role'> | null | undefined,
): Promise<boolean> {
  if (!actor || actor.role === 'admin') return false;
  const trip = await asyncDb
    .prepare('SELECT id, user_id FROM trips WHERE id = ?')
    .get<{ id: number; user_id: number }>(tripId);
  if (!trip) return false;
  const lockedIds = await getLockedOwnedTripIdsForUser(Number(trip.user_id));
  return lockedIds.has(Number(trip.id));
}

export async function annotateTripsWithEditLocks<T extends { id: number; user_id: number }>(trips: T[]): Promise<T[]> {
  if (trips.length === 0) return trips;
  const ownerIds = Array.from(new Set(trips.map((trip) => Number(trip.user_id)).filter(Number.isFinite)));
  const lockedByOwner = new Map<number, Set<number>>();
  await Promise.all(
    ownerIds.map(async (ownerId) => {
      lockedByOwner.set(ownerId, await getLockedOwnedTripIdsForUser(ownerId));
    }),
  );
  return trips.map((trip) => {
    const locked = lockedByOwner.get(Number(trip.user_id))?.has(Number(trip.id)) ?? false;
    return {
      ...trip,
      edit_locked: locked,
      ...(locked ? { edit_lock_reason: 'FREE_SURPLUS_TRIP' as const } : {}),
    };
  });
}

export async function checkActiveTripCapacity(userId: number, requested = 1): Promise<EntitlementCheck> {
  const entitlements = await getEntitlementsForUser(userId);
  const current = await countLifetimeTripsForUser(userId);
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
