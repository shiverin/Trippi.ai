import userEvent from '@testing-library/user-event';
import { render, screen } from '../../../tests/helpers/render';
import PremiumGate, { LockedState } from './PremiumGate';

describe('PremiumGate', () => {
  it('renders children when the feature is not locked', () => {
    render(
      <PremiumGate locked={false} title="Locked">
        <button>Base workflow</button>
      </PremiumGate>
    );

    expect(screen.getByRole('button', { name: 'Base workflow' })).toBeInTheDocument();
    expect(screen.queryByText('Locked')).not.toBeInTheDocument();
  });

  it('shows a disabled coming-soon action when checkout is unavailable', () => {
    render(<LockedState title="AI workers locked" description="Upgrade path is not configured yet." />);

    expect(screen.getByText('AI workers locked')).toBeInTheDocument();
    const button = screen.getByRole('button', { name: /coming soon/i });
    expect(button).toBeDisabled();
  });

  it('calls the upgrade action when checkout is available', async () => {
    const user = userEvent.setup();
    const onUpgrade = vi.fn();

    render(<LockedState title="Price watches locked" upgradeAvailable onUpgrade={onUpgrade} />);

    await user.click(screen.getByRole('button', { name: /upgrade/i }));
    expect(onUpgrade).toHaveBeenCalledTimes(1);
  });
});
