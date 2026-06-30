export type GroupDecisionApiState = 'open' | 'closed' | 'decided' | 'cancelled';
export type GroupDecisionDisplayState = 'open' | 'closed' | 'approved' | 'archived';
export type GroupDecisionState = GroupDecisionApiState | GroupDecisionDisplayState;
export type GroupDecisionResponseState = 'selected' | 'maybe' | 'declined' | 'abstain';
export type GroupDecisionLinkTargetType = 'trip' | 'day' | 'place' | 'reservation' | 'booking_intent' | 'packing_item';

export interface GroupDecisionOption {
  id: number;
  decision_id: number;
  booking_option_id?: number | null;
  label: string;
  description: string | null;
  sort_order: number;
  metadata: unknown;
  created_at: string;
}

export interface GroupDecisionResponse {
  id: number;
  decision_id: number;
  option_id: number | null;
  user_id: number;
  response: GroupDecisionResponseState;
  comment: string | null;
  username: string;
  avatar: string | null;
  created_at: string;
  updated_at: string;
}

export interface GroupDecisionLink {
  id: number;
  decision_id: number;
  target_type: GroupDecisionLinkTargetType;
  target_id: number;
  created_at: string;
}

export interface GroupDecision {
  id: number;
  trip_id: number;
  created_by: number;
  created_by_username?: string;
  created_by_avatar?: string | null;
  title: string;
  description: string | null;
  deadline: string | null;
  state: GroupDecisionState;
  final_option_id: number | null;
  final_option: GroupDecisionOption | null;
  options: GroupDecisionOption[];
  responses: GroupDecisionResponse[];
  links: GroupDecisionLink[];
  created_at: string;
  updated_at: string;
}

export interface GroupDecisionMember {
  id: number;
  username: string;
  avatar_url?: string | null;
  avatar?: string | null;
}

export interface GroupDecisionLinkedTarget {
  target_type: GroupDecisionLinkTargetType;
  target_id: number;
}

export interface GroupDecisionOptionStats {
  option: GroupDecisionOption;
  selectedCount: number;
  maybeCount: number;
  responseCount: number;
  percent: number;
  selectedResponses: GroupDecisionResponse[];
  responses: GroupDecisionResponse[];
  isWinning: boolean;
  isFinal: boolean;
}

export function getDecisionDisplayState(decision: Pick<GroupDecision, 'state'>): GroupDecisionDisplayState {
  if (decision.state === 'decided' || decision.state === 'approved') return 'approved';
  if (decision.state === 'cancelled' || decision.state === 'archived') return 'archived';
  if (decision.state === 'closed') return 'closed';
  return 'open';
}

export function isDecisionActionable(decision: Pick<GroupDecision, 'state'>): boolean {
  const state = getDecisionDisplayState(decision);
  return state === 'open' || state === 'closed';
}

export function getDecisionResponseForUser(
  decision: Pick<GroupDecision, 'responses'>,
  userId: number | null | undefined
): GroupDecisionResponse | null {
  if (userId == null) return null;
  return decision.responses.find((response) => String(response.user_id) === String(userId)) ?? null;
}

export function getDecisionRespondedCount(decision: Pick<GroupDecision, 'responses'>): number {
  return new Set(decision.responses.map((response) => response.user_id)).size;
}

export function getDecisionSelectedCount(decision: Pick<GroupDecision, 'responses'>): number {
  return decision.responses.filter((response) => response.response === 'selected' && response.option_id != null).length;
}

export function getDecisionOptionStats(decision: GroupDecision): GroupDecisionOptionStats[] {
  const selectedTotal = Math.max(0, getDecisionSelectedCount(decision));
  const selectedCounts = decision.options.map(
    (option) =>
      decision.responses.filter((response) => response.response === 'selected' && response.option_id === option.id)
        .length
  );
  const maxSelected = Math.max(0, ...selectedCounts);

  return decision.options.map((option, index) => {
    const responses = decision.responses.filter((response) => response.option_id === option.id);
    const selectedResponses = responses.filter((response) => response.response === 'selected');
    const maybeCount = responses.filter((response) => response.response === 'maybe').length;
    const selectedCount = selectedResponses.length;
    return {
      option,
      selectedCount,
      maybeCount,
      responseCount: responses.length,
      percent: selectedTotal > 0 ? Math.round((selectedCount / selectedTotal) * 100) : 0,
      selectedResponses,
      responses,
      isWinning: selectedCount > 0 && selectedCount === maxSelected && selectedCounts[index] === maxSelected,
      isFinal: decision.final_option_id === option.id,
    };
  });
}

export function getWinningDecisionOption(decision: GroupDecision): GroupDecisionOption | null {
  if (decision.final_option) return decision.final_option;
  const stats = getDecisionOptionStats(decision);
  const winner = stats
    .filter((stat) => stat.selectedCount > 0)
    .sort((a, b) => b.selectedCount - a.selectedCount || a.option.sort_order - b.option.sort_order)[0];
  return winner?.option ?? null;
}

export function formatDecisionDeadline(deadline: string | null | undefined, now = new Date()): string {
  if (!deadline) return 'No deadline';
  const date = new Date(deadline.includes('T') ? deadline : `${deadline}T00:00:00`);
  if (Number.isNaN(date.getTime())) return 'No deadline';

  const startNow = new Date(now);
  startNow.setHours(0, 0, 0, 0);
  const startDeadline = new Date(date);
  startDeadline.setHours(0, 0, 0, 0);
  const dayDelta = Math.round((startDeadline.getTime() - startNow.getTime()) / 86_400_000);
  const dateLabel = date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

  if (dayDelta < 0) return `Overdue ${dateLabel}`;
  if (dayDelta === 0) return `Due today`;
  if (dayDelta === 1) return `Due tomorrow`;
  return `Due ${dateLabel}`;
}

export function filterDecisionsByLinkedTarget<T extends Pick<GroupDecision, 'links'>>(
  decisions: T[],
  target: GroupDecisionLinkedTarget | null | undefined
): T[] {
  if (!target) return decisions;
  return decisions.filter((decision) =>
    decision.links.some(
      (link) => link.target_type === target.target_type && Number(link.target_id) === Number(target.target_id)
    )
  );
}
