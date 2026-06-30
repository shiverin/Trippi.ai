# Oracle Autonomous Database Rewrite Spike

> **Internal operator/developer documentation:** This migration spike is for maintainers and service operators.
> It is not public product positioning or customer onboarding copy.

For the current switch-over/runbook state, start with
[`oracle-native-migration-handoff.md`](./oracle-native-migration-handoff.md). This older note records the initial spike and bridge-mode reasoning.

This branch is an experiment for using Oracle Cloud Always Free Autonomous Database with Trippi.

## Free-tier check

Oracle documents Autonomous AI Database as an Always Free resource with up to two Always Free databases and 20 GB of storage per database. Oracle also states that Always Free resources are not charged unless upgraded to paid resources. Keep the database marked Always Free in the OCI console.

Operational caveats from Oracle's Always Free docs:

- Autonomous Database Always Free supports a small fixed capacity profile.
- Oracle lists a maximum of 30 simultaneous database sessions for Always Free Autonomous Database.
- Some backup and restore features are unavailable or limited on Always Free databases.

## Current app reality

Trippi is currently SQLite-native:

- the singleton database lives in `server/src/db/database.ts`;
- production code uses synchronous `better-sqlite3`;
- the app has hundreds of direct `db.prepare(...)` call sites across services, MCP tools, middleware, Nest services, migrations, and seeds;
- schema and migrations rely on SQLite DDL and pragmas;
- many write paths rely on `lastInsertRowid` and synchronous transactions.

Oracle's Node driver is asynchronous, and Oracle SQL differs from SQLite. A real live-Oracle backend is therefore not a dependency swap. It is a database-layer rewrite.

## Experiment path

This branch starts with a safe Oracle connectivity layer and smoke script:

```bash
cd server
ORACLE_DB_USER=ADMIN \
ORACLE_DB_PASSWORD='<password>' \
ORACLE_DB_CONNECT_STRING='<adb-service-name-or-wallet-alias>' \
ORACLE_DB_WALLET_LOCATION=/path/to/wallet \
npm run oracle:smoke
```

The smoke script creates a `TRIPPI_ORACLE_SMOKE` table if missing, inserts JSON, and reads it back. It proves the free Oracle DB can be reached before any app data is moved.

## Legacy SQLite Mirror Mode

This mode is deprecated and must not be used for production. Production should
run `TRIPPI_DB_PROVIDER=oracle-async`, where Oracle Autonomous Database is the
source of truth and no local SQLite cache is restored or mirrored.

The old SQLite mirror only runs when both variables are set:

```bash
TRIPPI_DB_PROVIDER=oracle
TRIPPI_ENABLE_SQLITE_MIRROR=true
```

With that explicit recovery/debug opt-in, the local backend runs in
Oracle-backed compatibility mode:

1. On startup, the server restores the latest mirrored Oracle rows into the local SQLite compatibility cache before the app imports the DB singleton.
2. The existing app code runs unchanged against that local cache, so current auth, trips, planner, MCP, PDF, files, and settings paths continue to use the same battle-tested code.
3. A background sync mirrors the full local DB state back into Oracle on an interval and again during graceful shutdown.

This is only for legacy recovery/debug work while the service-by-service native
Oracle SQL rewrite is still in progress. Do not use it as a backup strategy.

For local development, keep the private Oracle wallet/env outside the repo:

```bash
/Users/shizhen/.trippi/oracle-autonomous.env
/Users/shizhen/.trippi/oracle-wallet
```

Then start the full app in legacy Oracle-backed mode:

```bash
TRIPPI_ENABLE_SQLITE_MIRROR=true \
npm run dev:oracle
```

Or start only the already-built backend in legacy Oracle-backed mode:

```bash
npm run build --workspace=server
TRIPPI_ENABLE_SQLITE_MIRROR=true \
npm run start:oracle --workspace=server
```

Useful one-off commands:

```bash
# Push current local SQLite state into Oracle
npm run oracle:mirror --workspace=server

# Restore local SQLite compatibility cache from Oracle
npm run oracle:restore --workspace=server
```

Config knobs:

| Variable | Purpose | Default |
| --- | --- | --- |
| `TRIPPI_DB_PROVIDER=oracle` | Uses async Oracle by default. | off |
| `TRIPPI_ENABLE_SQLITE_MIRROR=true` | Enables deprecated local SQLite mirror mode. | off |
| `ORACLE_ENV_FILE` | Private env file used by `npm run dev:oracle`. | `~/.trippi/oracle-autonomous.env` |
| `ORACLE_MIRROR_INTERVAL_MS` | Background mirror interval after boot. | `30000` (`15000` via `dev:oracle`) |
| `ORACLE_MIRROR_BATCH_SIZE` | Rows per Oracle `executeMany` batch. | `250` |

## SQLite-to-Oracle mirror

The branch also includes a non-destructive mirror command:

```bash
cd server
ORACLE_DB_USER=ADMIN \
ORACLE_DB_PASSWORD='<password>' \
ORACLE_DB_CONNECT_STRING='<adb-service-name-or-wallet-alias>' \
ORACLE_DB_WALLET_LOCATION=/path/to/wallet \
TRIPPI_DB_FILE=/path/to/travel.db \
npm run oracle:mirror
```

It creates:

- `TRIPPI_SQLITE_MIRROR` — one JSON row per SQLite table row;
- `TRIPPI_SQLITE_MIRROR_RUNS` — audit rows for mirror attempts.

This is intentionally a bridge, not the final Oracle runtime schema. It lets us prove connectivity, credentials, wallet setup, table creation, writes, commits, JSON payloads, and real Trippi data volume against an Always Free Oracle database before replacing the app's synchronous SQLite data layer.

## Likely migration strategy

The safest path is incremental:

1. Keep production on SQLite while hosted on Oracle Always Free VM.
2. Add Oracle Autonomous smoke tests and backup/mirror tooling.
3. Introduce a typed async repository layer for new or isolated modules.
4. Move high-value flows to the repository layer one by one.
5. Only switch runtime providers after auth, trips, days, places, assignments, MCP, files, and PDF flows pass against Oracle.

Trying to emulate synchronous `better-sqlite3` on top of async Oracle would be fragile and would hide SQL incompatibilities. A typed async data layer is more work, but it is the stable rewrite.
