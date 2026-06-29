# Agent Instructions

## Local workspace

The active local workspace for this project is `/Users/shizhen/Documents/Trippi.ai`.
Use this path for all app, git, and database work unless the user explicitly says
otherwise. The live local SQLite database is `server/data/travel.db` in this
workspace; make a timestamped backup before manual data edits.

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
