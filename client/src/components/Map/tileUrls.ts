export const DEFAULT_LEAFLET_TILE_URL = 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png';

export function isStadiaTileUrl(url?: string | null): boolean {
  return !!url && /(^|\.)stadiamaps\.com\//i.test(url);
}

export function normalizeLeafletTileUrl(url?: string | null, fallback = DEFAULT_LEAFLET_TILE_URL): string {
  const trimmed = (url || '').trim();
  if (!trimmed || isStadiaTileUrl(trimmed)) return fallback;
  return trimmed;
}
