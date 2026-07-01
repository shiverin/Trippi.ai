import { useCallback, useEffect, useState } from 'react';
import { billingApi } from '../api/client';
import type { BillingEntitlementsResponse, EntitlementLimit } from '../types';

export function limitAllows(limit: EntitlementLimit | undefined, current: number, requested = 1): boolean {
  if (limit === undefined || limit === null) return true;
  return current + requested <= limit;
}

export function isLimitReached(limit: EntitlementLimit | undefined, current: number): boolean {
  if (limit === undefined || limit === null) return false;
  return current >= limit;
}

export function formatLimit(limit: EntitlementLimit | undefined, fallback = 'Checking'): string {
  if (limit === undefined) return fallback;
  if (limit === null) return 'Unlimited';
  return String(limit);
}

export function useEntitlements() {
  const [data, setData] = useState<BillingEntitlementsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const next = await billingApi.entitlements();
      setData(next);
      return next;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load entitlements';
      setError(message);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    billingApi
      .entitlements()
      .then((next) => {
        if (!cancelled) setData(next);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load entitlements');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const startUpgrade = useCallback(
    async (planId?: string | null) => {
      const targetPlanId = planId ?? data?.billing.defaultPlanId ?? null;
      if (!data?.billing.checkoutAvailable || !targetPlanId) {
        throw new Error('Upgrade checkout is not available yet.');
      }

      setCheckoutLoading(true);
      try {
        const session = await billingApi.checkoutSession({ planId: targetPlanId });
        window.location.assign(session.url);
      } finally {
        setCheckoutLoading(false);
      }
    },
    [data]
  );

  const openBillingPortal = useCallback(async () => {
    if (!data?.billing.portalAvailable) {
      throw new Error('Billing portal is not available yet.');
    }

    setCheckoutLoading(true);
    try {
      const session = await billingApi.portalSession({ returnUrl: '/settings?tab=usage' });
      window.location.assign(session.url);
    } finally {
      setCheckoutLoading(false);
    }
  }, [data]);

  return {
    data,
    entitlements: data?.entitlements ?? null,
    access: data?.access ?? null,
    usage: data?.usage ?? null,
    billing: data?.billing ?? null,
    loading,
    checkoutLoading,
    error,
    load,
    startUpgrade,
    openBillingPortal,
  };
}
