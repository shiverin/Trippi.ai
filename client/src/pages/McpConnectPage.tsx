import type { LucideIcon } from 'lucide-react';
import {
  Bot,
  Check,
  ClipboardCheck,
  Copy,
  Hotel,
  KeyRound,
  Loader2,
  Luggage,
  MessageSquare,
  Plane,
  Plus,
  RefreshCw,
  ShieldCheck,
  Terminal,
} from 'lucide-react';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { oauthApi } from '../api/client';
import PageShell from '../components/Layout/PageShell';
import ScopeGroupPicker from '../components/OAuth/ScopeGroupPicker';
import { useToast } from '../components/shared/Toast';
import { useTranslation } from '../i18n';

interface OAuthClient {
  id: string;
  name: string;
  client_id: string;
  redirect_uris: string[];
  allowed_scopes: string[];
  allows_client_credentials?: boolean;
  created_at: string;
  client_secret?: string;
}

type AssistantId = 'claude-desktop' | 'claude-ai' | 'chatgpt' | 'cursor' | 'vscode' | 'windsurf' | 'zed';

interface AssistantPreset {
  id: AssistantId;
  name: string;
  label: string;
  description: string;
  redirectUri: string;
  instructionKind: 'json' | 'remote' | 'chatgpt';
  icon: LucideIcon;
}

interface WorkflowPreset {
  id: string;
  name: string;
  description: string;
  scopes: string[];
}

interface AgentRecipe {
  id: string;
  name: string;
  description: string;
  icon: LucideIcon;
  requiredScopes: string[];
  expectedOutputs: string[];
}

const READ_ONLY_SCOPES = [
  'trips:read',
  'places:read',
  'reservations:read',
  'packing:read',
  'todos:read',
  'budget:read',
  'atlas:read',
  'journey:read',
  'geo:read',
  'weather:read',
];

const ASSISTANTS: AssistantPreset[] = [
  {
    id: 'claude-desktop',
    name: 'Claude Desktop',
    label: 'Claude Desktop',
    description: 'Local desktop setup using mcp-remote and browser approval.',
    redirectUri: 'http://localhost',
    instructionKind: 'json',
    icon: Terminal,
  },
  {
    id: 'claude-ai',
    name: 'Claude.ai',
    label: 'Claude.ai',
    description: 'Remote custom connector setup for Claude accounts that support it.',
    redirectUri: 'https://claude.ai/api/mcp/auth_callback',
    instructionKind: 'remote',
    icon: MessageSquare,
  },
  {
    id: 'chatgpt',
    name: 'ChatGPT',
    label: 'ChatGPT',
    description: 'Custom MCP app setup for eligible ChatGPT workspaces.',
    redirectUri: '',
    instructionKind: 'chatgpt',
    icon: Bot,
  },
  {
    id: 'cursor',
    name: 'Cursor',
    label: 'Cursor',
    description: 'Add Trippi as an MCP server in Cursor settings.',
    redirectUri: 'http://localhost',
    instructionKind: 'json',
    icon: Terminal,
  },
  {
    id: 'vscode',
    name: 'VS Code / Copilot',
    label: 'VS Code',
    description: 'Read-focused setup for VS Code MCP configuration.',
    redirectUri: 'http://localhost',
    instructionKind: 'json',
    icon: Terminal,
  },
  {
    id: 'windsurf',
    name: 'Windsurf',
    label: 'Windsurf',
    description: 'Use an MCP JSON server entry with OAuth credentials.',
    redirectUri: 'http://localhost',
    instructionKind: 'json',
    icon: Terminal,
  },
  {
    id: 'zed',
    name: 'Zed',
    label: 'Zed',
    description: 'Use an MCP JSON server entry with OAuth credentials.',
    redirectUri: 'http://localhost',
    instructionKind: 'json',
    icon: Terminal,
  },
];

const WORKFLOWS: WorkflowPreset[] = [
  {
    id: 'read',
    name: 'Trip Q&A and summaries',
    description: 'Ask what is planned, compare days, summarize reservations, and review trip context.',
    scopes: READ_ONLY_SCOPES,
  },
  {
    id: 'planning',
    name: 'Planning help',
    description: 'Let an assistant draft places, todos, packing items, reservations, and budget changes.',
    scopes: [
      ...READ_ONLY_SCOPES,
      'trips:write',
      'places:write',
      'reservations:write',
      'packing:write',
      'todos:write',
      'budget:write',
    ],
  },
  {
    id: 'packing',
    name: 'Packing and tasks',
    description: 'Manage trip checklists without exposing budget or reservation write access.',
    scopes: ['trips:read', 'packing:read', 'packing:write', 'todos:read', 'todos:write'],
  },
  {
    id: 'budget',
    name: 'Budget review',
    description: 'Read and update trip costs while keeping itinerary editing out of scope.',
    scopes: ['trips:read', 'budget:read', 'budget:write'],
  },
  {
    id: 'journey',
    name: 'Journey publishing',
    description: 'Work with Journey entries and share links from existing trip context.',
    scopes: ['trips:read', 'places:read', 'journey:read', 'journey:write', 'journey:share'],
  },
];

const AGENT_RECIPES: AgentRecipe[] = [
  {
    id: 'cheaper-hotels',
    name: 'Find cheaper hotels',
    description: 'Compare current stays with lower-cost options near saved places and trip dates.',
    icon: Hotel,
    requiredScopes: ['trips:read', 'places:read', 'reservations:read', 'budget:read', 'geo:read'],
    expectedOutputs: [
      'Lower-cost stay shortlist with location tradeoffs',
      'Savings comparison against booked or planned lodging',
      'Provider handoff checklist for the traveler to book',
    ],
  },
  {
    id: 'monitor-flights',
    name: 'Monitor flights',
    description: 'Track flight details, fare/status notes, and follow-up tasks from data the assistant can access.',
    icon: Plane,
    requiredScopes: ['trips:read', 'reservations:read', 'todos:read', 'todos:write', 'budget:read'],
    expectedOutputs: [
      'Flight watch criteria and current reservation snapshot',
      'Change summary for fares, timing, or disruption notes',
      'Todo reminders for traveler review and provider action',
    ],
  },
  {
    id: 'rebalance-itinerary',
    name: 'Rebalance itinerary',
    description: 'Reshuffle days around geography, weather, time windows, and existing trip priorities.',
    icon: RefreshCw,
    requiredScopes: [
      'trips:read',
      'places:read',
      'places:write',
      'todos:read',
      'todos:write',
      'budget:read',
      'geo:read',
      'weather:read',
    ],
    expectedOutputs: [
      'Day-by-day move plan with rationale',
      'Drafted place and task updates inside Trippi',
      'Open decisions that still need traveler approval',
    ],
  },
  {
    id: 'packing-plan',
    name: 'Generate packing plan',
    description: 'Create destination-aware packing lists from itinerary, reservations, weather, and trip tasks.',
    icon: Luggage,
    requiredScopes: [
      'trips:read',
      'places:read',
      'reservations:read',
      'packing:read',
      'packing:write',
      'todos:read',
      'todos:write',
      'weather:read',
    ],
    expectedOutputs: [
      'Weather-aware packing checklist grouped by bag or category',
      'Missing-item todos for purchases, laundry, or documents',
      'Readiness notes for destination-specific essentials',
    ],
  },
  {
    id: 'trip-readiness',
    name: 'Summarize trip readiness',
    description: 'Audit what is booked, planned, packed, budgeted, and still unresolved before departure.',
    icon: ClipboardCheck,
    requiredScopes: [
      'trips:read',
      'places:read',
      'reservations:read',
      'packing:read',
      'todos:read',
      'budget:read',
      'journey:read',
      'weather:read',
    ],
    expectedOutputs: [
      'Readiness summary across itinerary, reservations, packing, todos, and budget',
      'Risk list for missing bookings, documents, or timing conflicts',
      'Prioritized next-action checklist for the traveler',
    ],
  },
];

function getAssistant(id: AssistantId): AssistantPreset {
  return ASSISTANTS.find((assistant) => assistant.id === id) ?? ASSISTANTS[0];
}

function createJsonConfig(endpoint: string, clientId: string, clientSecret: string): string {
  return JSON.stringify(
    {
      mcpServers: {
        trippi: {
          command: 'npx',
          args: [
            'mcp-remote',
            endpoint,
            '--static-oauth-client-info',
            JSON.stringify({ client_id: clientId, client_secret: clientSecret }),
          ],
        },
      },
    },
    null,
    2
  );
}

function createRemoteInstructions(
  assistant: AssistantPreset,
  endpoint: string,
  clientId: string,
  clientSecret: string
): string {
  if (assistant.instructionKind === 'chatgpt') {
    return [
      'ChatGPT custom MCP app setup',
      '',
      '1. In an eligible ChatGPT workspace, open the app management page or Settings > Connectors > Developer mode and create or link a custom remote MCP app.',
      '2. Use this MCP server URL:',
      `   ${endpoint}`,
      '3. Configure OAuth for the app. ChatGPT will show a redirect URL in app management, such as https://chatgpt.com/connector/oauth/{callback_id}.',
      '4. Add that exact redirect URL to this Trippi OAuth client before connecting.',
      '5. Use this Trippi OAuth client:',
      `   client_id: ${clientId}`,
      `   client_secret: ${clientSecret}`,
      '6. Test the app in ChatGPT after your workspace admin enables, links, or publishes it.',
    ].join('\n');
  }

  if (assistant.id === 'claude-ai') {
    return [
      'Claude custom connector setup',
      '',
      '1. In Claude, open Customize > Connectors. Team and Enterprise owners may need Organization settings > Connectors.',
      '2. Add a custom Web connector using this remote MCP server URL:',
      `   ${endpoint}`,
      '3. In Advanced settings, provide OAuth Client ID and OAuth Client Secret when Claude asks for them.',
      `   client_id: ${clientId}`,
      `   client_secret: ${clientSecret}`,
      '4. Connect the custom connector and approve the Trippi OAuth prompt.',
      '',
      'Note: Claude remote connectors connect from Anthropic cloud infrastructure, so this Trippi URL must be reachable from the public internet.',
    ].join('\n');
  }

  return [
    `${assistant.name} MCP setup`,
    '',
    `MCP server URL: ${endpoint}`,
    `OAuth client_id: ${clientId}`,
    `OAuth client_secret: ${clientSecret}`,
    '',
    'Use OAuth 2.1 when the assistant asks for authentication. The first connection opens a browser approval screen.',
  ].join('\n');
}

function scopePreview(scopes: string[]): string {
  if (scopes.length <= 5) return scopes.join(', ');
  return `${scopes.slice(0, 5).join(', ')} +${scopes.length - 5} more`;
}

export default function McpConnectPage(): React.ReactElement {
  const { t, locale } = useTranslation();
  const toast = useToast();
  const [assistantId, setAssistantId] = useState<AssistantId>('claude-desktop');
  const assistant = getAssistant(assistantId);
  const [clients, setClients] = useState<OAuthClient[]>([]);
  const [selectedClientId, setSelectedClientId] = useState<string>('');
  const [clientsLoading, setClientsLoading] = useState(true);
  const [clientsError, setClientsError] = useState(false);
  const [newClientName, setNewClientName] = useState(assistant.name);
  const [redirectUris, setRedirectUris] = useState(assistant.redirectUri);
  const [selectedWorkflowId, setSelectedWorkflowId] = useState('read');
  const [selectedScopes, setSelectedScopes] = useState<string[]>(WORKFLOWS[0].scopes);
  const [creating, setCreating] = useState(false);
  const [createdClient, setCreatedClient] = useState<OAuthClient | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const endpoint = `${window.location.origin}/mcp`;
  const selectedClient = clients.find((client) => client.id === selectedClientId) ?? null;
  const instructionClient = createdClient ?? selectedClient;
  const clientId = instructionClient?.client_id ?? '<client_id>';
  const clientSecret = createdClient?.client_secret ?? '<client_secret>';

  const setupInstructions = useMemo(() => {
    if (assistant.instructionKind === 'json') return createJsonConfig(endpoint, clientId, clientSecret);
    return createRemoteInstructions(assistant, endpoint, clientId, clientSecret);
  }, [assistant, endpoint, clientId, clientSecret]);

  const loadClients = useCallback(async () => {
    setClientsLoading(true);
    setClientsError(false);
    try {
      const data = await oauthApi.clients.list();
      const nextClients = data.clients || [];
      setClients(nextClients);
      setSelectedClientId((current) =>
        nextClients.some((client) => client.id === current) ? current : nextClients[0]?.id || ''
      );
    } catch {
      setClientsError(true);
    } finally {
      setClientsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadClients();
  }, [loadClients]);

  useEffect(() => {
    return () => {
      if (copyTimer.current) clearTimeout(copyTimer.current);
    };
  }, []);

  const handleAssistantChange = (id: AssistantId) => {
    const nextAssistant = getAssistant(id);
    setAssistantId(id);
    setNewClientName(nextAssistant.name);
    setRedirectUris(nextAssistant.redirectUri);
    setCreatedClient(null);
  };

  const handleWorkflowApply = (workflow: WorkflowPreset) => {
    setSelectedWorkflowId(workflow.id);
    setSelectedScopes(workflow.scopes);
  };

  const handleRecipeApply = (recipe: AgentRecipe) => {
    setSelectedWorkflowId(`recipe-${recipe.id}`);
    setSelectedScopes(recipe.requiredScopes);
  };

  const handleCopy = async (text: string, key: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      if (copyTimer.current) clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopiedKey(null), 2000);
    } catch {
      toast.error('Could not copy to clipboard');
    }
  };

  const handleCreateClient = async () => {
    const uris = redirectUris
      .split('\n')
      .map((uri) => uri.trim())
      .filter(Boolean);
    if (!newClientName.trim() || uris.length === 0 || selectedScopes.length === 0) return;

    setCreating(true);
    try {
      const data = await oauthApi.clients.create({
        name: newClientName.trim(),
        redirect_uris: uris,
        allowed_scopes: selectedScopes,
      });
      const client = data.client as OAuthClient;
      setCreatedClient(client);
      setSelectedClientId(client.id);
      setClients((prev) => [{ ...client, client_secret: undefined }, ...prev.filter((c) => c.id !== client.id)]);
      toast.success('OAuth client created');
    } catch {
      toast.error('Failed to create OAuth client');
    } finally {
      setCreating(false);
    }
  };

  const createDisabled = !newClientName.trim() || !redirectUris.trim() || selectedScopes.length === 0 || creating;

  return (
    <PageShell background="var(--bg-secondary)">
      <main className="w-full px-4 py-8 sm:px-6 lg:px-8">
        <div className="mb-6 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div className="max-w-3xl">
            <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-edge bg-surface-card px-3 py-1 text-xs font-semibold text-content-secondary">
              <Bot className="h-3.5 w-3.5" />
              MCP Connect Assistant
            </div>
            <h1 className="text-2xl font-bold text-content">Connect an assistant to Trippi</h1>
            <p className="mt-1 text-sm text-content-muted">
              MCP lets Claude, ChatGPT, Cursor, and other assistants work with the travel data you choose: trips,
              places, reservations, packing lists, todos, budgets, and Journey entries. OAuth keeps each connection
              scoped and revocable.
            </p>
          </div>
        </div>

        <div className="grid gap-5 xl:grid-cols-[320px_minmax(0,1fr)]">
          <aside className="space-y-5">
            <section className="rounded-lg border border-edge bg-surface-card p-4">
              <h2 className="text-sm font-semibold text-content">Supported assistants</h2>
              <div className="mt-3 space-y-2">
                {ASSISTANTS.map((item) => {
                  const Icon = item.icon;
                  const active = item.id === assistantId;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => handleAssistantChange(item.id)}
                      className={`flex w-full items-start gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors ${
                        active
                          ? 'border-slate-900 bg-slate-900 text-white'
                          : 'border-edge bg-surface-secondary text-content-secondary hover:bg-slate-100 dark:hover:bg-slate-800'
                      }`}
                    >
                      <Icon className="mt-0.5 h-4 w-4 shrink-0" />
                      <span className="min-w-0">
                        <span className="block text-sm font-semibold">{item.label}</span>
                        <span className={`mt-0.5 block text-xs ${active ? 'text-slate-200' : 'text-content-muted'}`}>
                          {item.description}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </section>

            <section className="rounded-lg border border-edge bg-surface-card p-4">
              <h2 className="text-sm font-semibold text-content">Recommended scopes</h2>
              <p className="mt-1 text-xs text-content-muted">
                Start narrow, then add write access only for workflows you trust this assistant to perform.
              </p>
              <div className="mt-3 space-y-2">
                {WORKFLOWS.map((workflow) => {
                  const active = workflow.id === selectedWorkflowId;
                  return (
                    <button
                      key={workflow.id}
                      type="button"
                      onClick={() => handleWorkflowApply(workflow)}
                      className={`w-full rounded-lg border px-3 py-2.5 text-left transition-colors ${
                        active
                          ? 'border-indigo-300 bg-indigo-50 text-indigo-950 dark:border-indigo-500/50 dark:bg-indigo-500/10 dark:text-indigo-100'
                          : 'border-edge bg-surface-secondary text-content-secondary hover:bg-slate-100 dark:hover:bg-slate-800'
                      }`}
                    >
                      <span className="block text-sm font-semibold">{workflow.name}</span>
                      <span className="mt-0.5 block text-xs text-content-muted">{workflow.description}</span>
                      <span className="mt-2 block font-mono text-[11px] text-content-muted">
                        {scopePreview(workflow.scopes)}
                      </span>
                      <span className="mt-2 block text-xs font-semibold">
                        {active ? 'Selected' : 'Use these scopes'}
                      </span>
                    </button>
                  );
                })}
              </div>
            </section>
          </aside>

          <div className="space-y-5">
            <section className="grid gap-3 md:grid-cols-3">
              {[
                {
                  icon: MessageSquare,
                  title: 'Ask with context',
                  body: 'An assistant can answer questions about your itinerary, reservations, packing, and budget.',
                },
                {
                  icon: Plus,
                  title: 'Draft changes',
                  body: 'With write scopes, it can create places, todos, costs, reservations, and Journey entries.',
                },
                {
                  icon: ShieldCheck,
                  title: 'Keep control',
                  body: 'OAuth clients can be scoped, rotated, revoked, or deleted without changing your password.',
                },
              ].map(({ icon: Icon, title, body }) => (
                <div key={title} className="rounded-lg border border-edge bg-surface-card p-4">
                  <Icon className="h-4 w-4 text-content-secondary" />
                  <h2 className="mt-2 text-sm font-semibold text-content">{title}</h2>
                  <p className="mt-1 text-xs leading-5 text-content-muted">{body}</p>
                </div>
              ))}
            </section>

            <section className="rounded-lg border border-edge bg-surface-card p-5">
              <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                <div>
                  <h2 className="text-base font-semibold text-content">MCP agent recipes</h2>
                  <p className="mt-1 text-sm text-content-muted">
                    Use these recipes as starter prompts and OAuth scope templates for common travel-assistant jobs. V1
                    can prepare, monitor, and hand off travel work; it does not purchase flights, hotels, or other
                    provider inventory on your behalf.
                  </p>
                </div>
                <span className="inline-flex w-fit items-center rounded-md border border-edge bg-surface-secondary px-2.5 py-1 text-xs font-semibold text-content-muted">
                  Traveler confirms bookings
                </span>
              </div>

              <div className="mt-4 grid gap-3 lg:grid-cols-2">
                {AGENT_RECIPES.map((recipe) => {
                  const Icon = recipe.icon;
                  return (
                    <article
                      key={recipe.id}
                      aria-labelledby={`mcp-recipe-${recipe.id}`}
                      className="rounded-lg border border-edge bg-surface-secondary p-4"
                    >
                      <div className="flex items-start gap-3">
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-edge bg-surface-card text-content-secondary">
                          <Icon className="h-4 w-4" />
                        </div>
                        <div className="min-w-0">
                          <h3 id={`mcp-recipe-${recipe.id}`} className="text-sm font-semibold text-content">
                            {recipe.name}
                          </h3>
                          <p className="mt-1 text-xs leading-5 text-content-muted">{recipe.description}</p>
                        </div>
                      </div>

                      <div className="mt-4 space-y-3">
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-wide text-content-muted">
                            Required scopes
                          </p>
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {recipe.requiredScopes.map((scope) => (
                              <span
                                key={scope}
                                className="rounded border border-edge bg-surface-card px-1.5 py-0.5 font-mono text-[11px] text-content-muted"
                              >
                                {scope}
                              </span>
                            ))}
                          </div>
                        </div>

                        <div>
                          <p className="text-xs font-semibold uppercase tracking-wide text-content-muted">
                            Expected outputs
                          </p>
                          <ul className="mt-2 space-y-1.5 text-xs leading-5 text-content-muted">
                            {recipe.expectedOutputs.map((output) => (
                              <li key={output} className="flex gap-2">
                                <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" />
                                <span>{output}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      </div>

                      <button
                        type="button"
                        aria-label={`Use scopes for ${recipe.name}`}
                        onClick={() => handleRecipeApply(recipe)}
                        className="mt-4 inline-flex max-w-full items-center gap-1.5 rounded-md border border-edge bg-surface-card px-2.5 py-1.5 text-xs font-semibold text-content-secondary transition-colors hover:bg-slate-100 dark:hover:bg-slate-800"
                      >
                        <Plus className="h-3.5 w-3.5" />
                        Use recipe scopes
                      </button>
                    </article>
                  );
                })}
              </div>
            </section>

            <section className="rounded-lg border border-edge bg-surface-card p-5">
              <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <div>
                  <h2 className="text-base font-semibold text-content">1. Choose an OAuth client</h2>
                  <p className="mt-1 text-sm text-content-muted">
                    Select a saved client, or create one for {assistant.name}. New secrets are shown once.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void loadClients()}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-edge px-3 py-2 text-sm font-medium text-content-secondary transition-colors hover:bg-slate-100 dark:hover:bg-slate-800"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  Refresh
                </button>
              </div>

              <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(340px,0.95fr)]">
                <div className="space-y-3">
                  <label className="block text-sm font-medium text-content-secondary" htmlFor="mcp-oauth-client">
                    Existing clients
                  </label>
                  {clientsLoading ? (
                    <div className="flex items-center gap-2 rounded-lg border border-edge bg-surface-secondary px-3 py-3 text-sm text-content-muted">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Loading OAuth clients...
                    </div>
                  ) : clientsError ? (
                    <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-3 text-sm text-red-700">
                      OAuth clients could not be loaded. You can still review the setup steps and try refreshing.
                    </div>
                  ) : clients.length === 0 ? (
                    <div className="rounded-lg border border-edge bg-surface-secondary px-3 py-3 text-sm text-content-muted">
                      No OAuth clients yet. Create one below to connect an assistant.
                    </div>
                  ) : (
                    <select
                      id="mcp-oauth-client"
                      value={selectedClientId}
                      onChange={(event) => {
                        setSelectedClientId(event.target.value);
                        if (createdClient?.id !== event.target.value) setCreatedClient(null);
                      }}
                      className="w-full rounded-lg border border-edge bg-surface-secondary px-3 py-2.5 text-sm text-content focus:outline-none focus:ring-2 focus:ring-slate-400"
                    >
                      {clients.map((client) => (
                        <option key={client.id} value={client.id}>
                          {client.name} ({client.client_id})
                        </option>
                      ))}
                    </select>
                  )}

                  {selectedClient && (
                    <div className="rounded-lg border border-edge bg-surface-secondary p-3">
                      <div className="flex items-start gap-2">
                        <KeyRound className="mt-0.5 h-4 w-4 shrink-0 text-content-muted" />
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-content">{selectedClient.name}</p>
                          <p className="mt-0.5 break-all font-mono text-xs text-content-muted">
                            {selectedClient.client_id}
                          </p>
                          <p className="mt-1 text-xs text-content-muted">
                            Created {new Date(selectedClient.created_at).toLocaleDateString(locale)}
                          </p>
                          <div className="mt-2 flex flex-wrap gap-1">
                            {selectedClient.allowed_scopes.slice(0, 8).map((scope) => (
                              <span
                                key={scope}
                                className="rounded border border-edge bg-surface-card px-1.5 py-0.5 font-mono text-[11px] text-content-muted"
                              >
                                {scope}
                              </span>
                            ))}
                            {selectedClient.allowed_scopes.length > 8 && (
                              <span className="rounded border border-edge bg-surface-card px-1.5 py-0.5 text-[11px] text-content-muted">
                                +{selectedClient.allowed_scopes.length - 8}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                      {!createdClient && (
                        <p className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-2 text-xs text-amber-800">
                          Existing clients do not expose their saved secret. Use the placeholder in the setup text, or
                          rotate the secret from Settings / Integrations / MCP if you need a new one.
                        </p>
                      )}
                    </div>
                  )}
                </div>

                <div className="space-y-3 rounded-lg border border-edge bg-surface-secondary p-4">
                  <h3 className="text-sm font-semibold text-content">Create a client for {assistant.name}</h3>
                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-content-secondary" htmlFor="client-name">
                      Client name
                    </label>
                    <input
                      id="client-name"
                      value={newClientName}
                      onChange={(event) => setNewClientName(event.target.value)}
                      className="w-full rounded-lg border border-edge bg-surface-card px-3 py-2.5 text-sm text-content focus:outline-none focus:ring-2 focus:ring-slate-400"
                    />
                  </div>
                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-content-secondary" htmlFor="redirect-uris">
                      Redirect URI
                    </label>
                    <textarea
                      id="redirect-uris"
                      value={redirectUris}
                      onChange={(event) => setRedirectUris(event.target.value)}
                      rows={assistant.id === 'chatgpt' ? 3 : 2}
                      placeholder={
                        assistant.id === 'chatgpt'
                          ? 'Paste the callback URL ChatGPT provides, such as https://chatgpt.com/connector/oauth/{callback_id}'
                          : 'http://localhost'
                      }
                      className="w-full resize-none rounded-lg border border-edge bg-surface-card px-3 py-2.5 font-mono text-sm text-content focus:outline-none focus:ring-2 focus:ring-slate-400"
                    />
                    <p className="mt-1 text-xs text-content-muted">
                      One URI per line. HTTPS is required except for localhost and loopback clients.
                    </p>
                  </div>
                  <div>
                    <div className="mb-1.5 flex items-center justify-between gap-2">
                      <label className="block text-xs font-medium text-content-secondary">Allowed scopes</label>
                      <span className="text-xs text-content-muted">{selectedScopes.length} selected</span>
                    </div>
                    <details className="rounded-lg border border-edge bg-surface-card p-3">
                      <summary className="cursor-pointer text-sm font-medium text-content-secondary">
                        Customize scopes
                      </summary>
                      <div className="mt-3">
                        <ScopeGroupPicker selected={selectedScopes} onChange={setSelectedScopes} />
                      </div>
                    </details>
                  </div>
                  <button
                    type="button"
                    onClick={handleCreateClient}
                    disabled={createDisabled}
                    className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                    {creating ? 'Creating client...' : 'Create OAuth client'}
                  </button>
                  {createdClient && (
                    <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
                      <p className="font-semibold">Client created. Copy the secret now.</p>
                      <div className="mt-2 space-y-2">
                        <CredentialRow
                          label="Client ID"
                          value={createdClient.client_id}
                          copied={copiedKey === 'created-client-id'}
                          onCopy={() => handleCopy(createdClient.client_id, 'created-client-id')}
                          copyLabel={t('common.copy')}
                        />
                        <CredentialRow
                          label="Client Secret"
                          value={createdClient.client_secret || ''}
                          copied={copiedKey === 'created-client-secret'}
                          onCopy={() => handleCopy(createdClient.client_secret || '', 'created-client-secret')}
                          copyLabel={t('common.copy')}
                        />
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </section>

            <section className="rounded-lg border border-edge bg-surface-card p-5">
              <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <div>
                  <h2 className="text-base font-semibold text-content">2. Copy setup instructions</h2>
                  <p className="mt-1 text-sm text-content-muted">
                    Instructions are generated for {assistant.name}. Replace placeholders before pasting into the
                    assistant.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => handleCopy(setupInstructions, 'setup')}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-edge px-3 py-2 text-sm font-medium text-content-secondary transition-colors hover:bg-slate-100 dark:hover:bg-slate-800"
                >
                  {copiedKey === 'setup' ? <Check className="h-4 w-4 text-green-600" /> : <Copy className="h-4 w-4" />}
                  {copiedKey === 'setup' ? t('common.copied') : 'Copy setup'}
                </button>
              </div>

              <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
                <pre className="max-h-[520px] overflow-auto rounded-lg border border-edge bg-surface-secondary p-4 font-mono text-xs leading-5 text-content">
                  {setupInstructions}
                </pre>
                <div className="space-y-3">
                  <div className="rounded-lg border border-edge bg-surface-secondary p-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-content-muted">MCP endpoint</p>
                    <p className="mt-1 break-all font-mono text-xs text-content">{endpoint}</p>
                    <button
                      type="button"
                      onClick={() => handleCopy(endpoint, 'endpoint')}
                      className="mt-2 inline-flex items-center gap-1.5 rounded-md border border-edge bg-surface-card px-2.5 py-1.5 text-xs font-medium text-content-secondary"
                    >
                      {copiedKey === 'endpoint' ? (
                        <Check className="h-3.5 w-3.5 text-green-600" />
                      ) : (
                        <Copy className="h-3.5 w-3.5" />
                      )}
                      {copiedKey === 'endpoint' ? t('common.copied') : t('common.copy')}
                    </button>
                  </div>
                  <div className="rounded-lg border border-edge bg-surface-secondary p-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-content-muted">Always available</p>
                    <p className="mt-1 text-xs leading-5 text-content-muted">
                      list_trips and get_trip_summary are available without a scope so assistants can find the trip ID
                      needed for scoped tools.
                    </p>
                  </div>
                  {assistant.id === 'chatgpt' && (
                    <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-900">
                      ChatGPT custom apps are workspace/developer-mode gated. Use the redirect URL shown in ChatGPT app
                      management, then paste it into the Redirect URI field before creating the OAuth client.
                    </div>
                  )}
                  {assistant.id === 'claude-ai' && (
                    <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-900">
                      Claude remote connectors connect from Anthropic cloud infrastructure. Your Trippi MCP endpoint
                      must be reachable from the public internet for this setup.
                    </div>
                  )}
                </div>
              </div>
            </section>
          </div>
        </div>
      </main>
    </PageShell>
  );
}

function CredentialRow({
  label,
  value,
  copied,
  onCopy,
  copyLabel,
}: {
  label: string;
  value: string;
  copied: boolean;
  onCopy: () => void;
  copyLabel: string;
}): React.ReactElement {
  return (
    <div>
      <p className="text-xs font-medium">{label}</p>
      <div className="mt-1 flex items-center gap-2">
        <code className="min-w-0 flex-1 break-all rounded-md border border-emerald-200 bg-white px-2 py-1.5 font-mono text-xs">
          {value}
        </code>
        <button
          type="button"
          onClick={onCopy}
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-emerald-200 bg-white text-emerald-800"
          title={`${copyLabel} ${label}`}
        >
          {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
        </button>
      </div>
    </div>
  );
}
