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
