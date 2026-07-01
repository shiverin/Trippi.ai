import type { FriendProfileResponse, FriendSharedTrip, FriendStats, FriendUser } from '@trippi/shared';
import {
  CalendarDays,
  Check,
  ExternalLink,
  Globe2,
  Loader2,
  Search,
  UserCheck,
  UserPlus,
  Users,
} from 'lucide-react';
import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { friendsApi } from '../api/client';
import PageShell from '../components/Layout/PageShell';
import { useToast } from '../components/shared/Toast';
import { useTranslation } from '../i18n';
import { getApiErrorMessage } from '../types';
import { resolveMediaUrl } from '../utils/mediaUrl';

function initials(username: string): string {
  return username.slice(0, 2).toUpperCase();
}

function Avatar({ user, size = 44 }: { user: Pick<FriendUser, 'username' | 'avatar_url'>; size?: number }) {
  const avatar = resolveMediaUrl(user.avatar_url);
  return (
    <div
      className="flex shrink-0 items-center justify-center overflow-hidden rounded-full border border-white/60 bg-gradient-to-br from-emerald-300 via-sky-300 to-violet-300 text-sm font-black text-slate-950 shadow-sm"
      style={{ width: size, height: size }}
    >
      {avatar ? <img src={avatar} alt="" className="h-full w-full object-cover" /> : initials(user.username)}
    </div>
  );
}

function StatTile({ value, label }: { value: React.ReactNode; label: string }) {
  return (
    <div className="min-w-0 rounded-lg border border-edge bg-surface-card px-3 py-3">
      <div className="truncate text-2xl font-black tabular-nums text-content">{value}</div>
      <div className="mt-1 truncate text-[11px] font-semibold uppercase text-content-faint">{label}</div>
    </div>
  );
}

function UserRow({
  user,
  active,
  onSelect,
  onFollow,
  busy,
}: {
  user: FriendUser;
  active?: boolean;
  onSelect: () => void;
  onFollow: () => void;
  busy?: boolean;
}) {
  const Icon = user.is_following ? UserCheck : UserPlus;
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`group flex w-full min-w-0 items-center gap-3 rounded-lg border px-3 py-3 text-left transition ${
        active
          ? 'border-content/20 bg-surface-secondary shadow-sm'
          : 'border-edge bg-surface-card hover:border-content/15 hover:bg-surface-secondary'
      }`}
    >
      <Avatar user={user} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-bold text-content">@{user.username}</div>
        <div className="mt-1 flex min-w-0 items-center gap-2 text-[11px] font-semibold uppercase text-content-faint">
          <span>{user.follower_count} followers</span>
          <span className="h-1 w-1 rounded-full bg-content-faint/40" />
          <span>{user.shared_trip_count ?? 0} shared</span>
        </div>
      </div>
      <span
        role="button"
        tabIndex={-1}
        onClick={(event) => {
          event.stopPropagation();
          onFollow();
        }}
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-edge bg-surface text-content transition group-hover:scale-105"
        aria-label={user.is_following ? `Unfollow ${user.username}` : `Follow ${user.username}`}
      >
        {busy ? <Loader2 size={16} className="animate-spin" /> : <Icon size={17} />}
      </span>
    </button>
  );
}

function ProfileHeader({
  profile,
  busy,
  onFollow,
}: {
  profile: FriendProfileResponse;
  busy?: boolean;
  onFollow: (user: FriendUser) => void;
}) {
  const { user } = profile;
  return (
    <div className="rounded-lg border border-edge bg-surface-card p-4 shadow-sm">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-4">
          <Avatar user={user} size={72} />
          <div className="min-w-0">
            <h1 className="truncate text-2xl font-black text-content">@{user.username}</h1>
            <div className="mt-2 flex flex-wrap gap-2 text-xs font-semibold text-content-muted">
              <span>{user.follower_count} followers</span>
              <span>{user.following_count} following</span>
              {user.follows_you ? <span className="text-emerald-600 dark:text-emerald-300">Follows you</span> : null}
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={() => onFollow(user)}
          disabled={busy}
          className="inline-flex h-11 items-center justify-center gap-2 rounded-full bg-content px-5 text-sm font-bold text-surface transition hover:opacity-90 disabled:opacity-60"
        >
          {busy ? (
            <Loader2 size={17} className="animate-spin" />
          ) : user.is_following ? (
            <UserCheck size={17} />
          ) : (
            <UserPlus size={17} />
          )}
          {user.is_following ? 'Following' : 'Follow'}
        </button>
      </div>
    </div>
  );
}

function StatsPanel({ stats }: { stats: FriendStats }) {
  return (
    <section className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <StatTile value={stats.total_countries} label="Countries" />
        <StatTile value={stats.total_trips} label="Trips" />
        <StatTile value={stats.total_places} label="Places" />
        <StatTile value={stats.total_cities} label="Cities" />
        <StatTile value={stats.total_days} label="Days" />
      </div>
    </section>
  );
}

function permissionLabels(trip: FriendSharedTrip): string[] {
  const labels: string[] = ['Map'];
  if (trip.permissions.share_bookings) labels.push('Bookings');
  if (trip.permissions.share_packing) labels.push('Lists');
  if (trip.permissions.share_budget) labels.push('Costs');
  if (trip.permissions.share_collab) labels.push('Collab');
  return labels;
}

function SharedTripCard({ trip }: { trip: FriendSharedTrip }) {
  const cover = resolveMediaUrl(trip.cover_image);
  return (
    <Link
      to={`/shared/${trip.token}`}
      className="group flex min-w-0 flex-col overflow-hidden rounded-lg border border-edge bg-surface-card transition hover:-translate-y-0.5 hover:border-content/20 hover:shadow-md"
    >
      <div
        className="h-28 bg-surface-secondary"
        style={{
          backgroundImage: cover
            ? `linear-gradient(180deg, rgba(0,0,0,0.02), rgba(0,0,0,0.24)), url(${cover})`
            : 'linear-gradient(135deg, rgba(16,185,129,0.22), rgba(14,165,233,0.2), rgba(168,85,247,0.18))',
          backgroundSize: 'cover',
          backgroundPosition: 'center',
        }}
      />
      <div className="flex min-h-[172px] flex-1 flex-col p-4">
        <div className="flex min-w-0 items-start justify-between gap-3">
          <h3 className="line-clamp-2 text-base font-black text-content">{trip.title}</h3>
          <ExternalLink size={17} className="mt-0.5 shrink-0 text-content-faint transition group-hover:text-content" />
        </div>
        <p className="mt-2 line-clamp-2 text-sm text-content-muted">
          {trip.description || 'A published travel snapshot from this profile.'}
        </p>
        <div className="mt-auto flex flex-wrap gap-2 pt-4">
          <span className="inline-flex items-center gap-1 rounded-full bg-surface-secondary px-2.5 py-1 text-[11px] font-bold text-content-muted">
            <CalendarDays size={12} />
            {trip.day_count} days
          </span>
          <span className="rounded-full bg-surface-secondary px-2.5 py-1 text-[11px] font-bold text-content-muted">
            {trip.place_count} places
          </span>
          <span className="rounded-full bg-surface-secondary px-2.5 py-1 text-[11px] font-bold text-content-muted">
            {trip.country_count} countries
          </span>
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {permissionLabels(trip).map((label) => (
            <span key={label} className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-1 text-[10px] font-black uppercase text-emerald-700 dark:text-emerald-300">
              <Check size={11} />
              {label}
            </span>
          ))}
        </div>
      </div>
    </Link>
  );
}

export default function FriendsPage(): React.ReactElement {
  const { t } = useTranslation();
  const toast = useToast();
  const [hub, setHub] = useState<{ following: FriendUser[]; suggestions: FriendUser[]; me: { follower_count: number; following_count: number } } | null>(null);
  const [selected, setSelected] = useState<FriendProfileResponse | null>(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<FriendUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);
  const [profileLoading, setProfileLoading] = useState(false);
  const [busyUserId, setBusyUserId] = useState<number | null>(null);

  const loadHub = async () => {
    const data = await friendsApi.hub();
    setHub(data);
    return data;
  };

  const openProfile = async (username: string) => {
    setProfileLoading(true);
    try {
      const profile = await friendsApi.profile(username);
      setSelected(profile);
    } catch (err) {
      toast.error(getApiErrorMessage(err, t('common.error')));
    } finally {
      setProfileLoading(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    loadHub()
      .then((data) => {
        if (cancelled) return;
        const first = data.following[0] ?? data.suggestions[0];
        if (first) void openProfile(first.username);
      })
      .catch((err) => toast.error(getApiErrorMessage(err, t('common.error'))))
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length === 0) {
      setResults([]);
      setSearching(false);
      return;
    }
    const timer = window.setTimeout(() => {
      setSearching(true);
      friendsApi
        .search(trimmed)
        .then((data) => setResults(data.users))
        .catch((err) => toast.error(getApiErrorMessage(err, t('common.error'))))
        .finally(() => setSearching(false));
    }, 260);
    return () => window.clearTimeout(timer);
  }, [query]);

  const toggleFollow = async (user: FriendUser) => {
    setBusyUserId(user.id);
    try {
      if (user.is_following) await friendsApi.unfollow(user.id);
      else await friendsApi.follow(user.id);
      const [nextHub, nextProfile] = await Promise.all([
        loadHub(),
        selected?.user.id === user.id ? friendsApi.profile(user.username) : Promise.resolve(null),
      ]);
      if (nextProfile) setSelected(nextProfile);
      setResults((prev) =>
        prev.map((item) => {
          const fresh = [...nextHub.following, ...nextHub.suggestions].find((candidate) => candidate.id === item.id);
          return fresh ?? item;
        }),
      );
    } catch (err) {
      toast.error(getApiErrorMessage(err, t('common.error')));
    } finally {
      setBusyUserId(null);
    }
  };

  if (loading) {
    return (
      <PageShell background="var(--bg-primary)" contentClassName="flex min-h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-edge border-t-content" />
      </PageShell>
    );
  }

  return (
    <PageShell background="var(--bg-primary)" contentClassName="min-h-screen px-4 pb-28 md:px-8 md:pb-12">
      <div className="mx-auto max-w-7xl py-6 md:py-8">
        <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-edge bg-surface-card px-3 py-1 text-xs font-black uppercase text-content-muted">
              <Users size={14} />
              Social atlas
            </div>
            <h1 className="text-3xl font-black text-content md:text-5xl">Friends</h1>
            <p className="mt-2 max-w-2xl text-sm font-medium text-content-muted md:text-base">
              Find travelers by username, follow their journeys, and browse the trip snapshots they choose to share.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:w-80">
            <StatTile value={hub?.me.following_count ?? 0} label="Following" />
            <StatTile value={hub?.me.follower_count ?? 0} label="Followers" />
          </div>
        </div>

        <div className="grid gap-5 lg:grid-cols-[360px_minmax(0,1fr)]">
          <aside className="space-y-4">
            <div className="rounded-lg border border-edge bg-surface-card p-3 shadow-sm">
              <label className="mb-2 flex items-center gap-2 text-xs font-black uppercase text-content-faint" htmlFor="friend-search">
                <Search size={14} />
                Search username
              </label>
              <div className="relative">
                <Search size={17} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-content-faint" />
                <input
                  id="friend-search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Try @atlasfan"
                  className="h-11 w-full rounded-lg border border-edge bg-surface-secondary pl-10 pr-10 text-sm font-semibold text-content outline-none transition placeholder:text-content-faint focus:border-content/30"
                />
                {searching ? (
                  <Loader2 size={16} className="absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-content-faint" />
                ) : null}
              </div>
            </div>

            <div className="space-y-3">
              {query.trim() ? (
                <>
                  <div className="text-xs font-black uppercase text-content-faint">Search results</div>
                  {results.length > 0 ? (
                    results.map((user) => (
                      <UserRow
                        key={user.id}
                        user={user}
                        active={selected?.user.id === user.id}
                        onSelect={() => void openProfile(user.username)}
                        onFollow={() => void toggleFollow(user)}
                        busy={busyUserId === user.id}
                      />
                    ))
                  ) : (
                    <div className="rounded-lg border border-dashed border-edge bg-surface-card px-4 py-8 text-center text-sm font-semibold text-content-muted">
                      No usernames found yet.
                    </div>
                  )}
                </>
              ) : (
                <>
                  <div className="text-xs font-black uppercase text-content-faint">Your circle</div>
                  {(hub?.following.length ?? 0) > 0 ? (
                    hub?.following.map((user) => (
                      <UserRow
                        key={user.id}
                        user={user}
                        active={selected?.user.id === user.id}
                        onSelect={() => void openProfile(user.username)}
                        onFollow={() => void toggleFollow(user)}
                        busy={busyUserId === user.id}
                      />
                    ))
                  ) : (
                    <div className="rounded-lg border border-dashed border-edge bg-surface-card px-4 py-6 text-sm font-semibold text-content-muted">
                      Follow a traveler to start building your circle.
                    </div>
                  )}

                  <div className="pt-2 text-xs font-black uppercase text-content-faint">Suggested travelers</div>
                  {(hub?.suggestions.length ?? 0) > 0 ? (
                    hub?.suggestions.map((user) => (
                      <UserRow
                        key={user.id}
                        user={user}
                        active={selected?.user.id === user.id}
                        onSelect={() => void openProfile(user.username)}
                        onFollow={() => void toggleFollow(user)}
                        busy={busyUserId === user.id}
                      />
                    ))
                  ) : null}
                </>
              )}
            </div>
          </aside>

          <main className="min-w-0 space-y-5">
            {profileLoading && !selected ? (
              <div className="flex min-h-[520px] items-center justify-center rounded-lg border border-edge bg-surface-card">
                <Loader2 className="animate-spin text-content-muted" size={28} />
              </div>
            ) : selected ? (
              <>
                <ProfileHeader profile={selected} busy={busyUserId === selected.user.id} onFollow={toggleFollow} />
                <StatsPanel stats={selected.stats} />
                <section className="space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <h2 className="text-xl font-black text-content">Shared trips</h2>
                      <p className="text-sm font-medium text-content-muted">Only trips this traveler has explicitly shown on their profile.</p>
                    </div>
                  </div>
                  {selected.shared_trips.length > 0 ? (
                    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                      {selected.shared_trips.map((trip) => (
                        <SharedTripCard key={trip.token} trip={trip} />
                      ))}
                    </div>
                  ) : (
                    <div className="rounded-lg border border-dashed border-edge bg-surface-card px-6 py-10 text-center">
                      <Globe2 className="mx-auto mb-3 text-content-faint" size={28} />
                      <p className="text-sm font-bold text-content">No shared trips on this profile yet.</p>
                      <p className="mt-1 text-sm text-content-muted">When they publish a trip, it will appear here.</p>
                    </div>
                  )}
                </section>
              </>
            ) : (
              <div className="flex min-h-[520px] flex-col items-center justify-center rounded-lg border border-dashed border-edge bg-surface-card px-6 text-center">
                <Users className="mb-4 text-content-faint" size={34} />
                <h2 className="text-xl font-black text-content">Find your first travel friend</h2>
                <p className="mt-2 max-w-md text-sm font-medium text-content-muted">
                  Search a username or pick from suggestions to inspect a public-safe travel profile.
                </p>
              </div>
            )}
          </main>
        </div>
      </div>
    </PageShell>
  );
}
