import { Building2, Check, Loader2, Sparkles, X } from 'lucide-react';
import React from 'react';
import ReactDOM from 'react-dom';
import { useTranslation } from '../../i18n';
import type { BillingAccessSummary, BillingUpgradeAvailability } from '../../types';
import PlanStatusBadge from './PlanStatusBadge';

interface UpgradePlansModalProps {
  open: boolean;
  billing: BillingUpgradeAvailability | null | undefined;
  access?: BillingAccessSummary | null;
  checkoutLoading?: boolean;
  onClose: () => void;
  onSelect: (planId: string) => void;
}

export default function UpgradePlansModal({
  open,
  billing,
  access,
  checkoutLoading = false,
  onClose,
  onSelect,
}: UpgradePlansModalProps): React.ReactElement | null {
  const { t } = useTranslation();
  if (!open) return null;
  const plans = billing?.plans ?? [];

  return ReactDOM.createPortal(
    <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/45 p-4 backdrop-blur-sm">
      <div className="w-full max-w-3xl overflow-hidden rounded-2xl border border-edge bg-surface-card shadow-2xl">
        <div className="flex items-center justify-between border-b border-edge px-5 py-4">
          <div>
            <h2 className="text-base font-semibold text-content">{t('billing.upgradeTitle')}</h2>
            <p className="text-xs text-content-muted">{t('billing.upgradeSubtitle')}</p>
          </div>
          <button className="rounded-lg p-2 text-content-muted hover:bg-surface-secondary" onClick={onClose}>
            <X className="h-4 w-4" />
          </button>
        </div>

        {access && (
          <div className="border-b border-edge px-5 py-4">
            <PlanStatusBadge access={access} />
          </div>
        )}

        <div className="grid gap-3 p-5 md:grid-cols-3">
          {plans.map((plan) => {
            const isAgency = plan.planKey === 'agency';
            return (
              <button
                key={plan.id}
                type="button"
                disabled={!billing?.checkoutAvailable || checkoutLoading}
                onClick={() => onSelect(plan.id)}
                className={`relative flex min-h-[220px] flex-col rounded-xl border p-4 text-left transition hover:-translate-y-0.5 disabled:cursor-default disabled:opacity-60 ${
                  plan.featured ? 'border-accent bg-surface-secondary shadow-lg' : 'border-edge bg-surface-card'
                }`}
              >
                {plan.badge && (
                  <span className="absolute right-3 top-3 rounded-full bg-accent px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-accent-text">
                    {plan.badge}
                  </span>
                )}
                <span className="mb-4 grid h-10 w-10 place-items-center rounded-lg bg-surface-secondary text-content-secondary">
                  {isAgency ? <Building2 className="h-5 w-5" /> : <Sparkles className="h-5 w-5" />}
                </span>
                <div className="text-sm font-semibold text-content">{plan.label}</div>
                <div className="mt-2 flex items-baseline gap-2">
                  <span className="text-3xl font-bold text-content">{plan.priceLabel}</span>
                  <span className="text-xs text-content-muted">{plan.intervalLabel}</span>
                </div>
                <p className="mt-3 min-h-10 text-sm leading-5 text-content-muted">{plan.description}</p>
                <div className="mt-auto flex items-center gap-2 pt-4 text-sm font-semibold text-content">
                  {checkoutLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                  {billing?.checkoutAvailable ? t('billing.choosePlan') : t('billing.checkoutUnavailable')}
                </div>
              </button>
            );
          })}
          {plans.length === 0 && (
            <div className="col-span-full rounded-xl border border-edge bg-surface-secondary p-5 text-sm text-content-muted">
              {t('billing.noPlans')}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
