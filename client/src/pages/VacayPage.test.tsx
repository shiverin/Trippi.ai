import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildUser } from '../../tests/helpers/factories';
import { fireEvent, render, screen, waitFor } from '../../tests/helpers/render';
import { resetAllStores, seedStore } from '../../tests/helpers/store';
import { useAuthStore } from '../store/authStore';
import { useVacayStore } from '../store/vacayStore';
import VacayPage from './VacayPage';

vi.mock('../components/Vacay/VacayCalendar', () => ({
  default: () => <div data-testid="vacay-calendar" />,
}));

vi.mock('../components/Layout/Navbar', () => ({
  default: () => <nav data-testid="navbar" />,
}));

describe('VacayPage', () => {
  const currentYear = new Date().getFullYear();

  beforeEach(() => {
    resetAllStores();
    vi.clearAllMocks();
    seedStore(useAuthStore, { isAuthenticated: true, user: buildUser() });
    seedStore(useVacayStore, { selectedYear: currentYear });
  });

  it('renders the read-only trip calendar dashboard', async () => {
    render(<VacayPage />);

    await waitFor(() => {
      expect(screen.getByTestId('vacay-calendar')).toBeInTheDocument();
    });
    expect(screen.getByText('Trip dates dashboard')).toBeInTheDocument();
    expect(screen.getAllByText('Trip day')[0]).toBeInTheDocument();
  });

  it('shows a fixed 10-year range before and after the current year', () => {
    render(<VacayPage />);

    expect(screen.getAllByRole('button', { name: String(currentYear - 10) })[0]).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: String(currentYear) })[0]).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: String(currentYear + 10) })[0]).toBeInTheDocument();
  });

  it('moves between years with chevrons instead of add/delete year controls', () => {
    const setSelectedYear = vi.fn();
    seedStore(useVacayStore, { selectedYear: currentYear, setSelectedYear });
    render(<VacayPage />);

    fireEvent.click(screen.getAllByRole('button', { name: 'Previous year' })[0]);
    expect(setSelectedYear).toHaveBeenCalledWith(currentYear - 1);

    fireEvent.click(screen.getAllByRole('button', { name: 'Next year' })[0]);
    expect(setSelectedYear).toHaveBeenCalledWith(currentYear + 1);

    expect(screen.queryByTitle(/add/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/remove year/i)).not.toBeInTheDocument();
  });

  it('does not expose removed Vacay editing controls', () => {
    render(<VacayPage />);

    expect(screen.queryByRole('button', { name: /settings/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/entitlement/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/persons/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/company/i)).not.toBeInTheDocument();
  });

  it('opens the mobile year selector drawer', async () => {
    render(<VacayPage />);

    fireEvent.click(screen.getByRole('button', { name: 'Year selector' }));
    await waitFor(() => {
      expect(screen.getAllByText(String(currentYear)).length).toBeGreaterThan(1);
    });
  });
});
