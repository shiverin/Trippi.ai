import type { BillingAccessSummary } from '../../types';

type Translator = (key: string, params?: Record<string, string | number>) => string;

export function formatPlanName(access: BillingAccessSummary | null | undefined, t: Translator): string {
  if (!access) return t('settings.usage.loadingPlan');
  if (access.source === 'referral_bonus') return t('settings.usage.referralPro');
  if (access.source === 'admin') return t('settings.usage.adminPlan');
  const key = access.planKey.toLowerCase();
  if (key === 'agency') return t('settings.usage.agencyPlan');
  if (key === 'pro') return t('settings.usage.proPlan');
  if (key === 'trial') return t('settings.usage.trialPlan');
  return t('settings.usage.freePlan');
}

function formatDays(days: number | null | undefined, t: Translator): string {
  if (days === 0) return t('settings.usage.lessThanDay');
  if (days === 1) return t('settings.usage.day', { count: days });
  if (typeof days === 'number' && days > 1) return t('settings.usage.days', { count: days });
  return '';
}

export function formatAccessDetail(access: BillingAccessSummary | null | undefined, t: Translator): string {
  if (!access) return t('settings.usage.loadingAccess');
  if (access.source === 'admin') return t('settings.usage.adminAccess');
  if (access.source === 'free') return t('settings.usage.freeAccess');

  const days = formatDays(access.daysRemaining, t);
  if (!days) return t('settings.usage.activeSubscription');

  if (access.source === 'referral_bonus') return t('settings.usage.referralDaysLeft', { days });
  if (access.source === 'paid_trial') return t('settings.usage.trialEndsIn', { days });
  if (access.cancelAtPeriodEnd || !access.renews) return t('settings.usage.endsIn', { days });
  return t('settings.usage.renewsIn', { days });
}

export function formatCompactAccess(access: BillingAccessSummary | null | undefined, t: Translator): string {
  return `${formatPlanName(access, t)} · ${formatAccessDetail(access, t)}`;
}
