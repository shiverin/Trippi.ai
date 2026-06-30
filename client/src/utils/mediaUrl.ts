import { API_BASE_URL } from '../api/baseUrl';

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

function backendRoot(): string {
  if (/^https?:\/\//i.test(API_BASE_URL)) {
    const url = new URL(API_BASE_URL);
    url.pathname = trimTrailingSlash(url.pathname.replace(/\/api\/?$/, ''));
    url.search = '';
    url.hash = '';
    return trimTrailingSlash(url.toString());
  }

  const path = API_BASE_URL.startsWith('/') ? API_BASE_URL : `/${API_BASE_URL}`;
  return trimTrailingSlash(path.replace(/\/api\/?$/, ''));
}

export function resolveMediaUrl(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  if (/^(https?:|data:|blob:)/i.test(trimmed)) return trimmed;
  if (trimmed.startsWith('/')) return trimmed;

  const uploadPath = trimmed.startsWith('uploads/') ? `/${trimmed}` : `/uploads/${trimmed}`;
  return `${backendRoot()}${uploadPath}`;
}
