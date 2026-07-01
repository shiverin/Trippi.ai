import { asyncDb } from '../db/asyncDatabase';
import { resolveDbProvider } from '../db/providerMode';

export const ADMIN_USER_PLANS = ['free', 'pro', 'agency', 'admin'] as const;
export type AdminUserPlan = (typeof ADMIN_USER_PLANS)[number];
export type NonAdminUserPlan = Exclude<AdminUserPlan, 'admin'>;

const NON_ADMIN_PLANS = new Set<string>(['free', 'pro', 'agency']);

function isDuplicateColumnError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /duplicate column name|ORA-01430/i.test(message);
}

export function normalizeAdminUserPlan(value: unknown): AdminUserPlan | null {
  if (typeof value !== 'string') return null;
  const plan = value.trim().toLowerCase();
  return (ADMIN_USER_PLANS as readonly string[]).includes(plan) ? (plan as AdminUserPlan) : null;
}

export function normalizeNonAdminUserPlan(value: unknown): NonAdminUserPlan | null {
  const plan = normalizeAdminUserPlan(value);
  return plan && plan !== 'admin' ? plan : null;
}

export function roleForAdminUserPlan(plan: AdminUserPlan): 'admin' | 'user' {
  return plan === 'admin' ? 'admin' : 'user';
}

export function overrideForAdminUserPlan(plan: AdminUserPlan): NonAdminUserPlan | null {
  return plan === 'admin' ? null : plan;
}

export function adminPlanFromUserState(input: {
  role?: string | null;
  billing_plan_override?: string | null;
  effectivePlanKey?: string | null;
  billingPlanKey?: string | null;
  billingStatus?: string | null;
}): AdminUserPlan {
  if (input.role === 'admin') return 'admin';

  const override = normalizeNonAdminUserPlan(input.billing_plan_override);
  if (override) return override;

  const paidBillingPlan =
    input.billingStatus === 'active' || input.billingStatus === 'trialing'
      ? normalizeNonAdminUserPlan(input.billingPlanKey)
      : null;
  if (paidBillingPlan) return paidBillingPlan;

  const effective = normalizeNonAdminUserPlan(input.effectivePlanKey);
  return effective ?? 'free';
}

export function isNonAdminPlan(value: string): value is NonAdminUserPlan {
  return NON_ADMIN_PLANS.has(value);
}

let oracleEnsurePromise: Promise<void> | null = null;

export async function ensureUserPlanOverrideColumn(): Promise<void> {
  if (resolveDbProvider() !== 'oracle-async') return;
  if (!oracleEnsurePromise) {
    oracleEnsurePromise = asyncDb
      .exec('ALTER TABLE users ADD billing_plan_override VARCHAR2(64 CHAR)')
      .then(() => undefined)
      .catch((err) => {
        if (isDuplicateColumnError(err)) return;
        oracleEnsurePromise = null;
        throw err;
      });
  }
  await oracleEnsurePromise;
}
