# Agent Instructions

Before pushing to `main`, Codex agents must run the same gates as GitHub Actions and fix every failure.

Required pre-push checks:

1. Run `npm ci` after dependency or lockfile changes.
2. Shared workspace: `npm run build --workspace=shared`, `npm run typecheck --workspace=shared`, `npm --workspace=shared exec eslint -- "src/**/*.ts"`, `npm run format:check --workspace=shared`, `npm run i18n:parity:strict --workspace=shared`, and `npm test --workspace=shared`.
3. Server workspace: `npm run build --workspace=shared`, `npm run build --workspace=server`, `npm run typecheck --workspace=server`, `npm run lint:check --workspace=server`, and `npm run test:coverage --workspace=server`.
4. Client workspace: `npm run build --workspace=shared`, `npm run typecheck --workspace=client`, `npm run lint:check --workspace=client`, `npm run lint:pages --workspace=client`, `npm run test:coverage --workspace=client`, and `npm run build --workspace=client`.
5. Formatting: `npm run format:check`.
6. Workflow sanity: `ruby -e 'require "yaml"; Dir[".github/workflows/*.yml"].each { |f| YAML.load_file(f); puts "ok #{f}" }'`.
7. For Docker workflow changes, confirm Helm chart path references match the real chart directory.
8. After pushing, run `gh run list --repo shiverin/Trippi.ai --branch main --limit 10` and watch triggered runs with `gh run watch <run-id> --repo shiverin/Trippi.ai --exit-status` until they pass.

Do not report a push as done until local parity checks pass and the triggered GitHub Actions have been checked. If a workflow is intentionally skipped by path filters, say so explicitly.
