import { BarChart3, Gift, Loader2, Lock, RefreshCw, ShieldCheck, Sparkles, Users } from 'lucide-react';
import React, { useState } from 'react';
import UpgradePlansModal from '../Billing/UpgradePlansModal';
import { formatAccessDetail, formatPlanName } from '../Billing/accessCopy';
import { formatLimit, useEntitlements } from '../../hooks/useEntitlements';
import { useTranslation } from '../../i18n';
import ReferralDialog from '../Referrals/ReferralDialog';
import { useToast } from '../shared/Toast';
import Section from './Section';

export default function UsageTab(): React.ReactElement {
  const { t } = useTranslation();
  const toast = useToast();
  const entitlementState = useEntitlements();
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const [referralOpen, setReferralOpen] = useState(false);

  const { access, usage, billing, entitlements } = entitlementState;
  const lifetime = usage?.lifetimeTrips;
  const referral = usage?.referralBonus;

  const startUpgrade = (planId?: string) => {
    entitlementState.startUpgrade(planId).catch((err) => {
      toast.info(err instanceof Error ? err.message : t('billing.checkoutUnavailable'));
    });
  };

  const openPortal = () => {
    entitlementState.openBillingPortal().catch((err) => {
      toast.info(err instanceof Error ? err.message : t('settings.usage.portalUnavailable'));
    });
  };

  return (
    <>
      <Section title={t('settings.usage.title')} icon={BarChart3}>
        {entitlementState.loading && !entitlementState.data ? (
          <div className="flex items-center justify-center py-12 text-content-muted">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : (
          <div className="space-y-5">
            <div className="rounded-xl border border-edge bg-surface-secondary p-5">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <div className="mb-3 inline-flex items-center gap-2 rounded-full bg-accent/10 px-3 py-1 text-xs font-semibold text-accent">
                    <Sparkles className="h-3.5 w-3.5" />
                    {t('settings.usage.currentPlan')}
                  </div>
                  <h3 className="text-2xl font-bold text-content">{formatPlanName(access, t)}</h3>
                  <p className="mt-1 text-sm text-content-muted">{formatAccessDetail(access, t)}</p>
                  {access?.activeUntil && (
                    <p className="mt-2 text-xs text-content-faint">
                      {t('settings.usage.activeUntil', {
                        date: new Date(access.activeUntil).toLocaleDateString(),
                      })}
                    </p>
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  {billing?.checkoutAvailable && (
                    <button
                      type="button"
                      className="rounded-lg bg-accent px-3 py-2 text-sm font-semibold text-accent-text disabled:opacity-60"
                      disabled={entitlementState.checkoutLoading}
                      onClick={() => setUpgradeOpen(true)}
                    >
                      {t('settings.usage.upgrade')}
                    </button>
                  )}
                  {billing?.portalAvailable && (
                    <button
                      type="button"
                      className="rounded-lg border border-edge bg-surface-card px-3 py-2 text-sm font-semibold text-content-secondary disabled:opacity-60"
                      disabled={entitlementState.checkoutLoading}
                      onClick={openPortal}
                    >
                      {t('settings.usage.manageBilling')}
                    </button>
                  )}
                  <button
                    type="button"
                    className="rounded-lg border border-edge bg-surface-card px-3 py-2 text-sm font-semibold text-content-secondary"
                    onClick={() => setReferralOpen(true)}
                  >
                    {t('settings.usage.referFriends')}
                  </button>
                </div>
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-3">
              <UsageMetric
                icon={BarChart3}
                label={t('settings.usage.lifetimeTrips')}
                value={`${lifetime?.current ?? 0}/${formatLimit(lifetime?.limit, t('common.loading'))}`}
                detail={t('settings.usage.lifetimeTripsHint')}
                current={lifetime?.current ?? 0}
                limit={lifetime?.limit}
              />
              <UsageMetric
                icon={Lock}
                label={t('settings.usage.lockedTrips')}
                value={String(lifetime?.locked ?? 0)}
                detail={t('settings.usage.lockedTripsHint', { count: lifetime?.editableFreeTrips ?? 5 })}
              />
              <UsageMetric
                icon={Users}
                label={t('settings.usage.tripMembers')}
                value={formatLimit(usage?.groupSize.limit, t('common.loading'))}
                detail={t('settings.usage.tripMembersHint')}
              />
            </div>

            <div className="grid gap-3 md:grid-cols-3">
              <UsageStat
                icon={Gift}
                label={t('settings.usage.referralActiveDays')}
                value={String(referral?.activeDays ?? entitlements?.referralBonus?.daysRemaining ?? 0)}
              />
              <UsageStat
                icon={RefreshCw}
                label={t('settings.usage.referralPendingDays')}
                value={String(referral?.pendingDays ?? entitlements?.referralBonus?.pendingDays ?? 0)}
              />
              <UsageStat
                icon={ShieldCheck}
                label={t('settings.usage.referralMaxDays')}
                value={String(referral?.maxDays ?? entitlements?.referralBonus?.maxDays ?? 90)}
              />
            </div>
          </div>
        )}
      </Section>

      <UpgradePlansModal
        open={upgradeOpen}
        billing={billing}
        access={access}
        checkoutLoading={entitlementState.checkoutLoading}
        onClose={() => setUpgradeOpen(false)}
        onSelect={startUpgrade}
      />
      <ReferralDialog open={referralOpen} onClose={() => setReferralOpen(false)} />
    </>
  );
}

function UsageMetric({
  icon: Icon,
  label,
  value,
  detail,
  current,
  limit,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  detail: string;
  current?: number;
  limit?: number | null;
}): React.ReactElement {
  const pct = typeof current === 'number' && typeof limit === 'number' && limit > 0 ? Math.min(100, (current / limit) * 100) : null;
  return (
    <div className="rounded-xl border border-edge bg-surface-secondary p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <span className="grid h-9 w-9 place-items-center rounded-lg bg-surface-card text-content-secondary">
          <Icon className="h-4 w-4" />
        </span>
        <span className="text-xl font-bold text-content">{value}</span>
      </div>
      <div className="text-sm font-semibold text-content">{label}</div>
      <p className="mt-1 min-h-8 text-xs leading-5 text-content-muted">{detail}</p>
      {pct !== null && (
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-surface-card">
          <div className="h-full rounded-full bg-accent" style={{ width: `${pct}%` }} />
        </div>
      )}
    </div>
  );
}

function UsageStat({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
}): React.ReactElement {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-edge bg-surface-secondary p-4">
      <span className="grid h-9 w-9 flex-shrink-0 place-items-center rounded-lg bg-surface-card text-content-secondary">
        <Icon className="h-4 w-4" />
      </span>
      <span>
        <span className="block text-lg font-bold text-content">{value}</span>
        <span className="block text-xs text-content-muted">{label}</span>
      </span>
    </div>
  );
}
