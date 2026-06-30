import type { TripOverview } from '@trippi/shared';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '../../../tests/helpers/render';
import type { GroupDecision } from '../Decisions/groupDecisionModel';
import CommandCenterPanel from './CommandCenterPanel';

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

function buildOverview(): TripOverview {
  return {
    generated_at: '2026-06-30T12:00:00.000Z',
    trip: {
      id: 808,
      title: 'Lisbon Crew',
      start_date: '2026-07-02',
      end_date: '2026-07-06',
      currency: 'EUR',
    },
    summary: {
      phase: 'before',
      subtitle: 'Pre-trip readiness',
      trip_date_label: 'Jul 2 - Jul 6',
      trip_length_label: '5 days',
      traveler_label: '1 traveler',
      next_deadline_label: 'Tomorrow',
      flagged_count: 1,
      clear_count: 0,
    },
    readiness: {
      title: 'Trip readiness checklist',
      summary: '4/5 checks ready',
      status: 'attention',
      completed_count: 4,
      total_count: 5,
      caveat: 'Document follow-ups use explicit document tasks and files linked to reservations.',
      items: [
        {
          id: 'decisions',
          title: 'Resolve group decisions',
          summary: '1 decision follow-up',
          status: 'attention',
          count: 1,
          action: 'decisions',
          action_label: 'Open decisions',
        },
      ],
    },
    boards: [
      {
        id: 'decisions',
        title: 'Pending decisions',
        summary: '1 explicit decision follow-up',
        status: 'attention',
        count: 1,
        action: 'decisions',
        action_label: 'Open decisions',
        empty_title: 'No decisions queued',
        empty_text: 'Open a decision or add a decision-category task when the group needs to choose.',
        items: [
          {
            id: 'decision-20',
            source: 'decision',
            source_id: 20,
            title: 'Approve the Fado night plan',
            meta: 'Closed, awaiting final selection',
            status: 'urgent',
          },
        ],
      },
    ],
  };
}

describe('CommandCenterPanel overview rendering', () => {
  it('renders backend overview boards and reusable group decisions', () => {
    const decision = buildDecision();

    render(
      <CommandCenterPanel
        center={buildOverview()}
        onNavigate={vi.fn()}
        decisions={[decision]}
        decisionMembers={[{ id: 1, username: 'Maya', avatar_url: null }]}
        currentUserId={1}
        canManageDecisions
        onDecisionFinalize={vi.fn()}
      />
    );

    const decisionList = within(screen.getByTestId('group-decision-list'));
    expect(screen.getByText('Lisbon Crew overview')).toBeInTheDocument();
    expect(screen.getByText('Pending decisions')).toBeInTheDocument();
    expect(screen.getByText('Closed, awaiting final selection')).toBeInTheDocument();
    expect(decisionList.getByText('Approve the Fado night plan')).toBeInTheDocument();
    expect(decisionList.getByText('Closed')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Finalize Book Clube de Fado' })).toBeInTheDocument();
  });
});
