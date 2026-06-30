import { ADDON_IDS } from '../addons';
import { getCollabFeaturesAsync, isAddonEnabledAsync } from '../services/adminService';

export interface McpCollabFeatureFlags {
  chat: boolean;
  notes: boolean;
  polls: boolean;
  whatsnext: boolean;
}

export interface McpFeatureFlags {
  mcp: boolean;
  packing: boolean;
  budget: boolean;
  atlas: boolean;
  collab: boolean;
  vacay: boolean;
  journey: boolean;
  collabFeatures: McpCollabFeatureFlags | null;
}

const configuredCacheTtlMs = Number(process.env.MCP_FEATURE_CACHE_TTL_MS ?? 5000);
const CACHE_TTL_MS = Number.isFinite(configuredCacheTtlMs) ? configuredCacheTtlMs : 5000;
let featureFlagsCache: { expiresAt: number; value: McpFeatureFlags } | null = null;

function cacheEnabled(): boolean {
  if (CACHE_TTL_MS <= 0) return false;
  return process.env.NODE_ENV !== 'test' && process.env.VITEST !== 'true';
}

export function clearMcpFeatureFlagCache(): void {
  featureFlagsCache = null;
}

export async function getMcpFeatureFlags(): Promise<McpFeatureFlags> {
  const now = Date.now();
  if (cacheEnabled() && featureFlagsCache && featureFlagsCache.expiresAt > now) {
    return featureFlagsCache.value;
  }

  const [[mcp, packing, budget, atlas, collab, vacay, journey], collabFeatureRows] = await Promise.all([
    Promise.all([
      isAddonEnabledAsync(ADDON_IDS.MCP),
      isAddonEnabledAsync(ADDON_IDS.PACKING),
      isAddonEnabledAsync(ADDON_IDS.BUDGET),
      isAddonEnabledAsync(ADDON_IDS.ATLAS),
      isAddonEnabledAsync(ADDON_IDS.COLLAB),
      isAddonEnabledAsync(ADDON_IDS.VACAY),
      isAddonEnabledAsync(ADDON_IDS.JOURNEY),
    ]),
    getCollabFeaturesAsync(),
  ]);
  const collabFeatures = collab ? collabFeatureRows : null;
  const value = { mcp, packing, budget, atlas, collab, vacay, journey, collabFeatures };

  if (cacheEnabled()) {
    featureFlagsCache = { expiresAt: now + CACHE_TTL_MS, value };
  }

  return value;
}

export async function isMcpAddonEnabledFast(): Promise<boolean> {
  return (await getMcpFeatureFlags()).mcp;
}
