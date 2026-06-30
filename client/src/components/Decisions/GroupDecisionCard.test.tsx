import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '../../../tests/helpers/render';
import GroupDecisionCard from './GroupDecisionCard';
import GroupDecisionList from './GroupDecisionList';
import type { GroupDecision } from './groupDecisionModel';

function buildDecision(overrides: Partial<GroupDecision> = {}): GroupDecision {
  const decision: GroupDecision = {
    id: 10,
    trip_id: 5,
    created_by: 1,
    created_by_username: 'Maya',
    created_by_avatar: null,
    title: 'Pick the dinner neighborhood',
    description: 'Choose the area before bookings open.',
    deadline: '2026-07-01',
    state: 'open',
    final_option_id: null,
    final_option: null,
    options: [
      {
        id: 101,
        decision_id: 10,
        label: 'Stay in Alfama',
        description: 'Quiet streets near the hotel.',
        sort_order: 0,
        metadata: null,
        created_at: '2026-06-28T10:00:00Z',
      },
      {
        id: 102,
        decision_id: 10,
        label: 'Try Bairro Alto',
        description: 'Late-night restaurants.',
        sort_order: 1,
        metadata: null,
        created_at: '2026-06-28T10:00:00Z',
      },
    ],
    responses: [
      {
        id: 201,
        decision_id: 10,
        option_id: 101,
        user_id: 1,
        response: 'selected',
        comment: null,
        username: 'Maya',
        avatar: null,
        created_at: '2026-06-28T10:30:00Z',
        updated_at: '2026-06-28T10:30:00Z',
      },
    ],
    links: [],
    created_at: '2026-06-28T10:00:00Z',
    updated_at: '2026-06-28T10:30:00Z',
    ...overrides,
  };

  return {
    ...decision,
    final_option:
      overrides.final_option ??
      (decision.final_option_id
        ? (decision.options.find((option) => option.id === decision.final_option_id) ?? null)
        : null),
  };
}

const members = [
  { id: 1, username: 'Maya', avatar_url: null },
  { id: 2, username: 'Noah', avatar_url: null },
  { id: 3, username: 'Lina', avatar_url: null },
];

describe('GroupDecisionCard', () => {
  it('shows an open decision with deadline, response status, and vote action', async () => {
    const onRespond = vi.fn();
    const user = userEvent.setup();

    render(
      <GroupDecisionCard
        decision={buildDecision()}
        currentUserId={2}
        members={members}
        now={new Date('2026-06-30T12:00:00Z')}
        onRespond={onRespond}
      />
    );

    expect(screen.getByText('Open')).toBeInTheDocument();
    expect(screen.getByText('Due tomorrow')).toBeInTheDocument();
    expect(screen.getByText('1 of 3 responded')).toBeInTheDocument();
    expect(screen.getByText('You have not responded')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Try Bairro Alto/i }));

    expect(onRespond).toHaveBeenCalledWith(10, 102, 'selected');
  });

  it('lets an organizer close and finalize an actionable decision', async () => {
    const onClose = vi.fn();
    const onFinalize = vi.fn();
    const user = userEvent.setup();

    render(
      <GroupDecisionCard
        decision={buildDecision()}
        currentUserId={1}
        members={members}
        canEdit
        now={new Date('2026-06-30T12:00:00Z')}
        onClose={onClose}
        onFinalize={onFinalize}
      />
    );

    await user.click(screen.getByRole('button', { name: /^Close$/i }));
    await user.click(screen.getByRole('button', { name: /^Finalize$/i }));

    expect(onClose).toHaveBeenCalledWith(10);
    expect(onFinalize).toHaveBeenCalledWith(10, 101);
  });

  it('shows closed, approved, and archived decision states', () => {
    const approved = buildDecision({ state: 'decided', final_option_id: 101 });
    const archived = buildDecision({ id: 11, state: 'cancelled', title: 'Old hostel poll', responses: [] });

    const { rerender } = render(<GroupDecisionCard decision={buildDecision({ state: 'closed' })} members={members} />);
    expect(screen.getByText('Closed')).toBeInTheDocument();
    expect(screen.getByText('Winning option: Stay in Alfama')).toBeInTheDocument();

    rerender(<GroupDecisionCard decision={approved} members={members} canEdit />);
    expect(screen.getByText('Approved')).toBeInTheDocument();
    expect(screen.getByText('Final option: Stay in Alfama')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Finalize$/i })).not.toBeInTheDocument();

    rerender(<GroupDecisionCard decision={archived} members={members} canEdit />);
    expect(screen.getByText('Archived')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Close$/i })).not.toBeInTheDocument();
  });
});

describe('GroupDecisionList', () => {
  it('can scope decisions to a linked object surface', () => {
    const scoped = buildDecision({
      title: 'Choose museum window',
      links: [
        {
          id: 1,
          decision_id: 10,
          target_type: 'place',
          target_id: 44,
          created_at: '2026-06-28T10:00:00Z',
        },
      ],
    });
    const other = buildDecision({ id: 12, title: 'Pick train time', links: [] });

    render(<GroupDecisionList decisions={[scoped, other]} linkedTarget={{ target_type: 'place', target_id: 44 }} />);

    expect(screen.getByText('Choose museum window')).toBeInTheDocument();
    expect(screen.queryByText('Pick train time')).not.toBeInTheDocument();
  });
});
