# Agent Instructions

## Local workspace

The active local workspace for this project is `/Users/shizhen/Documents/Trippi.ai`.
Use this path for all app, git, and database work unless the user explicitly says
otherwise. The live local SQLite database is `server/data/travel.db` in this
workspace; make a timestamped backup before manual data edits.

Before pushing to `main`, Codex agents must run the same gates as GitHub Actions and fix every failure.

Required pre-push checks:

1. Run `npm ci` after dependency or lockfile changes.
2. Build shared once before dependent workspace checks: `npm run build --workspace=shared`.
3. Typecheck: `npm run typecheck --workspace=shared`, `npm run typecheck --workspace=server`, and `npm run typecheck --workspace=client`.
4. Lint: `npm --workspace=shared exec eslint -- "src/**/*.ts"`, `npm run lint:check --workspace=server`, and `npm run lint:check --workspace=client`.
5. Tests: `npm test`.
6. Build deployable workspaces: `npm run build --workspace=server` and `npm run build --workspace=client`.
7. After pushing, run `gh run list --repo shiverin/Trippi.ai --branch main --limit 10` and watch triggered runs with `gh run watch <run-id> --repo shiverin/Trippi.ai --exit-status` until they pass.

Do not report a push as done until local parity checks pass and the triggered GitHub Actions have been checked. If a workflow is intentionally skipped by path filters, say so explicitly.

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

1. `TRIPPI_DB_PROVIDER=oracle` is the current production-safe compatibility
   mode.
2. `TRIPPI_DB_PROVIDER=oracle-async` is the opt-in async Oracle proof mode.
   Under this mode, sync `db` access intentionally throws so blocking calls are
   caught during smoke tests.
3. `TRIPPI_DB_PROVIDER=oracle-native` is blocking and must stay gated behind
   `ORACLE_NATIVE_ALLOW_BLOCKING=true`; do not enable it for request traffic.

When adding features, make the async path first and add/extend guard tests in
`server/tests/unit/db/async-access-guard.test.ts` for newly converted request
entry points. Startup-only SQLite migration/seed code may keep using the sync
database module, but request handlers, middleware, MCP handlers, schedulers, and
websocket paths should not add new sync DB dependencies.
