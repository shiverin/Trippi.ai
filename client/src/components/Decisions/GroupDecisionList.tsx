import { Archive, CheckCircle2, ClipboardList, Lock, Plus } from 'lucide-react';
import GroupDecisionCard from './GroupDecisionCard';
import type {
  GroupDecision,
  GroupDecisionLinkedTarget,
  GroupDecisionMember,
  GroupDecisionResponseState,
} from './groupDecisionModel';
import { filterDecisionsByLinkedTarget, getDecisionDisplayState } from './groupDecisionModel';

type DecisionAction = void | Promise<void>;

interface GroupDecisionListProps {
  decisions: GroupDecision[];
  currentUserId?: number | null;
  members?: GroupDecisionMember[];
  canEdit?: boolean;
  compact?: boolean;
  title?: string;
  emptyTitle?: string;
  emptyText?: string;
  maxItems?: number;
  linkedTarget?: GroupDecisionLinkedTarget | null;
  busyDecisionId?: number | null;
  onCreate?: () => DecisionAction;
  onRespond?: (decisionId: number, optionId: number | null, response: GroupDecisionResponseState) => DecisionAction;
  onClose?: (decisionId: number) => DecisionAction;
  onFinalize?: (decisionId: number, optionId: number) => DecisionAction;
}

const STATE_ORDER = {
  open: 0,
  closed: 1,
  approved: 2,
  archived: 3,
};

function sortDecisions(decisions: GroupDecision[]): GroupDecision[] {
  return [...decisions].sort((a, b) => {
    const byState = STATE_ORDER[getDecisionDisplayState(a)] - STATE_ORDER[getDecisionDisplayState(b)];
    if (byState !== 0) return byState;
    const aDeadline = a.deadline ? new Date(a.deadline).getTime() : Number.POSITIVE_INFINITY;
    const bDeadline = b.deadline ? new Date(b.deadline).getTime() : Number.POSITIVE_INFINITY;
    if (aDeadline !== bDeadline) return aDeadline - bDeadline;
    return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
  });
}

export default function GroupDecisionList({
  decisions,
  currentUserId = null,
  members = [],
  canEdit = false,
  compact = false,
  title = 'Group decisions',
  emptyTitle = 'No group decisions yet',
  emptyText = 'Create a decision when the group needs to choose, close voting, or approve a final option.',
  maxItems,
  linkedTarget = null,
  busyDecisionId = null,
  onCreate,
  onRespond,
  onClose,
  onFinalize,
}: GroupDecisionListProps) {
  const scoped = sortDecisions(filterDecisionsByLinkedTarget(decisions, linkedTarget));
  const visible = maxItems ? scoped.slice(0, maxItems) : scoped;
  const hiddenCount = Math.max(0, scoped.length - visible.length);
  const counts = scoped.reduce(
    (acc, decision) => {
      acc[getDecisionDisplayState(decision)] += 1;
      return acc;
    },
    { open: 0, closed: 0, approved: 0, archived: 0 }
  );

  return (
    <section className="space-y-3" data-testid="group-decision-list">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-base font-semibold text-content">
            <ClipboardList size={17} className="text-content-faint" />
            {title}
          </h2>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-tertiary px-2.5 py-1 text-[11px] font-semibold text-content-muted">
              <span className="h-1.5 w-1.5 rounded-full bg-sky-500" />
              {counts.open} open
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-tertiary px-2.5 py-1 text-[11px] font-semibold text-content-muted">
              <Lock size={11} />
              {counts.closed} closed
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-tertiary px-2.5 py-1 text-[11px] font-semibold text-content-muted">
              <CheckCircle2 size={11} />
              {counts.approved} approved
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-tertiary px-2.5 py-1 text-[11px] font-semibold text-content-muted">
              <Archive size={11} />
              {counts.archived} archived
            </span>
          </div>
        </div>

        {canEdit && onCreate && (
          <button
            type="button"
            onClick={onCreate}
            className="inline-flex h-9 items-center justify-center gap-1.5 self-start rounded-lg bg-accent px-3 text-xs font-semibold text-accent-text hover:opacity-90"
          >
            <Plus size={13} />
            New decision
          </button>
        )}
      </div>

      {visible.length === 0 ? (
        <div className="rounded-lg border border-dashed border-edge-secondary bg-surface-card px-5 py-7 text-center">
          <div className="mx-auto mb-3 inline-flex h-9 w-9 items-center justify-center rounded-full bg-surface-tertiary text-content-muted">
            <ClipboardList size={17} />
          </div>
          <h3 className="text-sm font-semibold text-content">{emptyTitle}</h3>
          <p className="mx-auto mt-1 max-w-md text-sm leading-5 text-content-muted">{emptyText}</p>
        </div>
      ) : (
        <div className={compact ? 'grid gap-3 xl:grid-cols-2' : 'space-y-3'}>
          {visible.map((decision) => (
            <GroupDecisionCard
              key={decision.id}
              decision={decision}
              currentUserId={currentUserId}
              members={members}
              canEdit={canEdit}
              compact={compact}
              busy={busyDecisionId === decision.id}
              onRespond={onRespond}
              onClose={onClose}
              onFinalize={onFinalize}
            />
          ))}
        </div>
      )}

      {hiddenCount > 0 && (
        <div className="rounded-lg border border-edge-secondary bg-surface-card px-4 py-3 text-sm font-medium text-content-muted">
          {hiddenCount} more decision{hiddenCount === 1 ? '' : 's'} available in the full decision surface.
        </div>
      )}
    </section>
  );
}
