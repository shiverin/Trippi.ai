import { asyncDb } from '../db/asyncDatabase';
import { resolveDbProvider } from '../db/providerMode';

const INDEXES = [
  {
    name: 'idx_users_lower_username',
    sqlite: 'CREATE INDEX IF NOT EXISTS idx_users_lower_username ON users(LOWER(username))',
    oracle: 'CREATE INDEX idx_users_lower_username ON users(LOWER(username))',
  },
  {
    name: 'idx_user_follows_follower',
    sqlite: 'CREATE INDEX IF NOT EXISTS idx_user_follows_follower ON user_follows(follower_id, created_at DESC)',
    oracle: 'CREATE INDEX idx_user_follows_follower ON user_follows(follower_id, created_at DESC)',
  },
  {
    name: 'idx_user_follows_followed',
    sqlite: 'CREATE INDEX IF NOT EXISTS idx_user_follows_followed ON user_follows(followed_id, created_at DESC)',
    oracle: 'CREATE INDEX idx_user_follows_followed ON user_follows(followed_id, created_at DESC)',
  },
  {
    name: 'idx_trips_user_archived',
    sqlite: 'CREATE INDEX IF NOT EXISTS idx_trips_user_archived ON trips(user_id, is_archived, start_date, end_date)',
    oracle: 'CREATE INDEX idx_trips_user_archived ON trips(user_id, is_archived, start_date, end_date)',
  },
  {
    name: 'idx_share_tokens_profile',
    sqlite:
      'CREATE INDEX IF NOT EXISTS idx_share_tokens_profile ON share_tokens(profile_visible, trip_id, created_at)',
    oracle: 'CREATE INDEX idx_share_tokens_profile ON share_tokens(profile_visible, trip_id, created_at)',
  },
  {
    name: 'idx_place_regions_place',
    sqlite: 'CREATE INDEX IF NOT EXISTS idx_place_regions_place ON place_regions(place_id)',
    oracle: 'CREATE INDEX idx_place_regions_place ON place_regions(place_id)',
  },
  {
    name: 'idx_bucket_user_created',
    sqlite: 'CREATE INDEX IF NOT EXISTS idx_bucket_user_created ON bucket_list(user_id, created_at DESC)',
    oracle: 'CREATE INDEX idx_bucket_user_created ON bucket_list(user_id, created_at DESC)',
  },
  {
    name: 'idx_visited_countries_user',
    sqlite: 'CREATE INDEX IF NOT EXISTS idx_visited_countries_user ON visited_countries(user_id, country_code)',
    oracle: 'CREATE INDEX idx_visited_countries_user ON visited_countries(user_id, country_code)',
  },
  {
    name: 'idx_visited_regions_user',
    sqlite: 'CREATE INDEX IF NOT EXISTS idx_visited_regions_user ON visited_regions(user_id, country_code)',
    oracle: 'CREATE INDEX idx_visited_regions_user ON visited_regions(user_id, country_code)',
  },
  {
    name: 'idx_vacay_members_user',
    sqlite: 'CREATE INDEX IF NOT EXISTS idx_vacay_members_user ON vacay_plan_members(user_id, status, plan_id)',
    oracle: 'CREATE INDEX idx_vacay_members_user ON vacay_plan_members(user_id, status, plan_id)',
  },
  {
    name: 'idx_vacay_members_plan',
    sqlite: 'CREATE INDEX IF NOT EXISTS idx_vacay_members_plan ON vacay_plan_members(plan_id, status, user_id)',
    oracle: 'CREATE INDEX idx_vacay_members_plan ON vacay_plan_members(plan_id, status, user_id)',
  },
  {
    name: 'idx_vacay_entries_plan_date',
    sqlite: 'CREATE INDEX IF NOT EXISTS idx_vacay_entries_plan_date ON vacay_entries(plan_id, date)',
    oracle: 'CREATE INDEX idx_vacay_entries_plan_date ON vacay_entries(plan_id, date)',
  },
  {
    name: 'idx_vacay_entries_user_date',
    sqlite: 'CREATE INDEX IF NOT EXISTS idx_vacay_entries_user_date ON vacay_entries(user_id, plan_id, date)',
    oracle: 'CREATE INDEX idx_vacay_entries_user_date ON vacay_entries(user_id, plan_id, date)',
  },
  {
    name: 'idx_vacay_holidays_plan_date',
    sqlite:
      'CREATE INDEX IF NOT EXISTS idx_vacay_holidays_plan_date ON vacay_company_holidays(plan_id, date)',
    oracle: 'CREATE INDEX idx_vacay_holidays_plan_date ON vacay_company_holidays(plan_id, date)',
  },
  {
    name: 'idx_vacay_years_plan_year',
    sqlite: 'CREATE INDEX IF NOT EXISTS idx_vacay_years_plan_year ON vacay_years(plan_id, year)',
    oracle: 'CREATE INDEX idx_vacay_years_plan_year ON vacay_years(plan_id, year)',
  },
  {
    name: 'idx_vacay_colors_plan_user',
    sqlite: 'CREATE INDEX IF NOT EXISTS idx_vacay_colors_plan_user ON vacay_user_colors(plan_id, user_id)',
    oracle: 'CREATE INDEX idx_vacay_colors_plan_user ON vacay_user_colors(plan_id, user_id)',
  },
  {
    name: 'idx_idem_lookup',
    sqlite: 'CREATE INDEX IF NOT EXISTS idx_idem_lookup ON idempotency_keys(key, user_id, method, path)',
    oracle: 'CREATE INDEX idx_idem_lookup ON idempotency_keys(key, user_id, method, path)',
  },
  {
    name: 'idx_journey_entries_source',
    sqlite: 'CREATE INDEX IF NOT EXISTS idx_journey_entries_source ON journey_entries(source_place_id)',
    oracle: 'CREATE INDEX idx_journey_entries_source ON journey_entries(source_place_id)',
  },
] as const;

let ensurePromise: Promise<void> | null = null;

function isIgnorableDdlError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /ORA-00942|ORA-00955|ORA-01408|already exists|no such table/i.test(message);
}

async function createIndex(sql: string, name: string): Promise<void> {
  try {
    await asyncDb.exec(sql);
  } catch (err) {
    if (isIgnorableDdlError(err)) return;
    throw new Error(`${name}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export function ensurePerformanceIndexes(): Promise<void> {
  if (!ensurePromise) {
    ensurePromise = (async () => {
      const useOracleDdl = resolveDbProvider() === 'oracle-async';
      for (const index of INDEXES) {
        await createIndex(useOracleDdl ? index.oracle : index.sqlite, index.name);
      }
      console.info(`[DB] Performance indexes ensured (${INDEXES.length})`);
    })().catch((err) => {
      ensurePromise = null;
      throw err;
    });
  }
  return ensurePromise;
}
