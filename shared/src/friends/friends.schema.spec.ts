import {
  friendFollowResponseSchema,
  friendProfileResponseSchema,
  friendsHubResponseSchema,
  friendsSearchResponseSchema,
} from './friends.schema';

import { describe, expect, it } from 'vitest';

const friendUser = {
  id: 2,
  username: 'atlasfan',
  avatar_url: '/uploads/avatars/a.png',
  follower_count: 7,
  following_count: 4,
  is_following: true,
  follows_you: false,
  shared_trip_count: 1,
};

const stats = {
  total_trips: 3,
  total_places: 14,
  total_countries: 5,
  total_days: 21,
  total_cities: 8,
  countries: [{ code: 'JP', trip_count: 2, place_count: 6, first_visit_year: 2024, last_visit_year: 2025 }],
  continents: { Asia: 1 },
  streak: 2,
  first_year: 2024,
  trips_this_year: 1,
};

describe('friends schemas', () => {
  it('accepts the social hub response shape', () => {
    expect(
      friendsHubResponseSchema.safeParse({
        me: { follower_count: 1, following_count: 2 },
        following: [friendUser],
        suggestions: [{ ...friendUser, id: 3, username: 'wander' }],
      }).success,
    ).toBe(true);
  });

  it('accepts search and follow responses', () => {
    expect(friendsSearchResponseSchema.safeParse({ users: [friendUser] }).success).toBe(true);
    expect(friendFollowResponseSchema.safeParse({ success: true, user: friendUser }).success).toBe(true);
  });

  it('accepts public-safe profile stats and shared trip cards', () => {
    expect(
      friendProfileResponseSchema.safeParse({
        user: friendUser,
        stats,
        shared_trips: [
          {
            id: 10,
            title: 'Tokyo spring',
            description: null,
            start_date: '2026-03-01',
            end_date: '2026-03-07',
            cover_image: null,
            token: 'token',
            day_count: 7,
            place_count: 12,
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
      }).success,
    ).toBe(true);
  });
});
