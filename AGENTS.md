# Agent Instructions

## Local workspace

The active local workspace for this project is `/Users/shizhen/Documents/Trippi.ai`.
Use this path for all app, git, and database work unless the user explicitly says
otherwise. The live local SQLite database is `server/data/travel.db` in this
workspace; make a timestamped backup before manual data edits.

Agents may push directly to `main` when the user asks for a push. Prefer running
focused checks for the files or feature touched, but do not block a requested
push on the full local parity gate unless the user explicitly asks for it.

After pushing, it is helpful but not mandatory to inspect GitHub Actions with
`gh run list --repo shiverin/Trippi.ai --branch main --limit 10`. If checks were
not run locally or CI was not watched, say that plainly in the handoff.

## Testing/Dev Docker setup

For local FE/BE browser testing, use the saved "Testing/Dev Docker Setup" in
`deploy/testing-dev/` before considering any live backend or production data.
Start it with:

```bash
docker compose -f deploy/testing-dev/docker-compose.yml up --build
```

Use `http://127.0.0.1:5180/login` for the frontend and
`http://127.0.0.1:3005/api/health` for backend health. The setup uses Docker
named volumes plus `TRIPPI_DB_FILE=/workspace/server/data/testing-dev.db`; it
must not read or write the workspace's live `server/data/travel.db`, and agents
must not point localhost at production/live backends for ordinary local testing.
The default throwaway admin is `testing-dev@trippi.local` with password
`TestingDev12345!`; if the app asks for a new password, that change stays inside
the isolated Docker volume.

Reset this local testing environment with:

```bash
docker compose -f deploy/testing-dev/docker-compose.yml down -v
```

## Chrome verification

Any claim that the production app works, loads fast, feels fixed, or that a
user-facing bug is resolved must be verified in the user's actual Chrome
browser before reporting it as true. API probes, curl, server logs, unit tests,
and local-only browser checks are useful supporting evidence, but they are not
enough for user-facing or performance claims.

When reporting those claims, include the Chrome-tested URL or flow and the
observed timing or error state. If Chrome testing was not possible, say so
plainly and do not present the claim as verified.

## Chrome verification

Any claim that the production app works, loads fast, feels fixed, or that a
user-facing bug is resolved must be verified in the user's actual Chrome
browser before reporting it as true. API probes, curl, server logs, unit tests,
and local-only browser checks are useful supporting evidence, but they are not
enough for user-facing or performance claims.

When reporting those claims, include the Chrome-tested URL or flow and the
observed timing or error state. If Chrome testing was not possible, say so
plainly and do not present the claim as verified.

## Async database contract

The backend is being migrated to async database access. New runtime/request code
must use `server/src/db/asyncDatabase.ts` (`asyncDb.prepare(...).get/all/run`,
`asyncDb.transaction(async () => ...)`) instead of importing
`server/src/db/database.ts` or calling sync `db.prepare(...)`.

Important provider rules:

1. Production currently runs `TRIPPI_DB_PROVIDER=oracle-async`. New
   request-time/runtime code must be async-safe and use `asyncDb`.
2. `TRIPPI_DB_PROVIDER=oracle` is the compatibility mode: local SQLite runtime
   cache plus Oracle mirror. It remains supported, but it is not the current
   production runtime mode.
3. `TRIPPI_DB_PROVIDER=oracle-async` is the direct async Oracle mode.
   Under this mode, sync `db` access intentionally throws so blocking calls are
   caught during smoke tests.
4. `TRIPPI_DB_PROVIDER=oracle-native` is blocking and must stay gated behind
   `ORACLE_NATIVE_ALLOW_BLOCKING=true`; do not enable it for request traffic.

When adding features, make the async path first and add/extend guard tests in
`server/tests/unit/db/async-access-guard.test.ts` for newly converted request
entry points. Startup-only SQLite migration/seed code may keep using the sync
database module, but request handlers, middleware, MCP handlers, schedulers, and
websocket paths should not add new sync DB dependencies.
