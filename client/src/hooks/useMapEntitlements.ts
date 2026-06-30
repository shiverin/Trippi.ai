import { useEntitlements } from './useEntitlements';

export function hasPremiumMapAccess(planKey?: string | null): boolean {
  return !!planKey && planKey !== 'free';
}

export function useMapEntitlements() {
  const entitlementState = useEntitlements();
  const premiumMapsUnlocked = hasPremiumMapAccess(entitlementState.entitlements?.planKey);

  return {
    ...entitlementState,
    premiumMapsUnlocked,
    freeMapLocked: !premiumMapsUnlocked,
  };
}
