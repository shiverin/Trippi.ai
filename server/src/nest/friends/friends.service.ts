import { CONTINENT_MAP } from '@trippi/shared';
import type {
  FriendProfileResponse,
  FriendSharedTrip,
  FriendStats,
  FriendStatsCountry,
  FriendUser,
  FriendsHubResponse,
  FriendsSearchResponse,
} from '@trippi/shared';

import { asyncDb } from '../../db/asyncDatabase';
import { avatarUrl } from '../../services/avatarUrl';
import { Injectable } from '@nestjs/common';

type UserRow = { id: number; username: string; avatar?: string | null };
type TripRow = {
  id: number;
  title: string;
  description: string | null;
  start_date: string | null;
  end_date: string | null;
  cover_image: string | null;
};
type PlaceStatsRow = {
  id: number;
  trip_id: number;
  address: string | null;
  start_date: string | null;
  end_date: string | null;
  country_code: string | null;
};
type ShareTripRow = TripRow & {
  token: string;
  expires_at: string | null;
  share_map: number | null;
  share_bookings: number | null;
  share_packing: number | null;
  share_budget: number | null;
  share_collab: number | null;
};
type CountryAccumulator = FriendStatsCountry & { tripIds: Set<number>; years: Set<number> };

const EMPTY_CONTINENTS = {
  Europe: 0,
  Asia: 0,
  'North America': 0,
  'South America': 0,
  Africa: 0,
  Oceania: 0,
};

function isExpired(expiresAt: unknown): boolean {
  if (expiresAt == null || expiresAt === '') return false;
  const expiresTime = new Date(String(expiresAt)).getTime();
  return Number.isFinite(expiresTime) && expiresTime <= Date.now();
}

function normalizeUsername(value: unknown): string {
  return String(value ?? '').trim();
}

function clampSearch(value: unknown): string {
  return normalizeUsername(value).slice(0, 64);
}

function parseYear(value: string | null | undefined): number | null {
  if (!value) return null;
  const year = Number(String(value).slice(0, 4));
  return Number.isFinite(year) && year > 0 ? year : null;
}

function dayCount(start: string | null, end: string | null, fallback = 0): number {
  if (!start || !end) return fallback;
  const startTime = new Date(`${start}T00:00:00Z`).getTime();
  const endTime = new Date(`${end}T00:00:00Z`).getTime();
  if (!Number.isFinite(startTime) || !Number.isFinite(endTime) || endTime < startTime) return fallback;
  return Math.floor((endTime - startTime) / 86_400_000) + 1;
}

function extractCountryCodeFromAddress(address: string | null): string | null {
  if (!address) return null;
  const parts = address
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
  const last = parts.at(-1)?.toUpperCase() ?? '';
  return /^[A-Z]{2}$/.test(last) ? last : null;
}

function extractCityFromAddress(address: string | null): string | null {
  if (!address) return null;
  const parts = address
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
  const city = parts.length >= 2 ? parts.at(-2) : parts.at(0);
  return city ? city.toLowerCase() : null;
}

function countryForPlace(place: PlaceStatsRow): string | null {
  const cached = place.country_code?.trim().toUpperCase();
  if (cached && /^[A-Z]{2}$/.test(cached)) return cached;
  return extractCountryCodeFromAddress(place.address);
}

function buildStreak(years: Iterable<number>): number {
  const set = new Set(years);
  if (set.size === 0) return 0;
  let current = new Date().getFullYear();
  if (!set.has(current)) current -= 1;
  let streak = 0;
  while (set.has(current)) {
    streak += 1;
    current -= 1;
  }
  return streak;
}

function blankCountry(code: string): CountryAccumulator {
  return {
    code,
    trip_count: 0,
    place_count: 0,
    first_visit_year: null,
    last_visit_year: null,
    tripIds: new Set<number>(),
    years: new Set<number>(),
  };
}

function toFriendUser(
  row: UserRow,
  meta: {
    follower_count: number;
    following_count: number;
    is_following: boolean;
    follows_you: boolean;
    shared_trip_count?: number;
  },
): FriendUser {
  return {
    id: Number(row.id),
    username: row.username,
    avatar_url: avatarUrl(row),
    follower_count: meta.follower_count,
    following_count: meta.following_count,
    is_following: meta.is_following,
    follows_you: meta.follows_you,
    shared_trip_count: meta.shared_trip_count,
  };
}

@Injectable()
export class FriendsService {
  async hub(viewerId: number): Promise<FriendsHubResponse> {
    const [follower_count, following_count] = await Promise.all([
      this.countFollowers(viewerId),
      this.countFollowing(viewerId),
    ]);

    const followingRows = await asyncDb
      .prepare(
        `
        SELECT u.id, u.username, u.avatar
        FROM user_follows f
        JOIN users u ON u.id = f.followed_id
        WHERE f.follower_id = ?
        ORDER BY f.created_at DESC, LOWER(u.username) ASC
        LIMIT 24
      `,
      )
      .all<UserRow>(viewerId);

    const suggestionRows = await asyncDb
      .prepare(
        `
        SELECT u.id, u.username, u.avatar
        FROM users u
        LEFT JOIN user_follows f ON f.followed_id = u.id AND f.follower_id = ?
        WHERE u.id != ? AND f.followed_id IS NULL
        ORDER BY LOWER(u.username) ASC
        LIMIT 12
      `,
      )
      .all<UserRow>(viewerId, viewerId);

    return {
      me: { follower_count, following_count },
      following: await this.decorateUsers(followingRows, viewerId),
      suggestions: await this.decorateUsers(suggestionRows, viewerId),
    };
  }

  async search(viewerId: number, rawQuery: unknown): Promise<FriendsSearchResponse> {
    const q = clampSearch(rawQuery);
    if (q.length === 0) return { users: [] };
    const lower = q.toLowerCase();
    const rows = await asyncDb
      .prepare(
        `
        SELECT id, username, avatar
        FROM users
        WHERE id != ? AND LOWER(username) LIKE ?
        ORDER BY
          CASE
            WHEN LOWER(username) = ? THEN 0
            WHEN LOWER(username) LIKE ? THEN 1
            ELSE 2
          END,
          LOWER(username) ASC
        LIMIT 20
      `,
      )
      .all<UserRow>(viewerId, `%${lower}%`, lower, `${lower}%`);

    return { users: await this.decorateUsers(rows, viewerId) };
  }

  async profile(viewerId: number, rawUsername: string): Promise<FriendProfileResponse | null> {
    const username = normalizeUsername(rawUsername);
    if (!username) return null;
    const user = await asyncDb
      .prepare('SELECT id, username, avatar FROM users WHERE LOWER(username) = LOWER(?)')
      .get<UserRow>(username);
    if (!user) return null;

    const [decorated] = await this.decorateUsers([user], viewerId);
    const [stats, shared_trips] = await Promise.all([this.statsForUser(user.id), this.sharedTripsForUser(user.id)]);
    return { user: decorated, stats, shared_trips };
  }

  async follow(viewerId: number, userId: number): Promise<FriendUser | null> {
    if (viewerId === userId) throw new Error('SELF_FOLLOW');
    const user = await asyncDb.prepare('SELECT id, username, avatar FROM users WHERE id = ?').get<UserRow>(userId);
    if (!user) return null;
    await asyncDb.prepare('INSERT OR IGNORE INTO user_follows (follower_id, followed_id) VALUES (?, ?)').run(viewerId, userId);
    return (await this.decorateUsers([user], viewerId))[0];
  }

  async unfollow(viewerId: number, userId: number): Promise<FriendUser | null> {
    await asyncDb.prepare('DELETE FROM user_follows WHERE follower_id = ? AND followed_id = ?').run(viewerId, userId);
    const user = await asyncDb.prepare('SELECT id, username, avatar FROM users WHERE id = ?').get<UserRow>(userId);
    return user ? (await this.decorateUsers([user], viewerId))[0] : null;
  }

  private async decorateUsers(rows: UserRow[], viewerId: number): Promise<FriendUser[]> {
    if (rows.length === 0) return [];
    return Promise.all(
      rows.map(async (row) => {
        const [follower_count, following_count, is_following, follows_you, shared_trip_count] = await Promise.all([
          this.countFollowers(row.id),
          this.countFollowing(row.id),
          this.hasFollow(viewerId, row.id),
          this.hasFollow(row.id, viewerId),
          this.countProfileVisibleTrips(row.id),
        ]);
        return toFriendUser(row, { follower_count, following_count, is_following, follows_you, shared_trip_count });
      }),
    );
  }

  private async countFollowers(userId: number): Promise<number> {
    const row = await asyncDb
      .prepare('SELECT COUNT(*) as count FROM user_follows WHERE followed_id = ?')
      .get<{ count: number }>(userId);
    return Number(row?.count ?? 0);
  }

  private async countFollowing(userId: number): Promise<number> {
    const row = await asyncDb
      .prepare('SELECT COUNT(*) as count FROM user_follows WHERE follower_id = ?')
      .get<{ count: number }>(userId);
    return Number(row?.count ?? 0);
  }

  private async hasFollow(followerId: number, followedId: number): Promise<boolean> {
    if (followerId === followedId) return false;
    const row = await asyncDb
      .prepare('SELECT 1 FROM user_follows WHERE follower_id = ? AND followed_id = ?')
      .get(followerId, followedId);
    return !!row;
  }

  private async countProfileVisibleTrips(userId: number): Promise<number> {
    const rows = await asyncDb
      .prepare(
        `
        SELECT st.expires_at
        FROM share_tokens st
        JOIN trips t ON t.id = st.trip_id
        WHERE t.user_id = ? AND st.profile_visible = 1
      `,
      )
      .all<{ expires_at: string | null }>(userId);
    return rows.filter((row) => !isExpired(row.expires_at)).length;
  }

  private async statsForUser(userId: number): Promise<FriendStats> {
    const trips = await asyncDb
      .prepare(
        `
        SELECT id, title, description, start_date, end_date, cover_image
        FROM trips
        WHERE user_id = ? AND COALESCE(is_archived, 0) = 0
      `,
      )
      .all<TripRow>(userId);

    const tripIds = trips.map((trip) => trip.id);
    const years = trips.map((trip) => parseYear(trip.start_date ?? trip.end_date)).filter((year): year is number => !!year);
    const firstYear = years.length > 0 ? Math.min(...years) : null;
    const thisYear = new Date().getFullYear();
    const tripsThisYear = years.filter((year) => year === thisYear).length;
    const totalDays = trips.reduce((sum, trip) => sum + dayCount(trip.start_date, trip.end_date, 0), 0);

    if (tripIds.length === 0) {
      return {
        total_trips: 0,
        total_places: 0,
        total_countries: 0,
        total_days: 0,
        total_cities: 0,
        countries: [],
        continents: { ...EMPTY_CONTINENTS },
        streak: 0,
        first_year: null,
        trips_this_year: 0,
      };
    }

    const placeholders = tripIds.map(() => '?').join(',');
    const places = await asyncDb
      .prepare(
        `
        SELECT p.id, p.trip_id, p.address, t.start_date, t.end_date, pr.country_code
        FROM places p
        JOIN trips t ON t.id = p.trip_id
        LEFT JOIN place_regions pr ON pr.place_id = p.id
        WHERE p.trip_id IN (${placeholders})
      `,
      )
      .all<PlaceStatsRow>(...tripIds);

    const manualCountries = await asyncDb
      .prepare('SELECT country_code FROM visited_countries WHERE user_id = ?')
      .all<{ country_code: string }>(userId);

    const countryMap = new Map<string, CountryAccumulator>();
    const cities = new Set<string>();
    for (const place of places) {
      const city = extractCityFromAddress(place.address);
      if (city) cities.add(city);

      const code = countryForPlace(place);
      if (!code) continue;
      if (!countryMap.has(code)) countryMap.set(code, blankCountry(code));
      const item = countryMap.get(code)!;
      item.place_count += 1;
      item.tripIds.add(Number(place.trip_id));
      const year = parseYear(place.start_date ?? place.end_date);
      if (year) item.years.add(year);
    }

    for (const row of manualCountries) {
      const code = row.country_code?.trim().toUpperCase();
      if (!code || !/^[A-Z]{2}$/.test(code)) continue;
      if (!countryMap.has(code)) countryMap.set(code, blankCountry(code));
    }

    const countries = [...countryMap.values()]
      .map((item) => {
        const countryYears = [...item.years].sort((a, b) => a - b);
        return {
          code: item.code,
          trip_count: item.tripIds.size,
          place_count: item.place_count,
          first_visit_year: countryYears[0] ?? null,
          last_visit_year: countryYears.at(-1) ?? null,
        };
      })
      .sort((a, b) => b.place_count - a.place_count || a.code.localeCompare(b.code));

    const continents = { ...EMPTY_CONTINENTS };
    for (const country of countries) {
      const continent = CONTINENT_MAP[country.code] as keyof typeof continents | undefined;
      if (continent) continents[continent] = (continents[continent] ?? 0) + 1;
    }

    return {
      total_trips: trips.length,
      total_places: places.length,
      total_countries: countries.length,
      total_days: totalDays,
      total_cities: cities.size,
      countries,
      continents,
      streak: buildStreak(years),
      first_year: firstYear,
      trips_this_year: tripsThisYear,
    };
  }

  private async sharedTripsForUser(userId: number): Promise<FriendSharedTrip[]> {
    const rows = await asyncDb
      .prepare(
        `
        SELECT t.id, t.title, t.description, t.start_date, t.end_date, t.cover_image,
               st.token, st.expires_at, st.share_map, st.share_bookings, st.share_packing, st.share_budget, st.share_collab
        FROM share_tokens st
        JOIN trips t ON t.id = st.trip_id
        WHERE t.user_id = ? AND st.profile_visible = 1
        ORDER BY st.created_at DESC
        LIMIT 12
      `,
      )
      .all<ShareTripRow>(userId);

    const visibleRows = rows.filter((row) => !isExpired(row.expires_at));
    return Promise.all(
      visibleRows.map(async (row) => {
        const [days, places, countries] = await Promise.all([
          asyncDb.prepare('SELECT COUNT(*) as count FROM days WHERE trip_id = ?').get<{ count: number }>(row.id),
          asyncDb.prepare('SELECT COUNT(*) as count FROM places WHERE trip_id = ?').get<{ count: number }>(row.id),
          this.countryCountForTrip(row.id),
        ]);
        return {
          id: Number(row.id),
          title: row.title,
          description: row.description,
          start_date: row.start_date,
          end_date: row.end_date,
          cover_image: row.cover_image,
          token: row.token,
          day_count: Number(days?.count ?? dayCount(row.start_date, row.end_date, 0)),
          place_count: Number(places?.count ?? 0),
          country_count: countries,
          permissions: {
            share_map: !!row.share_map,
            share_bookings: !!row.share_bookings,
            share_packing: !!row.share_packing,
            share_budget: !!row.share_budget,
            share_collab: !!row.share_collab,
          },
        };
      }),
    );
  }

  private async countryCountForTrip(tripId: number): Promise<number> {
    const places = await asyncDb
      .prepare(
        `
        SELECT p.id, p.trip_id, p.address, t.start_date, t.end_date, pr.country_code
        FROM places p
        JOIN trips t ON t.id = p.trip_id
        LEFT JOIN place_regions pr ON pr.place_id = p.id
        WHERE p.trip_id = ?
      `,
      )
      .all<PlaceStatsRow>(tripId);
    return new Set(places.map(countryForPlace).filter(Boolean)).size;
  }
}
