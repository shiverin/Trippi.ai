import { BarChart3, Loader2, Sparkles, Users } from 'lucide-react';
import React, { useEffect, useState } from 'react';
import { referralsApi } from '../../api/client';
import UpgradePlansModal from '../Billing/UpgradePlansModal';
import { formatAccessDetail, formatPlanName } from '../Billing/accessCopy';
import { useEntitlements } from '../../hooks/useEntitlements';
import { useTranslation } from '../../i18n';
import type { ReferralSummary } from '../../types';
import ReferralDialog from '../Referrals/ReferralDialog';
import { useToast } from '../shared/Toast';
import Section from './Section';

export default function UsageTab(): React.ReactElement {
  const { t } = useTranslation();
  const toast = useToast();
  const entitlementState = useEntitlements();
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const [referralOpen, setReferralOpen] = useState(false);
  const [referralSummary, setReferralSummary] = useState<ReferralSummary | null>(null);

  const { access, billing } = entitlementState;

  useEffect(() => {
    let cancelled = false;
    referralsApi
      .me()
      .then((summary) => {
        if (!cancelled) setReferralSummary(summary);
      })
      .catch(() => {
        if (!cancelled) setReferralSummary(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

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

            <div className="grid gap-3 sm:grid-cols-2">
              <UsageStat
                icon={BarChart3}
                label={t('settings.usage.daysRemaining')}
                value={formatRemainingDays(access, t)}
              />
              <UsageStat
                icon={Users}
                label={t('settings.usage.friendsReferred')}
                value={String(referralSummary?.successful_referrals ?? 0)}
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

function formatRemainingDays(access: ReturnType<typeof useEntitlements>['access'], t: (key: string, params?: Record<string, unknown>) => string): string {
  if (!access || access.source === 'free') return '0';
  if (access.source === 'admin') return 'Unlimited';
  if (access.daysRemaining === 0) return t('settings.usage.lessThanDay');
  if (typeof access.daysRemaining === 'number') {
    return t(access.daysRemaining === 1 ? 'settings.usage.day' : 'settings.usage.days', { count: access.daysRemaining });
  }
  return t('settings.usage.activeSubscription');
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
