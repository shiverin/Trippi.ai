import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from '../../../tests/helpers/render';
import { server } from '../../../tests/helpers/msw/server';
import { resetAllStores } from '../../../tests/helpers/store';
import VacayCalendar from './VacayCalendar';

const monthCardSpy = vi.fn();

vi.mock('./VacayMonthCard', () => ({
  default: (props: { year: number; month: number; tripDates?: Set<string> }) => {
    monthCardSpy(props);
    return (
      <div data-testid={`month-card-${props.month}`}>
        {props.year}-{props.month}-{props.tripDates?.size ?? 0}
      </div>
    );
  },
}));

beforeEach(() => {
  resetAllStores();
  vi.clearAllMocks();
});

describe('VacayCalendar', () => {
  it('renders 12 read-only month cards for the selected year', () => {
    render(<VacayCalendar selectedYear={2026} />);

    expect(screen.getAllByTestId(/^month-card-/)).toHaveLength(12);
    expect(monthCardSpy).toHaveBeenCalledWith(expect.objectContaining({ year: 2026, month: 0 }));
  });

  it('loads trip dates for the selected year and passes them to every month card', async () => {
    server.use(
      http.get('/api/trips', () =>
        HttpResponse.json({
          trips: [
            { id: 1, start_date: '2026-03-10', end_date: '2026-03-12' },
            { id: 2, start_date: '2027-01-01', end_date: '2027-01-02' },
          ],
        })
      )
    );

    render(<VacayCalendar selectedYear={2026} />);

    await waitFor(() => {
      const marchCalls = monthCardSpy.mock.calls
        .map(([props]) => props)
        .filter((props) => props.month === 2);
      const latestMarchCall = marchCalls[marchCalls.length - 1];

      expect(latestMarchCall?.tripDates).toEqual(new Set(['2026-03-10', '2026-03-11', '2026-03-12']));
    });
  });

  it('does not render the old vacation/company edit mode toolbar', () => {
    render(<VacayCalendar selectedYear={2026} />);

    expect(screen.queryByText(/company/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/vacation/i)).not.toBeInTheDocument();
  });
});
