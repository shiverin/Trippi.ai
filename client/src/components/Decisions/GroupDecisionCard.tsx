import { Archive, CalendarClock, Check, CheckCircle2, Circle, Clock3, Flag, Lock, Trophy, Users } from 'lucide-react';
import type {
  GroupDecision,
  GroupDecisionDisplayState,
  GroupDecisionMember,
  GroupDecisionOption,
  GroupDecisionResponse,
  GroupDecisionResponseState,
} from './groupDecisionModel';
import {
  formatDecisionDeadline,
  getDecisionDisplayState,
  getDecisionOptionStats,
  getDecisionRespondedCount,
  getDecisionResponseForUser,
  getWinningDecisionOption,
} from './groupDecisionModel';

type DecisionAction = void | Promise<void>;

interface GroupDecisionCardProps {
  decision: GroupDecision;
  currentUserId?: number | null;
  members?: GroupDecisionMember[];
  canEdit?: boolean;
  compact?: boolean;
  busy?: boolean;
  now?: Date;
  onRespond?: (decisionId: number, optionId: number | null, response: GroupDecisionResponseState) => DecisionAction;
  onClose?: (decisionId: number) => DecisionAction;
  onFinalize?: (decisionId: number, optionId: number) => DecisionAction;
}

const STATE_CONFIG: Record<
  GroupDecisionDisplayState,
  { label: string; icon: typeof Circle; className: string; dotClassName: string }
> = {
  open: {
    label: 'Open',
    icon: Clock3,
    className: 'border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-500/20 dark:bg-sky-500/10 dark:text-sky-300',
    dotClassName: 'bg-sky-500',
  },
  closed: {
    label: 'Closed',
    icon: Lock,
    className:
      'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-300',
    dotClassName: 'bg-amber-500',
  },
  approved: {
    label: 'Approved',
    icon: CheckCircle2,
    className:
      'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-300',
    dotClassName: 'bg-emerald-500',
  },
  archived: {
    label: 'Archived',
    icon: Archive,
    className: 'border-edge-secondary bg-surface-tertiary text-content-muted',
    dotClassName: 'bg-content-faint',
  },
};

const RESPONSE_LABEL: Record<GroupDecisionResponseState, string> = {
  selected: 'selected',
  maybe: 'maybe',
  declined: 'declined',
  abstain: 'abstained',
};

function initials(name: string | null | undefined): string {
  const trimmed = (name || '?').trim();
  return trimmed ? trimmed[0].toUpperCase() : '?';
}

function AvatarStack({ responses }: { responses: GroupDecisionResponse[] }) {
  if (responses.length === 0) return null;
  const visible = responses.slice(0, 4);
  const overflow = responses.length - visible.length;

  return (
    <div className="flex shrink-0 items-center" aria-label={`${responses.length} selected`}>
      {visible.map((response, index) => (
        <span
          key={response.id || `${response.user_id}-${index}`}
          title={response.username}
          className="inline-flex h-6 w-6 items-center justify-center overflow-hidden rounded-full border-2 border-surface-card bg-surface-tertiary text-[10px] font-semibold text-content-muted"
          style={{ marginLeft: index === 0 ? 0 : -7 }}
        >
          {response.avatar ? (
            <img src={response.avatar} alt="" className="h-full w-full object-cover" />
          ) : (
            initials(response.username)
          )}
        </span>
      ))}
      {overflow > 0 && (
        <span
          className="inline-flex h-6 min-w-6 items-center justify-center rounded-full border-2 border-surface-card bg-surface-tertiary px-1 text-[10px] font-semibold text-content-muted"
          style={{ marginLeft: -7 }}
        >
          +{overflow}
        </span>
      )}
    </div>
  );
}

function currentResponseLabel(
  response: GroupDecisionResponse | null,
  optionsById: Map<number, GroupDecisionOption>
): string {
  if (!response) return 'You have not responded';
  if (response.response === 'selected' && response.option_id != null) {
    const option = optionsById.get(response.option_id);
    return option ? `You selected ${option.label}` : 'You selected an option';
  }
  return `You ${RESPONSE_LABEL[response.response]}`;
}

function linkedLabel(type: string): string {
  return type
    .split('_')
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(' ');
}

export default function GroupDecisionCard({
  decision,
  currentUserId = null,
  members = [],
  canEdit = false,
  compact = false,
  busy = false,
  now,
  onRespond,
  onClose,
  onFinalize,
}: GroupDecisionCardProps) {
  const displayState = getDecisionDisplayState(decision);
  const stateConfig = STATE_CONFIG[displayState];
  const StateIcon = stateConfig.icon;
  const isOpen = displayState === 'open';
  const isArchived = displayState === 'archived';
  const isApproved = displayState === 'approved';
  const canRespond = isOpen && !!onRespond && !busy;
  const canManage = canEdit && !isArchived && !isApproved && !busy;
  const stats = getDecisionOptionStats(decision);
  const winningOption = getWinningDecisionOption(decision);
  const finalOption = decision.final_option ?? (decision.final_option_id ? winningOption : null);
  const optionsById = new Map(decision.options.map((option) => [option.id, option]));
  const currentResponse = getDecisionResponseForUser(decision, currentUserId);
  const respondedCount = getDecisionRespondedCount(decision);
  const memberCount = members.length;
  const waitingMembers = members
    .filter((member) => !decision.responses.some((response) => String(response.user_id) === String(member.id)))
    .slice(0, 3);
  const responseCounts = {
    selected: decision.responses.filter((response) => response.response === 'selected').length,
    maybe: decision.responses.filter((response) => response.response === 'maybe').length,
    declined: decision.responses.filter((response) => response.response === 'declined').length,
    abstain: decision.responses.filter((response) => response.response === 'abstain').length,
  };
  const resultLabel = isApproved ? 'Final option' : displayState === 'closed' ? 'Winning option' : 'Leading option';
  const resultOption = isApproved ? finalOption : winningOption;

  return (
    <article className="rounded-lg border border-edge-secondary bg-surface-card shadow-[0_8px_26px_rgba(15,23,42,0.05)]">
      <header className={`${compact ? 'px-4 py-3' : 'px-5 py-4'} border-b border-edge-faint`}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold ${stateConfig.className}`}
              >
                <span className={`h-1.5 w-1.5 rounded-full ${stateConfig.dotClassName}`} />
                <StateIcon size={12} strokeWidth={2.4} />
                {stateConfig.label}
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-tertiary px-2.5 py-1 text-[11px] font-semibold text-content-muted">
                <CalendarClock size={12} />
                {formatDecisionDeadline(decision.deadline, now)}
              </span>
            </div>
            <h3 className={`${compact ? 'mt-2 text-[15px]' : 'mt-3 text-base'} font-semibold leading-6 text-content`}>
              {decision.title}
            </h3>
            {decision.description && !compact && (
              <p className="mt-1 text-sm leading-5 text-content-muted">{decision.description}</p>
            )}
          </div>

          {canManage && (
            <div className="flex shrink-0 items-center gap-2">
              {isOpen && onClose && (
                <button
                  type="button"
                  onClick={() => onClose(decision.id)}
                  className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-edge-secondary bg-surface-card px-3 text-xs font-semibold text-content-muted hover:bg-surface-tertiary hover:text-content disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={busy}
                >
                  <Lock size={13} />
                  Close
                </button>
              )}
              {winningOption && onFinalize && (
                <button
                  type="button"
                  onClick={() => onFinalize(decision.id, winningOption.id)}
                  className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg bg-accent px-3 text-xs font-semibold text-accent-text hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={busy}
                >
                  <CheckCircle2 size={13} />
                  Finalize
                </button>
              )}
            </div>
          )}
        </div>

        <div className="mt-3 grid gap-2 text-xs text-content-muted sm:grid-cols-2">
          <div className="inline-flex min-w-0 items-center gap-2">
            <Users size={13} className="shrink-0 text-content-faint" />
            <span className="truncate">
              {memberCount > 0
                ? `${respondedCount} of ${memberCount} responded`
                : `${respondedCount} response${respondedCount === 1 ? '' : 's'}`}
            </span>
          </div>
          <div className="inline-flex min-w-0 items-center gap-2">
            <Trophy size={13} className="shrink-0 text-content-faint" />
            <span className="truncate">
              {resultOption ? `${resultLabel}: ${resultOption.label}` : `${resultLabel}: not set`}
            </span>
          </div>
        </div>
      </header>

      <div className={`${compact ? 'px-4 py-3' : 'px-5 py-4'} space-y-2`}>
        {stats.map((stat) => {
          const myVote = currentResponse?.option_id === stat.option.id && currentResponse.response === 'selected';
          const rowTone = stat.isFinal
            ? 'border-emerald-300 bg-emerald-50/80 dark:border-emerald-500/25 dark:bg-emerald-500/10'
            : myVote
              ? 'border-accent bg-accent/10'
              : stat.isWinning && displayState !== 'open'
                ? 'border-amber-300 bg-amber-50/80 dark:border-amber-500/25 dark:bg-amber-500/10'
                : 'border-edge-secondary bg-surface-secondary';

          return (
            <div key={stat.option.id} className={`relative rounded-lg border ${rowTone}`}>
              <div
                className="bg-content/[0.06] absolute inset-y-0 left-0 rounded-lg"
                style={{ width: `${stat.percent}%` }}
                aria-hidden
              />
              <div className="relative flex items-stretch gap-2 p-2">
                <button
                  type="button"
                  disabled={!canRespond}
                  onClick={() => onRespond?.(decision.id, stat.option.id, 'selected')}
                  className="flex min-w-0 flex-1 items-center gap-3 rounded-md px-1 py-1.5 text-left disabled:cursor-default"
                >
                  <span
                    className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border ${
                      myVote
                        ? 'border-accent bg-accent text-accent-text'
                        : stat.isFinal
                          ? 'border-emerald-500 bg-emerald-500 text-white'
                          : 'border-edge-secondary bg-surface-card text-content-faint'
                    }`}
                  >
                    {myVote || stat.isFinal ? <Check size={13} strokeWidth={2.6} /> : <Circle size={10} />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-content">{stat.option.label}</span>
                    {stat.option.description && !compact && (
                      <span className="mt-0.5 block text-xs leading-4 text-content-muted">
                        {stat.option.description}
                      </span>
                    )}
                  </span>
                  <AvatarStack responses={stat.selectedResponses} />
                  <span className="w-11 shrink-0 text-right text-xs font-semibold tabular-nums text-content-muted">
                    {stat.selectedCount}
                    <span className="text-content-faint"> / {stat.percent}%</span>
                  </span>
                </button>

                {canManage && onFinalize && (
                  <button
                    type="button"
                    onClick={() => onFinalize(decision.id, stat.option.id)}
                    title={`Finalize ${stat.option.label}`}
                    aria-label={`Finalize ${stat.option.label}`}
                    className="inline-flex h-9 w-9 shrink-0 items-center justify-center self-center rounded-lg text-content-faint hover:bg-surface-card hover:text-content disabled:cursor-not-allowed disabled:opacity-60"
                    disabled={busy}
                  >
                    <Flag size={14} />
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <footer className={`${compact ? 'px-4 pb-4' : 'px-5 pb-5'} space-y-3`}>
        <div className="flex flex-wrap items-center gap-2 text-xs text-content-muted">
          <span className="font-semibold text-content">{currentResponseLabel(currentResponse, optionsById)}</span>
          {responseCounts.maybe > 0 && <span>{responseCounts.maybe} maybe</span>}
          {responseCounts.declined > 0 && <span>{responseCounts.declined} declined</span>}
          {responseCounts.abstain > 0 && <span>{responseCounts.abstain} abstained</span>}
          {isOpen && waitingMembers.length > 0 && (
            <span className="truncate">
              Waiting on {waitingMembers.map((member) => member.username).join(', ')}
              {memberCount > waitingMembers.length + respondedCount ? '...' : ''}
            </span>
          )}
        </div>

        {isOpen && onRespond && (
          <div className="flex flex-wrap gap-2">
            {(['maybe', 'declined', 'abstain'] as const).map((response) => (
              <button
                key={response}
                type="button"
                onClick={() =>
                  onRespond(decision.id, response === 'maybe' ? (currentResponse?.option_id ?? null) : null, response)
                }
                className="inline-flex h-8 items-center justify-center rounded-lg border border-edge-secondary bg-surface-card px-3 text-xs font-semibold text-content-muted hover:bg-surface-tertiary hover:text-content disabled:cursor-not-allowed disabled:opacity-60"
                disabled={busy}
              >
                {response === 'maybe' ? 'Maybe' : response === 'declined' ? 'Decline' : 'Abstain'}
              </button>
            ))}
          </div>
        )}

        {decision.links.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {decision.links.map((link) => (
              <span
                key={link.id}
                className="rounded-full bg-surface-tertiary px-2 py-1 text-[11px] font-semibold text-content-muted"
              >
                {linkedLabel(link.target_type)} #{link.target_id}
              </span>
            ))}
          </div>
        )}
      </footer>
    </article>
  );
}
