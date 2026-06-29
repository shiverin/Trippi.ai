const DEFAULT_API_BASE_URL = '/api'

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '')
}

function normalizeBaseUrl(value: string | undefined): string {
  const trimmed = value?.trim()
  return trimTrailingSlash(trimmed || DEFAULT_API_BASE_URL) || DEFAULT_API_BASE_URL
}

export const API_BASE_URL = normalizeBaseUrl(import.meta.env.VITE_API_BASE_URL)

export function apiUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) return path
  const normalizedPath = path.startsWith('/') ? path : `/${path}`
  if (API_BASE_URL === DEFAULT_API_BASE_URL && normalizedPath.startsWith(`${DEFAULT_API_BASE_URL}/`)) {
    return normalizedPath
  }
  return `${API_BASE_URL}${normalizedPath}`
}

function apiBaseAsUrl(): URL {
  return /^https?:\/\//i.test(API_BASE_URL)
    ? new URL(API_BASE_URL)
    : new URL(API_BASE_URL, window.location.origin)
}

export function websocketUrl(wsToken: string): string {
  const configuredWsBase = import.meta.env.VITE_WS_BASE_URL?.trim()
  if (configuredWsBase) {
    return `${trimTrailingSlash(configuredWsBase)}/ws?token=${encodeURIComponent(wsToken)}`
  }

  const apiBase = apiBaseAsUrl()
  const protocol = apiBase.protocol === 'https:' ? 'wss:' : 'ws:'
  const pathPrefix = trimTrailingSlash(apiBase.pathname.replace(/\/api\/?$/, ''))
  return `${protocol}//${apiBase.host}${pathPrefix}/ws?token=${encodeURIComponent(wsToken)}`
}
