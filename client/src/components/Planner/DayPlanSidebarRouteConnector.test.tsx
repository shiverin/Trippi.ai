import { render, screen } from '../../../tests/helpers/render';
import type { RouteSegment } from '../../types';
import { RouteSuggestionConnector } from './DayPlanSidebarRouteConnector';

const segment: RouteSegment = {
  mid: [0, 0],
  from: [0, 0],
  to: [1, 1],
  distance: 250000,
  duration: 7200,
  walkingText: '2d 3h',
  drivingText: '2h',
  distanceText: '250 km',
  durationText: '2h',
};

describe('RouteSuggestionConnector', () => {
  it('shows train and flight suggestions for non-local gaps', () => {
    render(<RouteSuggestionConnector seg={segment} sameCity={false} distanceUnit="metric" />);

    expect(screen.getByText('Suggested transfer')).toBeInTheDocument();
    expect(screen.getByText('250 km')).toBeInTheDocument();
    expect(screen.getByText('Train')).toBeInTheDocument();
    expect(screen.getByText('Flight')).toBeInTheDocument();
    expect(screen.getByText('Car')).toBeInTheDocument();
  });
});
