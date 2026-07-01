import { ArrowLeft, Building2, Check, Loader2, Sparkles } from 'lucide-react';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { billingApi } from '../api/client';
import type { BillingEntitlementsResponse, BillingPlanOption } from '../types';
import { getApiErrorMessage } from '../types';

const CHECKOUT_SUCCESS_URL = '/billing/success?session_id={CHECKOUT_SESSION_ID}';

function checkoutCancelUrl(intent: string): string {
  const params = new URLSearchParams();
  if (intent !== 'all') params.set('plan', intent);
  params.set('cancelled', '1');
  return `/billing/checkout?${params.toString()}`;
}

function planIntentFromSearch(search: string): { cancelled: boolean; intent: string } {
  const params = new URLSearchParams(search);
  const rawIntent = params.get('plan')?.trim().toLowerCase();
  return {
    cancelled: params.get('cancelled') === '1',
    intent: rawIntent || 'all',
  };
}

function plansForIntent(plans: BillingPlanOption[], intent: string): BillingPlanOption[] {
  if (intent === 'pro') return plans.filter((plan) => plan.planKey === 'pro');
  if (intent === 'agency') return plans.filter((plan) => plan.planKey === 'agency').slice(0, 1);
  if (intent === 'all') return plans;

  const exactPlan = plans.find((plan) => plan.id === intent);
  if (exactPlan) return [exactPlan];

  return plans.filter((plan) => plan.planKey === intent);
}

function shouldAutoStart(intent: string, visiblePlans: BillingPlanOption[]): boolean {
  return intent !== 'all' && intent !== 'pro' && visiblePlans.length === 1;
}

function titleForIntent(intent: string): string {
  if (intent === 'pro') return 'Choose your Pro term';
  if (intent === 'agency' || intent.startsWith('agency')) return 'Opening Agency checkout';
  return 'Choose your plan';
}

function subtitleForIntent(intent: string): string {
  if (intent === 'pro') return 'Pick one month or 12 months of Pro before heading to secure Stripe checkout.';
  if (intent === 'agency' || intent.startsWith('agency')) return 'Sending you to secure Stripe checkout for Agency.';
  return 'Select a plan to continue to secure Stripe checkout.';
}

export default function BillingCheckoutPage(): React.ReactElement {
  const location = useLocation();
  const { cancelled, intent } = useMemo(() => planIntentFromSearch(location.search), [location.search]);
  const [data, setData] = useState<BillingEntitlementsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [checkoutPlanId, setCheckoutPlanId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const autoStartedKey = useRef<string>('');

  useEffect(() => {
    let ignore = false;
    setLoading(true);
    setError(null);
    billingApi
      .entitlements()
      .then((next) => {
        if (!ignore) setData(next);
      })
      .catch((err) => {
        if (!ignore) setError(getApiErrorMessage(err, 'Unable to load billing plans.'));
      })
      .finally(() => {
        if (!ignore) setLoading(false);
      });
    return () => {
      ignore = true;
    };
  }, []);

  const visiblePlans = useMemo(() => plansForIntent(data?.billing.plans ?? [], intent), [data, intent]);
  const checkoutAvailable = !!data?.billing.checkoutAvailable;

  const startCheckout = useCallback(
    async (planId: string) => {
      setError(null);
      setCheckoutPlanId(planId);
      try {
        const session = await billingApi.checkoutSession({
          planId,
          successUrl: CHECKOUT_SUCCESS_URL,
          cancelUrl: checkoutCancelUrl(intent),
        });
        window.location.assign(session.url);
      } catch (err) {
        setCheckoutPlanId(null);
        setError(getApiErrorMessage(err, 'Unable to start checkout right now.'));
      }
    },
    [intent],
  );

  useEffect(() => {
    if (loading || !data || cancelled || !shouldAutoStart(intent, visiblePlans)) return;
    const plan = visiblePlans[0];
    const key = `${intent}:${plan.id}`;
    if (autoStartedKey.current === key) return;
    autoStartedKey.current = key;

    if (!checkoutAvailable) {
      setError('Checkout is not available yet.');
      return;
    }

    void startCheckout(plan.id);
  }, [cancelled, checkoutAvailable, data, intent, loading, startCheckout, visiblePlans]);

  return (
    <main className="min-h-screen bg-surface-secondary px-4 py-10 text-content">
      <section className="mx-auto flex w-full max-w-3xl flex-col gap-6">
        <Link className="inline-flex items-center gap-2 text-sm font-semibold text-content-muted hover:text-content" to="/">
          <ArrowLeft className="h-4 w-4" />
          Back to Trippi
        </Link>

        <div>
          <h1 className="text-3xl font-bold tracking-tight text-content">{titleForIntent(intent)}</h1>
          <p className="mt-2 text-sm text-content-muted">{subtitleForIntent(intent)}</p>
        </div>

        {cancelled && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-900">
            Checkout was canceled. Choose a plan below whenever you are ready.
          </div>
        )}

        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
            {error}
          </div>
        )}

        {loading && (
          <div className="flex min-h-48 items-center justify-center rounded-2xl border border-edge bg-surface-card">
            <div className="flex items-center gap-3 text-sm font-semibold text-content-muted">
              <Loader2 className="h-5 w-5 animate-spin" />
              Loading billing plans...
            </div>
          </div>
        )}

        {!loading && visiblePlans.length > 0 && (
          <div className={`grid gap-4 ${visiblePlans.length > 1 ? 'md:grid-cols-2' : 'md:max-w-md'}`}>
            {visiblePlans.map((plan) => {
              const isAgency = plan.planKey === 'agency';
              const loadingThisPlan = checkoutPlanId === plan.id;
              return (
                <button
                  key={plan.id}
                  type="button"
                  disabled={!checkoutAvailable || !!checkoutPlanId}
                  onClick={() => void startCheckout(plan.id)}
                  className={`relative flex min-h-[230px] flex-col rounded-xl border p-5 text-left transition hover:-translate-y-0.5 disabled:cursor-default disabled:opacity-60 ${
                    plan.featured ? 'border-accent bg-surface-card shadow-lg' : 'border-edge bg-surface-card'
                  }`}
                >
                  {plan.badge && (
                    <span className="absolute right-4 top-4 rounded-full bg-accent px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-accent-text">
                      {plan.badge}
                    </span>
                  )}
                  <span className="mb-5 grid h-11 w-11 place-items-center rounded-lg bg-surface-secondary text-content-secondary">
                    {isAgency ? <Building2 className="h-5 w-5" /> : <Sparkles className="h-5 w-5" />}
                  </span>
                  <div className="text-base font-semibold text-content">{plan.label}</div>
                  <div className="mt-3 flex flex-wrap items-baseline gap-2">
                    <span className="text-4xl font-bold text-content">{plan.priceLabel}</span>
                    <span className="text-sm text-content-muted">{plan.intervalLabel}</span>
                  </div>
                  <p className="mt-4 text-sm leading-6 text-content-muted">{plan.description}</p>
                  <div className="mt-auto flex items-center gap-2 pt-5 text-sm font-semibold text-content">
                    {loadingThisPlan ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                    Continue to checkout
                  </div>
                </button>
              );
            })}
          </div>
        )}

        {!loading && visiblePlans.length === 0 && (
          <div className="rounded-2xl border border-edge bg-surface-card p-6 text-sm text-content-muted">
            No matching billing plan is configured yet.
          </div>
        )}
      </section>
    </main>
  );
}
