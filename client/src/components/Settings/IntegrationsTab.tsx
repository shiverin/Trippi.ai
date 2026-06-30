import { Check, ChevronDown, ChevronRight, Copy, KeyRound, Plus, RefreshCw, Terminal, Trash2 } from 'lucide-react';
import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { authApi, oauthApi } from '../../api/client';
import { ALL_SCOPES } from '../../api/oauthScopes';
import { formatLimit, isLimitReached, useEntitlements } from '../../hooks/useEntitlements';
import { useTranslation } from '../../i18n';
import { useAddonStore } from '../../store/addonStore';
import type { McpAutomationLimits, ResolvedEntitlements } from '../../types';
import ScopeGroupPicker from '../OAuth/ScopeGroupPicker';
import { LockedState } from '../shared/PremiumGate';
import { useToast } from '../shared/Toast';
import AirTrailConnectionSection from './AirTrailConnectionSection';
import PhotoProvidersSection from './PhotoProvidersSection';
import Section from './Section';

interface OAuthPreset {
  id: string;
  label: string;
  name: string;
  uris: string;
  scopes: string[];
}

const OAUTH_PRESETS: OAuthPreset[] = [
  {
    id: 'claude-web',
    label: 'Claude.ai',
    name: 'Claude.ai',
    uris: 'https://claude.ai/api/mcp/auth_callback',
    scopes: ALL_SCOPES.filter((s) => !s.includes(':delete')),
  },
  {
    id: 'claude-desktop',
    label: 'Claude Desktop',
    name: 'Claude Desktop',
    uris: 'http://localhost',
    scopes: ALL_SCOPES.filter((s) => !s.includes(':delete')),
  },
  {
    id: 'cursor',
    label: 'Cursor',
    name: 'Cursor',
    uris: 'http://localhost',
    scopes: ALL_SCOPES.filter((s) => !s.includes(':delete')),
  },
  {
    id: 'vscode',
    label: 'VS Code',
    name: 'VS Code / Copilot',
    uris: 'http://localhost',
    scopes: ALL_SCOPES.filter((s) => s.endsWith(':read')),
  },
  {
    id: 'windsurf',
    label: 'Windsurf',
    name: 'Windsurf',
    uris: 'http://localhost',
    scopes: ALL_SCOPES.filter((s) => !s.includes(':delete')),
  },
  {
    id: 'zed',
    label: 'Zed',
    name: 'Zed',
    uris: 'http://localhost',
    scopes: ALL_SCOPES.filter((s) => !s.includes(':delete')),
  },
];

interface OAuthClient {
  id: string;
  name: string;
  client_id: string;
  redirect_uris: string[];
  allowed_scopes: string[];
  allows_client_credentials: boolean;
  created_at: string;
  client_secret?: string; // only present on create
}

interface OAuthSession {
  id: number;
  client_id: string;
  client_name: string;
  scopes: string[];
  access_token_expires_at: string;
  refresh_token_expires_at: string;
  created_at: string;
}

interface McpToken {
  id: number;
  name: string;
  token_prefix: string;
  created_at: string;
  last_used_at: string | null;
}

export default function IntegrationsTab(): React.ReactElement {
  const S = useIntegrations();
  return (
    <>
      <PhotoProvidersSection />
      {S.airtrailEnabled && <AirTrailConnectionSection />}
      {S.mcpEnabled && <IntegrationsMcpSection {...S} />}
      <McpTokenModals {...S} />
      <OAuthClientModals {...S} />
    </>
  );
}

function useIntegrations() {
  const { t, locale } = useTranslation();
  const toast = useToast();
  const { isEnabled: addonEnabled, loadAddons } = useAddonStore();
  const mcpEnabled = addonEnabled('mcp');
  const airtrailEnabled = addonEnabled('airtrail');
  const entitlementState = useEntitlements();

  useEffect(() => {
    loadAddons();
  }, [loadAddons]);

  // OAuth clients state
  const [oauthClients, setOauthClients] = useState<OAuthClient[]>([]);
  const [oauthSessions, setOauthSessions] = useState<OAuthSession[]>([]);
  const [oauthCreateOpen, setOauthCreateOpen] = useState(false);
  const [oauthNewName, setOauthNewName] = useState('');
  const [oauthNewUris, setOauthNewUris] = useState('');
  const [oauthNewScopes, setOauthNewScopes] = useState<string[]>([]);
  const [oauthCreating, setOauthCreating] = useState(false);
  const [oauthCreatedClient, setOauthCreatedClient] = useState<OAuthClient | null>(null);
  const [oauthDeleteId, setOauthDeleteId] = useState<string | null>(null);
  const [oauthRevokeId, setOauthRevokeId] = useState<number | null>(null);
  const [oauthRotateId, setOauthRotateId] = useState<string | null>(null);
  const [oauthRotatedSecret, setOauthRotatedSecret] = useState<string | null>(null);
  const [oauthRotating, setOauthRotating] = useState(false);
  // oauthScopesOpen is managed internally by ScopeGroupPicker
  const [oauthScopesExpanded, setOauthScopesExpanded] = useState<Record<string, boolean>>({});
  const [oauthIsMachine, setOauthIsMachine] = useState(false);

  // MCP sub-tab state
  const [activeMcpTab, setActiveMcpTab] = useState<'oauth' | 'apitokens'>('oauth');
  const [configOpenOAuth, setConfigOpenOAuth] = useState(false);
  const [configOpenToken, setConfigOpenToken] = useState(false);

  // MCP state
  const [mcpTokens, setMcpTokens] = useState<McpToken[]>([]);
  const [mcpModalOpen, setMcpModalOpen] = useState(false);
  const [mcpNewName, setMcpNewName] = useState('');
  const [mcpCreatedToken, setMcpCreatedToken] = useState<string | null>(null);
  const [mcpCreating, setMcpCreating] = useState(false);
  const [mcpDeleteId, setMcpDeleteId] = useState<number | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mcpLimits = entitlementState.entitlements?.limits.mcpAutomation;
  const mcpTokenLimit = mcpLimits?.maxTokens;
  const mcpTokenLimitReached = isLimitReached(mcpTokenLimit, mcpTokens.length);

  const handleUpgrade = () => {
    entitlementState.startUpgrade().catch((err) => {
      toast.info(err instanceof Error ? err.message : 'Upgrade checkout is not available yet.');
    });
  };

  useEffect(() => {
    return () => {
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    };
  }, []);

  const mcpEndpoint = `${window.location.origin}/mcp`;
  const mcpJsonConfigOAuth = `{
  "mcpServers": {
    "trippi": {
      "command": "npx",
      "args": [
        "mcp-remote",
        "${mcpEndpoint}",
        "--static-oauth-client-info",
        "{\\"client_id\\": \\"<your_client_id>\\", \\"client_secret\\": \\"<your_client_secret>\\"}"
      ]
    }
  }
}`;
  const mcpJsonConfig = `{
  "mcpServers": {
    "trippi": {
      "command": "npx",
      "args": [
        "mcp-remote",
        "${mcpEndpoint}",
        "--header",
        "Authorization: Bearer <your_token>"
      ]
    }
  }
}`;

  useEffect(() => {
    if (mcpEnabled) {
      authApi.mcpTokens
        .list()
        .then((d) => setMcpTokens(d.tokens || []))
        .catch(() => {});
    }
  }, [mcpEnabled]);

  const handleCreateMcpToken = async () => {
    if (!mcpNewName.trim()) return;
    if (mcpTokenLimitReached) {
      handleUpgrade();
      return;
    }
    setMcpCreating(true);
    try {
      const d = await authApi.mcpTokens.create(mcpNewName.trim());
      setMcpCreatedToken(d.token.raw_token);
      setMcpNewName('');
      setMcpTokens((prev) => [
        {
          id: d.token.id,
          name: d.token.name,
          token_prefix: d.token.token_prefix,
          created_at: d.token.created_at,
          last_used_at: null,
        },
        ...prev,
      ]);
    } catch {
      toast.error(t('settings.mcp.toast.createError'));
    } finally {
      setMcpCreating(false);
    }
  };

  const handleDeleteMcpToken = async (id: number) => {
    try {
      await authApi.mcpTokens.delete(id);
      setMcpTokens((prev) => prev.filter((tk) => tk.id !== id));
      setMcpDeleteId(null);
      toast.success(t('settings.mcp.toast.deleted'));
    } catch {
      toast.error(t('settings.mcp.toast.deleteError'));
    }
  };

  const handleCopy = (text: string, key: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedKey(key);
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
      copyTimerRef.current = setTimeout(() => setCopiedKey(null), 2000);
    });
  };

  // Load OAuth clients and sessions
  useEffect(() => {
    if (mcpEnabled) {
      oauthApi.clients
        .list()
        .then((d) => setOauthClients(d.clients || []))
        .catch(() => {});
      oauthApi.sessions
        .list()
        .then((d) => setOauthSessions(d.sessions || []))
        .catch(() => {});
    }
  }, [mcpEnabled]);

  const handleCreateOAuthClient = async () => {
    if (!oauthNewName.trim()) return;
    if (!oauthIsMachine && !oauthNewUris.trim()) return;
    setOauthCreating(true);
    try {
      const uris = oauthIsMachine
        ? []
        : oauthNewUris
            .split('\n')
            .map((u) => u.trim())
            .filter(Boolean);
      const d = await oauthApi.clients.create({
        name: oauthNewName.trim(),
        redirect_uris: uris,
        allowed_scopes: oauthNewScopes,
        ...(oauthIsMachine ? { allows_client_credentials: true } : {}),
      });
      setOauthCreatedClient(d.client);
      setOauthClients((prev) => [...prev, { ...d.client, client_secret: undefined }]);
      setOauthNewName('');
      setOauthNewUris('');
      setOauthNewScopes([]);
      setOauthIsMachine(false);
    } catch {
      toast.error(t('settings.oauth.toast.createError'));
    } finally {
      setOauthCreating(false);
    }
  };

  const handleDeleteOAuthClient = async (id: string) => {
    try {
      await oauthApi.clients.delete(id);
      setOauthClients((prev) => prev.filter((c) => c.id !== id));
      setOauthDeleteId(null);
      toast.success(t('settings.oauth.toast.deleted'));
    } catch {
      toast.error(t('settings.oauth.toast.deleteError'));
    }
  };

  const handleRotateSecret = async (id: string) => {
    setOauthRotating(true);
    try {
      const d = await oauthApi.clients.rotate(id);
      setOauthRotatedSecret(d.client_secret);
      setOauthRotateId(null);
    } catch {
      toast.error(t('settings.oauth.toast.rotateError'));
    } finally {
      setOauthRotating(false);
    }
  };

  const handleRevokeSession = async (id: number) => {
    try {
      await oauthApi.sessions.revoke(id);
      setOauthSessions((prev) => prev.filter((s) => s.id !== id));
      setOauthRevokeId(null);
      toast.success(t('settings.oauth.toast.revoked'));
    } catch {
      toast.error(t('settings.oauth.toast.revokeError'));
    }
  };

  return {
    t,
    locale,
    toast,
    mcpEnabled,
    airtrailEnabled,
    oauthClients,
    setOauthClients,
    oauthSessions,
    setOauthSessions,
    oauthCreateOpen,
    setOauthCreateOpen,
    oauthNewName,
    setOauthNewName,
    oauthNewUris,
    setOauthNewUris,
    oauthNewScopes,
    setOauthNewScopes,
    oauthCreating,
    oauthCreatedClient,
    setOauthCreatedClient,
    oauthDeleteId,
    setOauthDeleteId,
    oauthRevokeId,
    setOauthRevokeId,
    oauthRotateId,
    setOauthRotateId,
    oauthRotatedSecret,
    setOauthRotatedSecret,
    oauthRotating,
    oauthScopesExpanded,
    setOauthScopesExpanded,
    oauthIsMachine,
    setOauthIsMachine,
    activeMcpTab,
    setActiveMcpTab,
    configOpenOAuth,
    setConfigOpenOAuth,
    configOpenToken,
    setConfigOpenToken,
    mcpTokens,
    setMcpTokens,
    mcpModalOpen,
    setMcpModalOpen,
    mcpNewName,
    setMcpNewName,
    mcpCreatedToken,
    setMcpCreatedToken,
    mcpCreating,
    mcpDeleteId,
    setMcpDeleteId,
    copiedKey,
    entitlementState,
    mcpLimits,
    mcpTokenLimit,
    mcpTokenLimitReached,
    mcpEndpoint,
    mcpJsonConfigOAuth,
    mcpJsonConfig,
    handleUpgrade,
    handleCreateMcpToken,
    handleDeleteMcpToken,
    handleCopy,
    handleCreateOAuthClient,
    handleDeleteOAuthClient,
    handleRotateSecret,
    handleRevokeSession,
  };
}

interface McpAutomationLimitsPanelProps {
  entitlements: ResolvedEntitlements | null;
  limits: McpAutomationLimits | undefined;
  tokenCount: number;
}

function McpAutomationLimitsPanel({ entitlements, limits, tokenCount }: McpAutomationLimitsPanelProps) {
  return (
    <div data-testid="mcp-automation-limits" className="rounded-lg border border-edge bg-surface-secondary p-3">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <p className="text-sm font-semibold text-content">MCP automation limits</p>
        <span className="rounded border border-edge bg-surface-card px-1.5 py-0.5 text-[11px] font-medium text-content-secondary">
          {entitlements?.planKey ?? 'current'} plan
        </span>
      </div>
      <div className="grid gap-2 sm:grid-cols-3">
        <McpLimitBadge label="Static tokens" value={`${tokenCount}/${formatLimit(limits?.maxTokens)}`} />
        <McpLimitBadge label="Concurrent sessions" value={formatLimit(limits?.maxConcurrentSessions)} />
        <McpLimitBadge label="Requests/min" value={formatLimit(limits?.requestsPerMinute)} />
      </div>
    </div>
  );
}

function McpLimitBadge({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-edge bg-surface-card px-2.5 py-2">
      <p className="text-[11px] font-medium uppercase text-content-muted">{label}</p>
      <p className="mt-0.5 text-sm font-semibold text-content">{value}</p>
    </div>
  );
}

function IntegrationsMcpSection(props: any) {
  const {
    t,
    locale,
    toast,
    mcpEnabled,
    oauthClients,
    setOauthClients,
    oauthSessions,
    setOauthSessions,
    oauthCreateOpen,
    setOauthCreateOpen,
    oauthNewName,
    setOauthNewName,
    oauthNewUris,
    setOauthNewUris,
    oauthNewScopes,
    setOauthNewScopes,
    oauthCreating,
    oauthCreatedClient,
    setOauthCreatedClient,
    oauthDeleteId,
    setOauthDeleteId,
    oauthRevokeId,
    setOauthRevokeId,
    oauthRotateId,
    setOauthRotateId,
    oauthRotatedSecret,
    setOauthRotatedSecret,
    oauthRotating,
    oauthScopesExpanded,
    setOauthScopesExpanded,
    oauthIsMachine,
    setOauthIsMachine,
    activeMcpTab,
    setActiveMcpTab,
    configOpenOAuth,
    setConfigOpenOAuth,
    configOpenToken,
    setConfigOpenToken,
    mcpTokens,
    setMcpTokens,
    mcpModalOpen,
    setMcpModalOpen,
    mcpNewName,
    setMcpNewName,
    mcpCreatedToken,
    setMcpCreatedToken,
    mcpCreating,
    mcpDeleteId,
    setMcpDeleteId,
    copiedKey,
    entitlementState,
    mcpLimits,
    mcpTokenLimit,
    mcpTokenLimitReached,
    mcpEndpoint,
    mcpJsonConfigOAuth,
    mcpJsonConfig,
    handleUpgrade,
    handleCreateMcpToken,
    handleDeleteMcpToken,
    handleCopy,
    handleCreateOAuthClient,
    handleDeleteOAuthClient,
    handleRotateSecret,
    handleRevokeSession,
  } = props;
  return (
    <Section title={t('settings.mcp.title')} icon={Terminal}>
      {/* Endpoint URL */}
      <div>
        <div className="mb-1.5 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <label className="block text-sm font-medium text-content-secondary">{t('settings.mcp.endpoint')}</label>
          <Link
            to="/mcp-connect"
            className="inline-flex items-center gap-1.5 rounded-lg border border-edge px-2.5 py-1.5 text-xs font-medium text-content-secondary transition-colors hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            MCP Connect Assistant
            <ChevronRight className="h-3.5 w-3.5" />
          </Link>
        </div>
        <div className="flex items-center gap-2">
          <code className="flex-1 rounded-lg border border-edge bg-surface-secondary px-3 py-2 font-mono text-sm text-content">
            {mcpEndpoint}
          </code>
          <button
            onClick={() => handleCopy(mcpEndpoint, 'endpoint')}
            className="rounded-lg border border-edge p-2 transition-colors hover:bg-slate-100 dark:hover:bg-slate-700"
            title={t('settings.mcp.copy')}
          >
            {copiedKey === 'endpoint' ? (
              <Check className="h-4 w-4 text-green-500" />
            ) : (
              <Copy className="h-4 w-4 text-content-secondary" />
            )}
          </button>
        </div>
      </div>

      <McpAutomationLimitsPanel
        entitlements={entitlementState.entitlements}
        limits={mcpLimits}
        tokenCount={mcpTokens.length}
      />

      {/* Sub-tab bar */}
      <div className="flex gap-1 rounded-lg border border-edge bg-surface-secondary p-1">
        <button
          onClick={() => setActiveMcpTab('oauth')}
          className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
            activeMcpTab === 'oauth'
              ? 'bg-slate-900 text-white'
              : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
          }`}
        >
          {t('settings.oauth.clients')}
        </button>
        <button
          onClick={() => setActiveMcpTab('apitokens')}
          className={`flex flex-1 items-center justify-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
            activeMcpTab === 'apitokens'
              ? 'bg-slate-900 text-white'
              : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
          }`}
        >
          {t('settings.mcp.apiTokens')}
          <span className="rounded border border-[rgba(245,158,11,0.4)] bg-[rgba(245,158,11,0.15)] px-1.5 py-0.5 text-[10px] font-medium text-[#b45309]">
            Deprecated
          </span>
        </button>
      </div>

      {/* OAuth 2.1 Clients tab */}
      {activeMcpTab === 'oauth' && (
        <>
          {/* JSON config — OAuth (collapsible) */}
          <div className="overflow-hidden rounded-lg border border-edge">
            <button
              onClick={() => setConfigOpenOAuth((o) => !o)}
              className="flex w-full items-center justify-between bg-surface-secondary px-3 py-2.5 transition-colors hover:bg-slate-50 dark:hover:bg-slate-800"
            >
              <span className="text-sm font-medium text-content-secondary">{t('settings.mcp.clientConfig')}</span>
              {configOpenOAuth ? (
                <ChevronDown className="h-4 w-4" style={{ color: 'var(--text-tertiary)' }} />
              ) : (
                <ChevronRight className="h-4 w-4" style={{ color: 'var(--text-tertiary)' }} />
              )}
            </button>
            {configOpenOAuth && (
              <div className="border-t border-edge p-3">
                <div className="mb-1.5 flex justify-end">
                  <button
                    onClick={() => handleCopy(mcpJsonConfigOAuth, 'json-oauth')}
                    className="flex items-center gap-1.5 rounded border border-edge px-2.5 py-1 text-xs text-content-secondary transition-colors hover:bg-slate-100 dark:hover:bg-slate-700"
                  >
                    {copiedKey === 'json-oauth' ? (
                      <Check className="h-3 w-3 text-green-500" />
                    ) : (
                      <Copy className="h-3 w-3" />
                    )}
                    {copiedKey === 'json-oauth' ? t('settings.mcp.copied') : t('settings.mcp.copy')}
                  </button>
                </div>
                <pre className="overflow-x-auto rounded-lg border border-edge bg-surface-secondary p-3 font-mono text-xs text-content">
                  {mcpJsonConfigOAuth}
                </pre>
                <p className="mt-1.5 text-xs" style={{ color: 'var(--text-tertiary)' }}>
                  {t('settings.mcp.clientConfigHintOAuth')}
                </p>
              </div>
            )}
          </div>

          <div>
            <p className="mb-3 text-xs" style={{ color: 'var(--text-tertiary)' }}>
              {t('settings.oauth.clientsHint')}
            </p>

            <div className="mb-2 flex justify-end">
              <button
                onClick={() => {
                  setOauthCreateOpen(true);
                  setOauthCreatedClient(null);
                  setOauthNewName('');
                  setOauthNewUris('');
                  setOauthNewScopes([]);
                  setOauthIsMachine(false);
                }}
                className="flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-slate-700"
              >
                <Plus className="h-3.5 w-3.5" /> {t('settings.oauth.createClient')}
              </button>
            </div>

            {oauthClients.length === 0 ? (
              <p
                className="rounded-lg border border-edge py-3 text-center text-sm"
                style={{ color: 'var(--text-tertiary)' }}
              >
                {t('settings.oauth.noClients')}
              </p>
            ) : (
              <div className="overflow-hidden rounded-lg border border-edge">
                {oauthClients.map((client, i) => (
                  <div
                    key={client.id}
                    className={`px-4 py-3 ${i < oauthClients.length - 1 ? 'border-b border-edge' : ''}`}
                  >
                    <div className="flex items-center gap-3">
                      <KeyRound className="h-4 w-4 flex-shrink-0" style={{ color: 'var(--text-tertiary)' }} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <p className="truncate text-sm font-medium text-content">{client.name}</p>
                          {client.allows_client_credentials && (
                            <span className="flex-shrink-0 rounded border border-[rgba(99,102,241,0.3)] bg-[rgba(99,102,241,0.12)] px-1.5 py-0.5 text-[10px] font-medium text-[#4f46e5]">
                              {t('settings.oauth.badge.machine')}
                            </span>
                          )}
                        </div>
                        <p className="mt-0.5 font-mono text-xs" style={{ color: 'var(--text-tertiary)' }}>
                          {t('settings.oauth.clientId')}: {client.client_id}
                          <span className="ml-3 font-sans">
                            {t('settings.mcp.tokenCreatedAt')} {new Date(client.created_at).toLocaleDateString(locale)}
                          </span>
                        </p>
                        <div className="mt-1.5 flex flex-wrap gap-1">
                          {(oauthScopesExpanded[client.id]
                            ? client.allowed_scopes
                            : client.allowed_scopes.slice(0, 5)
                          ).map((s) => (
                            <span
                              key={s}
                              className="rounded border border-edge bg-surface-secondary px-1.5 py-0.5 text-xs"
                              style={{ color: 'var(--text-tertiary)' }}
                            >
                              {s}
                            </span>
                          ))}
                          {client.allowed_scopes.length > 5 && (
                            <button
                              onClick={() =>
                                setOauthScopesExpanded((prev) => ({ ...prev, [client.id]: !prev[client.id] }))
                              }
                              className="rounded border border-edge px-1.5 py-0.5 text-xs transition-colors hover:bg-slate-100 dark:hover:bg-slate-700"
                              style={{ color: 'var(--text-tertiary)' }}
                            >
                              {oauthScopesExpanded[client.id] ? '−' : `+${client.allowed_scopes.length - 5}`}
                            </button>
                          )}
                        </div>
                      </div>
                      <button
                        onClick={() => setOauthRotateId(client.id)}
                        className="rounded-lg p-1.5 transition-colors hover:bg-amber-50 hover:text-amber-600 dark:hover:bg-amber-900/20"
                        style={{ color: 'var(--text-tertiary)' }}
                        title={t('settings.oauth.rotateSecret')}
                      >
                        <RefreshCw className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => setOauthDeleteId(client.id)}
                        className="rounded-lg p-1.5 transition-colors hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/20"
                        style={{ color: 'var(--text-tertiary)' }}
                        title={t('settings.oauth.deleteClient')}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Active OAuth Sessions */}
          {oauthSessions.length > 0 && (
            <div>
              <label className="mb-2 block text-sm font-medium text-content-secondary">
                {t('settings.oauth.activeSessions')}
              </label>
              <div className="overflow-hidden rounded-lg border border-edge">
                {oauthSessions.map((session, i) => (
                  <div
                    key={session.id}
                    className={`flex items-center gap-3 px-4 py-3 ${i < oauthSessions.length - 1 ? 'border-b border-edge' : ''}`}
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-content">{session.client_name}</p>
                      <p className="mt-0.5 text-xs" style={{ color: 'var(--text-tertiary)' }}>
                        {t('settings.oauth.sessionScopes')}: {session.scopes.join(', ')}
                        <span className="ml-3">
                          {t('settings.oauth.sessionExpires')}{' '}
                          {new Date(session.refresh_token_expires_at).toLocaleDateString(locale)}
                        </span>
                      </p>
                    </div>
                    <button
                      onClick={() => setOauthRevokeId(session.id)}
                      className="rounded border border-edge px-2.5 py-1 text-xs transition-colors hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/20"
                      style={{ color: 'var(--text-tertiary)' }}
                    >
                      {t('settings.oauth.revoke')}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {/* API Tokens tab (deprecated) */}
      {activeMcpTab === 'apitokens' && (
        <>
          <div className="flex items-baseline gap-2 rounded-lg border border-[rgba(245,158,11,0.3)] bg-[rgba(245,158,11,0.06)] px-3 py-2.5">
            <span className="flex-shrink-0 leading-none text-amber-500">⚠</span>
            <p className="text-xs text-[#92400e]">{t('settings.mcp.apiTokensDeprecated')}</p>
          </div>

          {/* JSON config — API Token (collapsible) */}
          <div className="overflow-hidden rounded-lg border border-edge">
            <button
              onClick={() => setConfigOpenToken((o) => !o)}
              className="flex w-full items-center justify-between bg-surface-secondary px-3 py-2.5 transition-colors hover:bg-slate-50 dark:hover:bg-slate-800"
            >
              <span className="text-sm font-medium text-content-secondary">{t('settings.mcp.clientConfig')}</span>
              {configOpenToken ? (
                <ChevronDown className="h-4 w-4" style={{ color: 'var(--text-tertiary)' }} />
              ) : (
                <ChevronRight className="h-4 w-4" style={{ color: 'var(--text-tertiary)' }} />
              )}
            </button>
            {configOpenToken && (
              <div className="border-t border-edge p-3">
                <div className="mb-1.5 flex justify-end">
                  <button
                    onClick={() => handleCopy(mcpJsonConfig, 'json-token')}
                    className="flex items-center gap-1.5 rounded border border-edge px-2.5 py-1 text-xs text-content-secondary transition-colors hover:bg-slate-100 dark:hover:bg-slate-700"
                  >
                    {copiedKey === 'json-token' ? (
                      <Check className="h-3 w-3 text-green-500" />
                    ) : (
                      <Copy className="h-3 w-3" />
                    )}
                    {copiedKey === 'json-token' ? t('settings.mcp.copied') : t('settings.mcp.copy')}
                  </button>
                </div>
                <pre className="overflow-x-auto rounded-lg border border-edge bg-surface-secondary p-3 font-mono text-xs text-content">
                  {mcpJsonConfig}
                </pre>
                <p className="mt-1.5 text-xs" style={{ color: 'var(--text-tertiary)' }}>
                  {t('settings.mcp.clientConfigHint')}
                </p>
              </div>
            )}
          </div>

          {mcpTokenLimitReached ? (
            <LockedState
              compact
              title="Static MCP token limit reached"
              description="OAuth clients remain available for MCP access. Static API token creation needs a higher token allowance."
              detail={`${mcpTokens.length}/${formatLimit(mcpTokenLimit)} tokens`}
              upgradeAvailable={!!entitlementState.billing?.checkoutAvailable}
              upgradePending={entitlementState.checkoutLoading}
              onUpgrade={handleUpgrade}
              testId="mcp-token-locked-state"
            />
          ) : (
            <div className="flex justify-end">
              <button
                onClick={() => {
                  setMcpModalOpen(true);
                  setMcpCreatedToken(null);
                  setMcpNewName('');
                }}
                className="flex items-center gap-1.5 rounded-lg bg-surface-tertiary px-3 py-1.5 text-sm font-medium text-content-secondary opacity-60 transition-colors"
              >
                <Plus className="h-3.5 w-3.5" /> {t('settings.mcp.createToken')}
              </button>
            </div>
          )}

          {mcpTokenLimitReached && mcpTokens.length === 0 ? null : mcpTokens.length === 0 ? (
            <p className="py-2 text-center text-sm" style={{ color: 'var(--text-tertiary)' }}>
              {t('settings.mcp.noTokens')}
            </p>
          ) : (
            <div className="overflow-hidden rounded-lg border border-edge">
              {mcpTokens.map((token, i) => (
                <div
                  key={token.id}
                  className={`flex items-center gap-3 px-4 py-3 ${i < mcpTokens.length - 1 ? 'border-b border-edge' : ''}`}
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-content">{token.name}</p>
                    <p className="mt-0.5 font-mono text-xs" style={{ color: 'var(--text-tertiary)' }}>
                      {token.token_prefix}...
                      <span className="ml-3 font-sans">
                        {t('settings.mcp.tokenCreatedAt')} {new Date(token.created_at).toLocaleDateString(locale)}
                      </span>
                      {token.last_used_at && (
                        <span className="ml-2">
                          · {t('settings.mcp.tokenUsedAt')} {new Date(token.last_used_at).toLocaleDateString(locale)}
                        </span>
                      )}
                    </p>
                  </div>
                  <button
                    onClick={() => setMcpDeleteId(token.id)}
                    className="rounded-lg p-1.5 transition-colors hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/20"
                    style={{ color: 'var(--text-tertiary)' }}
                    title={t('settings.mcp.deleteTokenTitle')}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </Section>
  );
}

function McpTokenModals(props: any) {
  const {
    t,
    locale,
    toast,
    mcpEnabled,
    oauthClients,
    setOauthClients,
    oauthSessions,
    setOauthSessions,
    oauthCreateOpen,
    setOauthCreateOpen,
    oauthNewName,
    setOauthNewName,
    oauthNewUris,
    setOauthNewUris,
    oauthNewScopes,
    setOauthNewScopes,
    oauthCreating,
    oauthCreatedClient,
    setOauthCreatedClient,
    oauthDeleteId,
    setOauthDeleteId,
    oauthRevokeId,
    setOauthRevokeId,
    oauthRotateId,
    setOauthRotateId,
    oauthRotatedSecret,
    setOauthRotatedSecret,
    oauthRotating,
    oauthScopesExpanded,
    setOauthScopesExpanded,
    oauthIsMachine,
    setOauthIsMachine,
    activeMcpTab,
    setActiveMcpTab,
    configOpenOAuth,
    setConfigOpenOAuth,
    configOpenToken,
    setConfigOpenToken,
    mcpTokens,
    setMcpTokens,
    mcpModalOpen,
    setMcpModalOpen,
    mcpNewName,
    setMcpNewName,
    mcpCreatedToken,
    setMcpCreatedToken,
    mcpCreating,
    mcpDeleteId,
    setMcpDeleteId,
    copiedKey,
    mcpEndpoint,
    mcpJsonConfigOAuth,
    mcpJsonConfig,
    handleCreateMcpToken,
    handleDeleteMcpToken,
    handleCopy,
    handleCreateOAuthClient,
    handleDeleteOAuthClient,
    handleRotateSecret,
    handleRevokeSession,
  } = props;
  return (
    <>
      {/* Create MCP Token modal */}
      {mcpModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(0,0,0,0.5)] p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget && !mcpCreatedToken) setMcpModalOpen(false);
          }}
        >
          <div className="w-full max-w-md space-y-4 rounded-xl bg-surface-card p-6 shadow-xl">
            {!mcpCreatedToken ? (
              <>
                <h3 className="text-lg font-semibold text-content">{t('settings.mcp.modal.createTitle')}</h3>
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-content-secondary">
                    {t('settings.mcp.modal.tokenName')}
                  </label>
                  <input
                    type="text"
                    value={mcpNewName}
                    onChange={(e) => setMcpNewName(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleCreateMcpToken()}
                    placeholder={t('settings.mcp.modal.tokenNamePlaceholder')}
                    className="w-full rounded-lg border border-edge bg-surface-secondary px-3 py-2.5 text-sm text-content focus:outline-none focus:ring-2 focus:ring-slate-400"
                    autoFocus
                  />
                </div>
                <div className="flex justify-end gap-2 pt-1">
                  <button
                    onClick={() => setMcpModalOpen(false)}
                    className="rounded-lg border border-edge px-4 py-2 text-sm text-content-secondary"
                  >
                    {t('common.cancel')}
                  </button>
                  <button
                    onClick={handleCreateMcpToken}
                    disabled={!mcpNewName.trim() || mcpCreating}
                    className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
                  >
                    {mcpCreating ? t('settings.mcp.modal.creating') : t('settings.mcp.modal.create')}
                  </button>
                </div>
              </>
            ) : (
              <>
                <h3 className="text-lg font-semibold text-content">{t('settings.mcp.modal.createdTitle')}</h3>
                <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-[rgba(251,191,36,0.1)] p-3">
                  <span className="mt-0.5 text-amber-500">⚠</span>
                  <p className="text-sm text-content-secondary">{t('settings.mcp.modal.createdWarning')}</p>
                </div>
                <div className="relative">
                  <pre className="whitespace-pre-wrap break-all rounded-lg border border-edge bg-surface-secondary p-3 pr-10 font-mono text-xs text-content">
                    {mcpCreatedToken}
                  </pre>
                  <button
                    onClick={() => handleCopy(mcpCreatedToken, 'new-token')}
                    className="absolute right-2 top-2 rounded p-1.5 text-content-secondary transition-colors hover:bg-slate-200 dark:hover:bg-slate-600"
                    title={t('settings.mcp.copy')}
                  >
                    {copiedKey === 'new-token' ? (
                      <Check className="h-4 w-4 text-green-500" />
                    ) : (
                      <Copy className="h-4 w-4" />
                    )}
                  </button>
                </div>
                <div className="flex justify-end">
                  <button
                    onClick={() => {
                      setMcpModalOpen(false);
                      setMcpCreatedToken(null);
                    }}
                    className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700"
                  >
                    {t('settings.mcp.modal.done')}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Delete MCP Token confirm */}
      {mcpDeleteId !== null && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(0,0,0,0.5)] p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) setMcpDeleteId(null);
          }}
        >
          <div className="w-full max-w-sm space-y-4 rounded-xl bg-surface-card p-6 shadow-xl">
            <h3 className="text-base font-semibold text-content">{t('settings.mcp.deleteTokenTitle')}</h3>
            <p className="text-sm text-content-secondary">{t('settings.mcp.deleteTokenMessage')}</p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setMcpDeleteId(null)}
                className="rounded-lg border border-edge px-4 py-2 text-sm text-content-secondary"
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={() => handleDeleteMcpToken(mcpDeleteId)}
                className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700"
              >
                {t('settings.mcp.deleteTokenTitle')}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function OAuthClientModals(props: any) {
  const {
    t,
    locale,
    toast,
    mcpEnabled,
    oauthClients,
    setOauthClients,
    oauthSessions,
    setOauthSessions,
    oauthCreateOpen,
    setOauthCreateOpen,
    oauthNewName,
    setOauthNewName,
    oauthNewUris,
    setOauthNewUris,
    oauthNewScopes,
    setOauthNewScopes,
    oauthCreating,
    oauthCreatedClient,
    setOauthCreatedClient,
    oauthDeleteId,
    setOauthDeleteId,
    oauthRevokeId,
    setOauthRevokeId,
    oauthRotateId,
    setOauthRotateId,
    oauthRotatedSecret,
    setOauthRotatedSecret,
    oauthRotating,
    oauthScopesExpanded,
    setOauthScopesExpanded,
    oauthIsMachine,
    setOauthIsMachine,
    activeMcpTab,
    setActiveMcpTab,
    configOpenOAuth,
    setConfigOpenOAuth,
    configOpenToken,
    setConfigOpenToken,
    mcpTokens,
    setMcpTokens,
    mcpModalOpen,
    setMcpModalOpen,
    mcpNewName,
    setMcpNewName,
    mcpCreatedToken,
    setMcpCreatedToken,
    mcpCreating,
    mcpDeleteId,
    setMcpDeleteId,
    copiedKey,
    mcpEndpoint,
    mcpJsonConfigOAuth,
    mcpJsonConfig,
    handleCreateMcpToken,
    handleDeleteMcpToken,
    handleCopy,
    handleCreateOAuthClient,
    handleDeleteOAuthClient,
    handleRotateSecret,
    handleRevokeSession,
  } = props;
  return (
    <>
      {/* Create OAuth Client modal */}
      {oauthCreateOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(0,0,0,0.5)] p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget && !oauthCreatedClient) setOauthCreateOpen(false);
          }}
        >
          <div className="max-h-[90vh] w-full max-w-lg space-y-4 overflow-y-auto rounded-xl bg-surface-card p-6 shadow-xl">
            {!oauthCreatedClient ? (
              <>
                <h3 className="text-lg font-semibold text-content">{t('settings.oauth.modal.createTitle')}</h3>

                <div>
                  <label className="mb-2 block text-xs font-medium" style={{ color: 'var(--text-tertiary)' }}>
                    {t('settings.oauth.modal.presets')}
                  </label>
                  <div className="flex flex-wrap gap-1.5">
                    {OAUTH_PRESETS.map((preset) => (
                      <button
                        key={preset.id}
                        type="button"
                        onClick={() => {
                          setOauthNewName(preset.name);
                          setOauthNewUris(preset.uris);
                          setOauthNewScopes(preset.scopes);
                        }}
                        className="rounded-md border border-edge bg-surface-secondary px-2.5 py-1 text-xs font-medium text-content-secondary transition-colors hover:bg-slate-100 dark:hover:bg-slate-700"
                      >
                        {preset.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="mb-1.5 block text-sm font-medium text-content-secondary">
                    {t('settings.oauth.modal.clientName')}
                  </label>
                  <input
                    type="text"
                    value={oauthNewName}
                    onChange={(e) => setOauthNewName(e.target.value)}
                    placeholder={t('settings.oauth.modal.clientNamePlaceholder')}
                    className="w-full rounded-lg border border-edge bg-surface-secondary px-3 py-2.5 text-sm text-content focus:outline-none focus:ring-2 focus:ring-slate-400"
                    autoFocus
                  />
                </div>

                <label className="flex cursor-pointer items-start gap-2.5">
                  <input
                    type="checkbox"
                    checked={oauthIsMachine}
                    onChange={(e) => setOauthIsMachine(e.target.checked)}
                    className="mt-0.5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                  />
                  <div>
                    <span className="text-sm font-medium text-content-secondary">
                      {t('settings.oauth.modal.machineClient')}
                    </span>
                    <p className="mt-0.5 text-xs" style={{ color: 'var(--text-tertiary)' }}>
                      {t('settings.oauth.modal.machineClientHint')}
                    </p>
                  </div>
                </label>

                {!oauthIsMachine && (
                  <div>
                    <label className="mb-1.5 block text-sm font-medium text-content-secondary">
                      {t('settings.oauth.modal.redirectUris')}
                    </label>
                    <textarea
                      value={oauthNewUris}
                      onChange={(e) => setOauthNewUris(e.target.value)}
                      placeholder={t('settings.oauth.modal.redirectUrisPlaceholder')}
                      rows={3}
                      className="w-full resize-none rounded-lg border border-edge bg-surface-secondary px-3 py-2.5 font-mono text-sm text-content focus:outline-none focus:ring-2 focus:ring-slate-400"
                    />
                    <p className="mt-1 text-xs" style={{ color: 'var(--text-tertiary)' }}>
                      {t('settings.oauth.modal.redirectUrisHint')}
                    </p>
                  </div>
                )}

                <div>
                  <label className="mb-1 block text-sm font-medium text-content-secondary">
                    {t('settings.oauth.modal.scopes')}
                  </label>
                  <p className="mb-2 text-xs" style={{ color: 'var(--text-tertiary)' }}>
                    {t('settings.oauth.modal.scopesHint')}
                  </p>
                  <ScopeGroupPicker selected={oauthNewScopes} onChange={setOauthNewScopes} />
                </div>

                <div className="flex justify-end gap-2 pt-1">
                  <button
                    onClick={() => setOauthCreateOpen(false)}
                    className="rounded-lg border border-edge px-4 py-2 text-sm text-content-secondary"
                  >
                    {t('common.cancel')}
                  </button>
                  <button
                    onClick={handleCreateOAuthClient}
                    disabled={
                      !oauthNewName.trim() ||
                      (!oauthIsMachine && !oauthNewUris.trim()) ||
                      oauthNewScopes.length === 0 ||
                      oauthCreating
                    }
                    className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
                  >
                    {oauthCreating ? t('settings.oauth.modal.creating') : t('settings.oauth.modal.create')}
                  </button>
                </div>
              </>
            ) : (
              <>
                <h3 className="text-lg font-semibold text-content">{t('settings.oauth.modal.createdTitle')}</h3>
                <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-[rgba(251,191,36,0.1)] p-3">
                  <span className="mt-0.5 text-amber-500">⚠</span>
                  <p className="text-sm text-content-secondary">{t('settings.oauth.modal.createdWarning')}</p>
                </div>

                <div className="space-y-3">
                  <div>
                    <label className="mb-1 block text-xs font-medium text-content-secondary">
                      {t('settings.oauth.clientId')}
                    </label>
                    <div className="flex items-center gap-2">
                      <code className="flex-1 rounded-lg border border-edge bg-surface-secondary px-3 py-2 font-mono text-xs text-content">
                        {oauthCreatedClient.client_id}
                      </code>
                      <button
                        onClick={() => handleCopy(oauthCreatedClient.client_id, 'new-client-id')}
                        className="rounded-lg border border-edge p-2 transition-colors hover:bg-slate-100 dark:hover:bg-slate-700"
                      >
                        {copiedKey === 'new-client-id' ? (
                          <Check className="h-4 w-4 text-green-500" />
                        ) : (
                          <Copy className="h-4 w-4 text-content-secondary" />
                        )}
                      </button>
                    </div>
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-content-secondary">
                      {t('settings.oauth.clientSecret')}
                    </label>
                    <div className="flex items-center gap-2">
                      <code className="flex-1 break-all rounded-lg border border-edge bg-surface-secondary px-3 py-2 font-mono text-xs text-content">
                        {oauthCreatedClient.client_secret}
                      </code>
                      <button
                        onClick={() => handleCopy(oauthCreatedClient.client_secret!, 'new-client-secret')}
                        className="rounded-lg border border-edge p-2 transition-colors hover:bg-slate-100 dark:hover:bg-slate-700"
                      >
                        {copiedKey === 'new-client-secret' ? (
                          <Check className="h-4 w-4 text-green-500" />
                        ) : (
                          <Copy className="h-4 w-4 text-content-secondary" />
                        )}
                      </button>
                    </div>
                  </div>
                </div>

                {oauthCreatedClient?.allows_client_credentials && (
                  <div
                    className="rounded-lg border border-edge bg-surface-secondary p-3 font-mono text-xs"
                    style={{ color: 'var(--text-tertiary)' }}
                  >
                    {t('settings.oauth.modal.machineClientUsage')}
                  </div>
                )}

                <div className="flex justify-end">
                  <button
                    onClick={() => {
                      setOauthCreateOpen(false);
                      setOauthCreatedClient(null);
                    }}
                    className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700"
                  >
                    {t('settings.mcp.modal.done')}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Delete OAuth Client confirm */}
      {oauthDeleteId !== null && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(0,0,0,0.5)] p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) setOauthDeleteId(null);
          }}
        >
          <div className="w-full max-w-sm space-y-4 rounded-xl bg-surface-card p-6 shadow-xl">
            <h3 className="text-base font-semibold text-content">{t('settings.oauth.deleteClient')}</h3>
            <p className="text-sm text-content-secondary">{t('settings.oauth.deleteClientMessage')}</p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setOauthDeleteId(null)}
                className="rounded-lg border border-edge px-4 py-2 text-sm text-content-secondary"
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={() => handleDeleteOAuthClient(oauthDeleteId)}
                className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700"
              >
                {t('settings.oauth.deleteClient')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Rotate OAuth Client Secret confirm */}
      {oauthRotateId !== null && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(0,0,0,0.5)] p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) setOauthRotateId(null);
          }}
        >
          <div className="w-full max-w-sm space-y-4 rounded-xl bg-surface-card p-6 shadow-xl">
            <h3 className="text-base font-semibold text-content">{t('settings.oauth.rotateSecret')}</h3>
            <p className="text-sm text-content-secondary">{t('settings.oauth.rotateSecretMessage')}</p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setOauthRotateId(null)}
                className="rounded-lg border border-edge px-4 py-2 text-sm text-content-secondary"
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={() => handleRotateSecret(oauthRotateId)}
                disabled={oauthRotating}
                className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
              >
                {oauthRotating ? t('settings.oauth.rotateSecretConfirming') : t('settings.oauth.rotateSecretConfirm')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Rotated Secret display */}
      {oauthRotatedSecret !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(0,0,0,0.5)] p-4">
          <div className="w-full max-w-md space-y-4 rounded-xl bg-surface-card p-6 shadow-xl">
            <h3 className="text-lg font-semibold text-content">{t('settings.oauth.rotateSecretDoneTitle')}</h3>
            <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-[rgba(251,191,36,0.1)] p-3">
              <span className="mt-0.5 text-amber-500">⚠</span>
              <p className="text-sm text-content-secondary">{t('settings.oauth.rotateSecretDoneWarning')}</p>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-content-secondary">
                {t('settings.oauth.clientSecret')}
              </label>
              <div className="flex items-center gap-2">
                <code className="flex-1 break-all rounded-lg border border-edge bg-surface-secondary px-3 py-2 font-mono text-xs text-content">
                  {oauthRotatedSecret}
                </code>
                <button
                  onClick={() => handleCopy(oauthRotatedSecret, 'rotated-secret')}
                  className="rounded-lg border border-edge p-2 transition-colors hover:bg-slate-100 dark:hover:bg-slate-700"
                >
                  {copiedKey === 'rotated-secret' ? (
                    <Check className="h-4 w-4 text-green-500" />
                  ) : (
                    <Copy className="h-4 w-4 text-content-secondary" />
                  )}
                </button>
              </div>
            </div>
            <div className="flex justify-end">
              <button
                onClick={() => setOauthRotatedSecret(null)}
                className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700"
              >
                {t('settings.mcp.modal.done')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Revoke OAuth Session confirm */}
      {oauthRevokeId !== null && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(0,0,0,0.5)] p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) setOauthRevokeId(null);
          }}
        >
          <div className="w-full max-w-sm space-y-4 rounded-xl bg-surface-card p-6 shadow-xl">
            <h3 className="text-base font-semibold text-content">{t('settings.oauth.revokeSession')}</h3>
            <p className="text-sm text-content-secondary">{t('settings.oauth.revokeSessionMessage')}</p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setOauthRevokeId(null)}
                className="rounded-lg border border-edge px-4 py-2 text-sm text-content-secondary"
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={() => handleRevokeSession(oauthRevokeId)}
                className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700"
              >
                {t('settings.oauth.revoke')}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
