import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildSettings, buildUser } from '../../tests/helpers/factories';
import { server } from '../../tests/helpers/msw/server';
import { render, screen, waitFor } from '../../tests/helpers/render';
import { resetAllStores, seedStore } from '../../tests/helpers/store';
import { useAuthStore } from '../store/authStore';
import { useSettingsStore } from '../store/settingsStore';
import FriendsPage from './FriendsPage';

vi.mock('../components/Layout/Navbar', () => ({
  default: () => <nav data-testid="navbar" />,
}));

const mika = {
  id: 2,
  username: 'mika',
  avatar_url: '/uploads/avatars/mika.png',
  follower_count: 12,
  following_count: 4,
  is_following: false,
  follows_you: false,
  shared_trip_count: 1,
};

const leo = {
  id: 3,
  username: 'leo',
  avatar_url: null,
  follower_count: 3,
  following_count: 2,
  is_following: false,
  follows_you: true,
  shared_trip_count: 0,
};

const stats = {
  total_trips: 4,
  total_places: 19,
  total_countries: 6,
  total_days: 22,
  total_cities: 9,
  countries: [{ code: 'JP', trip_count: 2, place_count: 8, first_visit_year: 2025, last_visit_year: 2026 }],
  continents: { Europe: 1, Asia: 3, 'North America': 0, 'South America': 0, Africa: 1, Oceania: 1 },
  streak: 2,
  first_year: 2023,
  trips_this_year: 1,
};

function installFriendsHandlers(options: { empty?: boolean } = {}) {
  let leoFollowing = false;
  server.use(
    http.get('/api/friends', () =>
      HttpResponse.json(
        options.empty
          ? { me: { follower_count: 0, following_count: 0 }, following: [], suggestions: [] }
          : {
              me: { follower_count: 5, following_count: leoFollowing ? 1 : 0 },
              following: leoFollowing ? [{ ...leo, is_following: true }] : [],
              suggestions: leoFollowing ? [mika] : [mika, leo],
            },
      ),
    ),
    http.get('/api/friends/search', ({ request }) => {
      const q = new URL(request.url).searchParams.get('q')?.toLowerCase() ?? '';
      return HttpResponse.json({ users: q.includes('leo') ? [{ ...leo, is_following: leoFollowing }] : [] });
    }),
    http.get('/api/friends/users/:username', ({ params }) => {
      const username = String(params.username).toLowerCase();
      return HttpResponse.json({
        user: username === 'leo' ? { ...leo, is_following: leoFollowing } : mika,
        stats,
        shared_trips:
          username === 'leo'
            ? []
            : [
                {
                  id: 10,
                  title: 'Kyoto spring',
                  description: 'A public snapshot',
                  start_date: '2026-03-01',
                  end_date: '2026-03-03',
                  cover_image: null,
                  token: 'visible-token',
                  day_count: 3,
                  place_count: 8,
                  country_count: 1,
                  permissions: {
                    share_map: true,
                    share_bookings: false,
                    share_packing: false,
                    share_budget: false,
                    share_collab: false,
                  },
                },
              ],
      });
    }),
    http.post('/api/friends/3/follow', () => {
      leoFollowing = true;
      return HttpResponse.json({ success: true, user: { ...leo, is_following: true } });
    }),
    http.delete('/api/friends/3/follow', () => {
      leoFollowing = false;
      return HttpResponse.json({ success: true, user: leo });
    }),
  );
}

describe('FriendsPage', () => {
  beforeEach(() => {
    resetAllStores();
    vi.clearAllMocks();
    seedStore(useAuthStore, { isAuthenticated: true, user: buildUser() });
    seedStore(useSettingsStore, { settings: buildSettings() });
  });

  it('renders suggested traveler profile stats and visible shared trips', async () => {
    installFriendsHandlers();
    render(<FriendsPage />, { initialEntries: ['/friends'] });

    await waitFor(() => expect(screen.getByRole('heading', { name: /@mika/i })).toBeInTheDocument());
    expect(screen.getByText('Friends')).toBeInTheDocument();
    expect(screen.getByText('6')).toBeInTheDocument();
    expect(screen.getByText('Countries')).toBeInTheDocument();
    expect(screen.getByText('Kyoto spring')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /kyoto spring/i })).toHaveAttribute('href', '/shared/visible-token');
  });

  it('searches usernames and follows a traveler', async () => {
    installFriendsHandlers();
    const user = userEvent.setup();
    render(<FriendsPage />, { initialEntries: ['/friends'] });

    await waitFor(() => expect(screen.getByRole('heading', { name: /@mika/i })).toBeInTheDocument());
    await user.type(screen.getByLabelText(/search username/i), 'leo');
    await waitFor(() => expect(screen.getByText('@leo')).toBeInTheDocument());
    await user.click(screen.getByLabelText(/follow leo/i));

    await waitFor(() => expect(screen.getByLabelText(/unfollow leo/i)).toBeInTheDocument());
  });

  it('shows the first-friend empty state', async () => {
    installFriendsHandlers({ empty: true });
    render(<FriendsPage />, { initialEntries: ['/friends'] });

    await waitFor(() => expect(screen.getByText(/find your first travel friend/i)).toBeInTheDocument());
    expect(screen.getByText(/search a username/i)).toBeInTheDocument();
  });
});
