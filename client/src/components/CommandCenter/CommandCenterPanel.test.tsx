import { describe, expect, it, vi } from 'vitest';
import { buildTrip } from '../../../tests/helpers/factories';
import { render, screen, within } from '../../../tests/helpers/render';
import type { GroupDecision } from '../Decisions/groupDecisionModel';
import CommandCenterPanel from './CommandCenterPanel';
import { buildTripCommandCenter } from './commandCenterModel';

function buildDecision(): GroupDecision {
  return {
    id: 20,
    trip_id: 808,
    created_by: 1,
    created_by_username: 'Maya',
    created_by_avatar: null,
    title: 'Approve the Fado night plan',
    description: null,
    deadline: '2026-07-01',
    state: 'closed',
    final_option_id: null,
    final_option: null,
    options: [
      {
        id: 301,
        decision_id: 20,
        label: 'Book Clube de Fado',
        description: null,
        sort_order: 0,
        metadata: null,
        created_at: '2026-06-29T10:00:00Z',
      },
      {
        id: 302,
        decision_id: 20,
        label: 'Keep the evening open',
        description: null,
        sort_order: 1,
        metadata: null,
        created_at: '2026-06-29T10:00:00Z',
      },
    ],
    responses: [
      {
        id: 401,
        decision_id: 20,
        option_id: 301,
        user_id: 1,
        response: 'selected',
        comment: null,
        username: 'Maya',
        avatar: null,
        created_at: '2026-06-29T10:05:00Z',
        updated_at: '2026-06-29T10:05:00Z',
      },
    ],
    links: [],
    created_at: '2026-06-29T10:00:00Z',
    updated_at: '2026-06-29T10:05:00Z',
  };
}

describe('CommandCenterPanel decision embedding', () => {
  it('renders reusable group decisions inside the command center', () => {
    const decision = buildDecision();
    const center = buildTripCommandCenter({
      trip: buildTrip({ id: 808, title: 'Lisbon Crew', start_date: '2026-07-02', end_date: '2026-07-06' }),
      days: [],
      assignments: {},
      reservations: [],
      budgetItems: [],
      packingItems: [],
      todoItems: [],
      files: [],
      tripMembers: [{ id: 1, username: 'Maya', avatar_url: null } as any],
      groupDecisions: [decision],
      now: new Date('2026-06-30T12:00:00Z'),
    });

    render(
      <CommandCenterPanel
        center={center}
        onNavigate={vi.fn()}
        decisions={[decision]}
        decisionMembers={[{ id: 1, username: 'Maya', avatar_url: null }]}
        currentUserId={1}
        canManageDecisions
        onDecisionFinalize={vi.fn()}
      />
    );

    const decisionList = within(screen.getByTestId('group-decision-list'));
    expect(decisionList.getByText('Approve the Fado night plan')).toBeInTheDocument();
    expect(decisionList.getByText('Closed')).toBeInTheDocument();
    expect(screen.getByText('Ready to finalize Book Clube de Fado')).toBeInTheDocument();
  });
});
