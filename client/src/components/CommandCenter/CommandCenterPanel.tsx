import {
  AlertTriangle,
  ArrowRight,
  Calendar,
  CheckCircle2,
  ClipboardList,
  FileText,
  ListTodo,
  Luggage,
  Ticket,
  Wallet,
} from 'lucide-react';
import GroupDecisionList from '../Decisions/GroupDecisionList';
import type { GroupDecision, GroupDecisionMember, GroupDecisionResponseState } from '../Decisions/groupDecisionModel';
import type {
  CommandCenterAction,
  CommandCenterModule,
  CommandCenterStatus,
  TripCommandCenter,
} from './commandCenterModel';

interface CommandCenterPanelProps {
  center: TripCommandCenter;
  onNavigate: (action: CommandCenterAction) => void;
  decisions?: GroupDecision[];
  decisionMembers?: GroupDecisionMember[];
  currentUserId?: number | null;
  canManageDecisions?: boolean;
  decisionBusyId?: number | null;
  onDecisionRespond?: (
    decisionId: number,
    optionId: number | null,
    response: GroupDecisionResponseState
  ) => void | Promise<void>;
  onDecisionClose?: (decisionId: number) => void | Promise<void>;
  onDecisionFinalize?: (decisionId: number, optionId: number) => void | Promise<void>;
}

const STATUS_CLASS: Record<CommandCenterStatus, string> = {
  empty: 'border-edge-secondary bg-surface-tertiary text-content-muted',
  good: 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-300',
  attention:
    'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-300',
  urgent: 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-500/20 dark:bg-rose-500/10 dark:text-rose-300',
};

const DOT_CLASS: Record<CommandCenterStatus, string> = {
  empty: 'bg-content-faint',
  good: 'bg-emerald-500',
  attention: 'bg-amber-500',
  urgent: 'bg-rose-500',
};

const MODULE_ICONS = {
  decisions: ListTodo,
  budget: Wallet,
  bookings: Ticket,
  packing: Luggage,
  plan: AlertTriangle,
  deadlines: Calendar,
  files: FileText,
} satisfies Record<CommandCenterAction, typeof ClipboardList>;

const MODULE_ACCENTS: Record<CommandCenterAction, string> = {
  decisions: '#6366f1',
  budget: '#059669',
  bookings: '#0ea5e9',
  packing: '#d97706',
  plan: '#e11d48',
  deadlines: '#7c3aed',
  files: '#475569',
};

function statusTone(status: CommandCenterStatus): CommandCenterStatus {
  return status === 'empty' ? 'attention' : status;
}

function statusLabel(status: CommandCenterStatus): string {
  if (status === 'urgent') return 'Urgent';
  if (status === 'attention') return 'Needs attention';
  if (status === 'good') return 'On track';
  return 'Empty';
}

function CommandCenterModuleCard({
  module,
  onNavigate,
}: {
  module: CommandCenterModule;
  onNavigate: (action: CommandCenterAction) => void;
}) {
  const Icon = MODULE_ICONS[module.action];
  const progress = module.progress ?? null;
  const accent = MODULE_ACCENTS[module.action];
  const hasItems = module.items.length > 0;

  return (
    <article className="flex min-h-[292px] flex-col rounded-lg border border-edge-secondary bg-surface-card shadow-[0_10px_30px_rgba(15,23,42,0.06)]">
      <header className="flex items-start justify-between gap-4 border-b border-edge-faint px-5 py-4">
        <div className="flex min-w-0 items-start gap-3">
          <span
            className="mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-white"
            style={{ background: accent }}
            aria-hidden
          >
            <Icon size={17} strokeWidth={2.3} />
          </span>
          <div className="min-w-0">
            <h2 className="text-[15px] font-semibold text-content">{module.title}</h2>
            <p className="mt-1 text-sm leading-5 text-content-muted">{module.summary}</p>
          </div>
        </div>
        <span
          className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold ${STATUS_CLASS[module.status]}`}
        >
          <span className={`h-1.5 w-1.5 rounded-full ${DOT_CLASS[module.status]}`} />
          {statusLabel(module.status)}
        </span>
      </header>

      <div className="flex flex-1 flex-col px-5 py-4">
        {module.metric && (
          <div className="mb-4">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-xl font-semibold tabular-nums text-content">{module.metric}</span>
              {progress != null && <span className="text-xs font-medium text-content-faint">{progress}%</span>}
            </div>
            {progress != null && (
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-surface-tertiary">
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${progress}%`,
                    background: accent,
                  }}
                />
              </div>
            )}
          </div>
        )}

        {hasItems ? (
          <div className="space-y-3">
            {module.items.map((item) => (
              <div key={item.id} className="grid grid-cols-[10px_minmax(0,1fr)] gap-3">
                <span className={`mt-2 h-2 w-2 rounded-full ${DOT_CLASS[statusTone(item.status || module.status)]}`} />
                <div className="min-w-0 border-b border-edge-faint pb-3 last:border-b-0 last:pb-0">
                  <div className="truncate text-sm font-medium text-content">{item.title}</div>
                  <div className="mt-0.5 text-xs text-content-muted">{item.meta}</div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="flex flex-1 flex-col justify-center border-t border-dashed border-edge-secondary pt-5">
            <div className="mb-2 inline-flex h-8 w-8 items-center justify-center rounded-full bg-surface-tertiary text-content-muted">
              {module.status === 'good' ? <CheckCircle2 size={17} /> : <ClipboardList size={17} />}
            </div>
            <h3 className="text-sm font-semibold text-content">{module.empty_title ?? 'Nothing to review'}</h3>
            <p className="mt-1 text-sm leading-5 text-content-muted">
              {module.empty_text ?? 'This board is clear based on current trip data.'}
            </p>
          </div>
        )}

        <button
          type="button"
          onClick={() => onNavigate(module.action)}
          className="mt-5 inline-flex h-10 items-center justify-center gap-2 self-start rounded-lg bg-accent px-3.5 text-sm font-semibold text-accent-text hover:opacity-90"
        >
          {module.action_label}
          <ArrowRight size={14} strokeWidth={2.4} />
        </button>
      </div>
    </article>
  );
}

function ReadinessChecklistCard({ center, onNavigate }: CommandCenterPanelProps) {
  const checklist = center.readiness;
  const progress =
    checklist.total_count > 0 ? Math.round((checklist.completed_count / checklist.total_count) * 100) : 0;

  return (
    <section className="mt-5 rounded-lg border border-edge-secondary bg-surface-card px-5 py-4 shadow-[0_10px_30px_rgba(15,23,42,0.05)]">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-3">
            <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-content text-surface-card">
              <CheckCircle2 size={17} strokeWidth={2.4} />
            </span>
            <div className="min-w-0">
              <h2 className="text-[15px] font-semibold text-content">{checklist.title}</h2>
              <p className="mt-1 text-sm text-content-muted">{checklist.summary}</p>
            </div>
          </div>
        </div>
        <div className="min-w-[180px]">
          <div className="flex items-center justify-between gap-3">
            <span
              className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold ${STATUS_CLASS[checklist.status]}`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${DOT_CLASS[checklist.status]}`} />
              {checklist.completed_count}/{checklist.total_count} ready
            </span>
            <span className="text-xs font-medium tabular-nums text-content-faint">{progress}%</span>
          </div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-surface-tertiary">
            <div className="h-full rounded-full bg-content" style={{ width: `${progress}%` }} />
          </div>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-2 lg:grid-cols-5">
        {checklist.items.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => onNavigate(item.action)}
            className="group flex min-h-[112px] flex-col justify-between rounded-lg border border-edge-faint bg-surface-secondary p-3 text-left transition hover:border-edge-secondary hover:bg-surface-tertiary"
          >
            <span className="flex items-start gap-2.5">
              <span
                className={`mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border ${STATUS_CLASS[item.status]}`}
              >
                {item.status === 'good' ? <CheckCircle2 size={15} /> : <AlertTriangle size={15} />}
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-semibold leading-5 text-content">{item.title}</span>
                <span className="mt-1 block text-xs leading-4 text-content-muted">{item.summary}</span>
              </span>
            </span>
            <span className="mt-3 inline-flex items-center gap-1.5 text-xs font-semibold text-accent">
              {item.action_label}
              <ArrowRight size={13} strokeWidth={2.5} className="transition group-hover:translate-x-0.5" />
            </span>
          </button>
        ))}
      </div>

      {checklist.caveat && <p className="mt-3 text-xs leading-5 text-content-faint">{checklist.caveat}</p>}
    </section>
  );
}

export default function CommandCenterPanel({
  center,
  onNavigate,
  decisions,
  decisionMembers,
  currentUserId = null,
  canManageDecisions = false,
  decisionBusyId = null,
  onDecisionRespond,
  onDecisionClose,
  onDecisionFinalize,
}: CommandCenterPanelProps) {
  const { summary } = center;

  return (
    <div className="h-full overflow-y-auto overscroll-contain bg-surface-secondary pb-[var(--bottom-nav-h)]">
      <div className="mx-auto w-full max-w-7xl px-4 py-5 sm:px-6 lg:px-8">
        <section className="border-b border-edge-secondary bg-surface-card px-1 pb-5 sm:px-0">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div className="min-w-0">
              <div className="flex items-center gap-3">
                <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-text">
                  <ClipboardList size={19} strokeWidth={2.4} />
                </span>
                <div className="min-w-0">
                  <p className="text-xs font-semibold uppercase tracking-[0.14em] text-content-faint">
                    {summary.subtitle}
                  </p>
                  <h1 className="mt-1 truncate text-2xl font-semibold text-content sm:text-3xl">
                    {center.trip.title} overview
                  </h1>
                </div>
              </div>
            </div>

            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4 lg:min-w-[520px]">
              <div className="border-l border-edge-faint pl-3">
                <dt className="text-[11px] font-semibold uppercase tracking-[0.08em] text-content-faint">Dates</dt>
                <dd className="mt-1 truncate text-sm font-semibold text-content">{summary.trip_date_label}</dd>
              </div>
              <div className="border-l border-edge-faint pl-3">
                <dt className="text-[11px] font-semibold uppercase tracking-[0.08em] text-content-faint">Length</dt>
                <dd className="mt-1 text-sm font-semibold text-content">{summary.trip_length_label}</dd>
              </div>
              <div className="border-l border-edge-faint pl-3">
                <dt className="text-[11px] font-semibold uppercase tracking-[0.08em] text-content-faint">Group</dt>
                <dd className="mt-1 text-sm font-semibold text-content">{summary.traveler_label}</dd>
              </div>
              <div className="border-l border-edge-faint pl-3">
                <dt className="text-[11px] font-semibold uppercase tracking-[0.08em] text-content-faint">Next</dt>
                <dd className="mt-1 truncate text-sm font-semibold text-content">{summary.next_deadline_label}</dd>
              </div>
            </dl>
          </div>

          <div className="mt-5 flex flex-wrap gap-2">
            <span className="inline-flex items-center gap-2 rounded-full bg-surface-tertiary px-3 py-1.5 text-xs font-semibold text-content-muted">
              <span className="h-2 w-2 rounded-full bg-amber-500" />
              {summary.flagged_count} board{summary.flagged_count === 1 ? '' : 's'} need review
            </span>
            <span className="inline-flex items-center gap-2 rounded-full bg-surface-tertiary px-3 py-1.5 text-xs font-semibold text-content-muted">
              <span className="h-2 w-2 rounded-full bg-emerald-500" />
              {summary.clear_count} on track
            </span>
          </div>
        </section>

        {decisions && (
          <section className="mt-5">
            <GroupDecisionList
              decisions={decisions}
              currentUserId={currentUserId}
              members={decisionMembers}
              canEdit={canManageDecisions}
              compact
              maxItems={4}
              emptyTitle="No group decisions yet"
              emptyText="Open a decision when the group needs to choose an option, then close or finalize it from here."
              busyDecisionId={decisionBusyId}
              onRespond={onDecisionRespond}
              onClose={onDecisionClose}
              onFinalize={onDecisionFinalize}
            />
          </section>
        )}

        <ReadinessChecklistCard center={center} onNavigate={onNavigate} />

        <section className="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">
          {center.boards.map((module) => (
            <CommandCenterModuleCard key={module.id} module={module} onNavigate={onNavigate} />
          ))}
        </section>
      </div>
    </div>
  );
}
