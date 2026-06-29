# Oracle Native Migration Handoff

Last updated: 2026-06-29

This document hands off the Trippi database migration and Oracle Cloud integration work. It is meant for future Codex agents or maintainers who need to understand what changed, how to run it, how to verify it, and what still needs hardening.

## Current State

The local backend has been switched from SQLite runtime storage to native Oracle mode.

Current local runtime:

- Frontend: `http://localhost:5173`
- Backend: `http://localhost:3001`
- Backend LaunchAgent: `/Users/shizhen/Library/LaunchAgents/ai.trippi.server.local.plist`
- LaunchAgent command: `cd /Users/shizhen/Documents/Trippi.ai && exec npm run start:oracle-native --workspace=server`
- Native Oracle selector: `TRIPPI_DB_PROVIDER=oracle-native`
- Oracle private env file: `~/.trippi/oracle-autonomous.env`
- Oracle wallet directory: `~/.trippi/oracle-wallet`

The backend process should log both:

```text
[start:oracle] Starting backend with TRIPPI_DB_PROVIDER=oracle-native
[DB] Native Oracle provider enabled
```

In this mode, application data should be served directly by Oracle Cloud. The running process should not have `server/data/travel.db` open.

## Provider Modes

There are now three relevant database modes:

| Mode | Selector | Purpose |
| --- | --- | --- |
| SQLite | unset `TRIPPI_DB_PROVIDER` | Original local file DB, using `server/data/travel.db`. |
| Oracle mirror compatibility | `TRIPPI_DB_PROVIDER=oracle` | Restores/mirrors SQLite-shaped data through Oracle as a bridge mode. |
| Native Oracle | `TRIPPI_DB_PROVIDER=oracle-native` | App backend uses the native Oracle adapter directly. This is the desired direction. |

Use native Oracle for the current local backend unless intentionally debugging the old SQLite path.

## Key Files

Native Oracle runtime:

- `server/src/db/database.ts` selects `OracleNativeAdapter` when `TRIPPI_DB_PROVIDER=oracle-native`.
- `server/src/db/oracleNativeAdapter.ts` provides the synchronous app-facing DB API and translates SQLite-style SQL into Oracle-compatible calls where possible.
- `server/src/db/oracleNativeWorker.ts` owns the actual async Oracle driver work in a worker thread.
- `server/src/db/oracleNativeSchema.ts` defines/creates the Oracle-native schema.
- `server/scripts/start-oracle.mjs` loads `server/.env`, then the private Oracle env file, then starts the built backend.
- `server/scripts/dev-oracle.mjs` does the same for development mode.
- `server/scripts/oracle-native-schema.ts` plans/applies native Oracle schema creation.
- `server/scripts/oracle-native-import.ts` imports local SQLite data into native Oracle.

Bridge/migration support:

- `server/src/db/oracleSqliteMirror.ts`
- `server/src/db/oracleMirrorRuntime.ts`
- `server/scripts/oracle-mirror-sqlite.ts`
- `server/scripts/oracle-restore-sqlite.ts`
- `docs/oracle-autonomous-db-rewrite.md`
- `docs/oracle-capacity-troubleshooting.md`

Oracle deployment support:

- `deploy/oracle/README.md`
- `deploy/oracle/install.sh`
- `deploy/oracle/safe-retry-launch.sh`
- `deploy/oracle/docker-compose.yml`
- `deploy/oracle/.env.example`

## How Native Oracle Boots

1. `npm run start:oracle-native --workspace=server` sets `TRIPPI_DB_PROVIDER=oracle-native`.
2. `server/scripts/start-oracle.mjs` loads `server/.env`.
3. It then loads `ORACLE_ENV_FILE`, defaulting to `~/.trippi/oracle-autonomous.env`, with override enabled.
4. The script imports `server/dist/index.js`.
5. `server/src/db/database.ts` sees `TRIPPI_DB_PROVIDER=oracle-native` and creates `OracleNativeAdapter`.
6. `OracleNativeAdapter` starts `oracleNativeWorker`.
7. The worker connects to Oracle using `oracledb` and the Autonomous DB wallet/config.
8. App services continue using the existing `db.prepare(...).get/all/run`, `db.exec`, and `db.transaction` style API.

## Local Switch-Over Commands

Build the server:

```bash
cd /Users/shizhen/Documents/Trippi.ai
npm run build --workspace=server
```

Start native Oracle manually:

```bash
ORACLE_ENV_FILE="$HOME/.trippi/oracle-autonomous.env" \
npm run start:oracle-native --workspace=server
```

Restart the always-on local backend:

```bash
launchctl kickstart -k gui/$(id -u)/ai.trippi.server.local
```

Confirm the LaunchAgent command:

```bash
plutil -p ~/Library/LaunchAgents/ai.trippi.server.local.plist
```

The `ProgramArguments` entry should include:

```text
npm run start:oracle-native --workspace=server
```

## Verification Checklist

Run these after any Oracle migration or adapter change.

Backend health:

```bash
curl -fsS http://localhost:3001/api/health
```

Expected:

```json
{"status":"ok"}
```

Frontend health:

```bash
curl -I http://localhost:5173/login
```

Expected: `HTTP/1.1 200 OK`.

Confirm native Oracle logs:

```bash
rg -n "TRIPPI_DB_PROVIDER|Native Oracle provider|Unhandled|ORA-" /tmp/trippi-server.log
```

The current boot should show:

```text
TRIPPI_DB_PROVIDER=oracle-native
[DB] Native Oracle provider enabled
```

Old `ORA-` errors may exist earlier in `/tmp/trippi-server.log` from debugging. Check the current boot tail before treating those as live issues:

```bash
tail -n 160 /tmp/trippi-server.log
```

Confirm no local app DB is open:

```bash
BACKEND_PID="$(lsof -tiTCP:3001 -sTCP:LISTEN)"
lsof -p "$BACKEND_PID" | rg 'travel\.db|better_sqlite3'
```

Expected: no output.

Note: seeing Homebrew's `libsqlite3` dylib alone is not proof that app data is using SQLite. The important check is that `travel.db` and `better_sqlite3` are not open.

Server checks:

```bash
npm run typecheck --workspace=server -- --pretty false
npm run build --workspace=server
```

MCP route-level check:

```bash
curl -i http://localhost:3001/mcp
```

Expected: `401 Unauthorized` with `WWW-Authenticate` metadata, because no MCP/OAuth token was provided.

## Smoke Test Coverage Already Performed

Native Oracle API smoke testing passed the core app flow:

- public health/config/app-config/OAuth metadata/features
- temporary account registration
- `me`
- trip create/list/get/update
- day list/update
- place create/list/search/get/update
- assignment create/list/time/participants/move
- reservation create/list/update/positions
- accommodations
- budget create/list/summary/settlement/update/member paid/members/payers/reorder items/reorder categories
- todo create/list/update/reorder/category-assignees
- trip bundle
- ICS export
- share link create/read/delete
- cleanup of todo/budget/reservation/assignment/place/trip/account

Browser QA also passed:

- registered a temporary user
- reached dashboard
- created a trip
- opened the planner/map page
- verified the planner UI rendered
- cleaned up the temporary trip and account

The browser QA screenshot from the successful pass was saved at:

```text
/tmp/trippi-oracle-planner-24.png
```

## Important SQL Compatibility Fixes

The native Oracle pass fixed several SQLite-specific assumptions that broke or were likely to break under Oracle:

- Replaced `DELETE ... RETURNING user_id` in passkey challenge claiming with select-then-delete.
- Replaced invite `UPDATE ... RETURNING used_count` with update plus `changes` checks.
- Replaced SQLite date math in Vacay logic with TypeScript date helpers.
- Replaced `WITH RECURSIVE` OAuth token revocation with a TypeScript breadth-first traversal.
- Removed SQLite `date(...)`, `datetime(...)`, and `julianday(...)` usage from scheduler paths.
- Removed `SELECT DISTINCT ... CLOB columns` patterns that caused Oracle CLOB datatype errors.
- Reworked update queries that used `COALESCE(?, numeric_or_text_column)` where Oracle inferred incompatible bind types.
- Reworked budget/todo/reservation update paths to load existing rows and bind concrete fallback values.
- Replaced SQLite `ON CONFLICT`/`UPDATE OR IGNORE` assumptions in touched paths.
- Fixed Oracle `GROUP BY` strictness in budget per-person summaries.
- Added controller validation for reservation/budget reorder payloads to avoid Oracle constraint crashes.
- Moved share-token expiry comparison into TypeScript to avoid Oracle timestamp parsing errors.
- Added SQL translation for numeric `CASE WHEN :bind THEN` flags.

## Data Migration Flow

Use the schema and import scripts when migrating local SQLite data into native Oracle.

Dry-run schema plan:

```bash
cd /Users/shizhen/Documents/Trippi.ai
npm run oracle:native:schema --workspace=server -- --dry-run
```

Dry-run import plan:

```bash
npm run oracle:native:import --workspace=server -- --dry-run
```

Apply native schema/import to a disposable Oracle schema:

```bash
TRIPPI_DB_PROVIDER=oracle-native \
npm run oracle:native:import --workspace=server -- --drop-existing --batch-size 100
```

Warning: `--drop-existing` is destructive for the target Oracle schema. Only use it when the target schema is intentionally disposable or backed up.

## Rollback Options

To return local backend to SQLite, change the LaunchAgent command back to the normal server start command and restart it.

Current Oracle-native command:

```text
cd /Users/shizhen/Documents/Trippi.ai && exec npm run start:oracle-native --workspace=server
```

SQLite command:

```text
cd /Users/shizhen/Documents/Trippi.ai && exec npm run start --workspace=server
```

Then restart:

```bash
launchctl kickstart -k gui/$(id -u)/ai.trippi.server.local
```

For bridge-mode recovery from Oracle mirror storage, use:

```bash
npm run oracle:restore --workspace=server
```

## Remaining Risks

These are not blockers for the core native Oracle smoke path, but they should be addressed before calling the migration production-complete.

- Backup/restore service is still SQLite-file-centric and uses SQLite concepts such as `PRAGMA`, `sqlite_master`, and `travel.db`.
- Full external ChatGPT MCP OAuth session was not exercised end-to-end during the final switch-over. The route and auth challenge were verified only at route level.
- Real WebAuthn/passkey browser ceremonies were not fully exercised. The obvious Oracle-incompatible SQL was fixed.
- Third-party OAuth provider login/consent was not fully exercised in browser.
- Existing test harnesses mostly mock SQLite or start a SQLite test backend. Native Oracle needs dedicated integration/e2e scripts instead of relying on the current default Playwright setup.
- Oracle Always Free Autonomous Database has session/capacity limits. Watch for session exhaustion if many local agents, dev servers, or tests run in parallel.

## Recommended Next Hardening

1. Add a committed native Oracle smoke script that runs the same 58-step API flow against a configured backend.
2. Add a small CI/manual workflow for `TRIPPI_DB_PROVIDER=oracle-native` with secrets disabled by default and documented local invocation.
3. Rewrite backup/restore to export/import Oracle-native data rather than SQLite files.
4. Add Oracle-native Playwright support that does not launch the SQLite test backend.
5. Run a real MCP OAuth flow from ChatGPT or MCP Inspector against the Oracle-native backend.
6. Run full passkey registration/login/delete against native Oracle.
7. Monitor Oracle sessions during MCP usage and browser testing.

## Quick Answer For Future Agents

If asked whether local Trippi is currently relying on Oracle for database services:

1. Check the LaunchAgent command.
2. Check `/tmp/trippi-server.log` for `TRIPPI_DB_PROVIDER=oracle-native`.
3. Check `curl -fsS http://localhost:3001/api/health`.
4. Check that the backend process does not have `travel.db` open.

If all four are true, the local backend is running in native Oracle mode and is not using local SQLite as the app data store.
