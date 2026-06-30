# Testing/Dev Docker Setup

Use this setup for local frontend/backend testing without touching production,
Oracle, or `server/data/travel.db`.

## Start

```bash
docker compose -f deploy/testing-dev/docker-compose.yml up --build
```

Open:

- Frontend: http://127.0.0.1:5180/login
- Backend health: http://127.0.0.1:3005/api/health

The first local admin is seeded into the isolated Docker volume:

- Email: `testing-dev@trippi.local`
- Password: `TestingDev12345!`

The app may ask you to set a new password on first login. That change stays
inside the Docker volume.

## Stop Or Reset

Stop while keeping the local testing DB:

```bash
docker compose -f deploy/testing-dev/docker-compose.yml down
```

Reset the local testing DB, uploads, and installed container dependencies:

```bash
docker compose -f deploy/testing-dev/docker-compose.yml down -v
```

## What This Runs

- `client`: Vite dev server on container port `5173`, exposed at
  `127.0.0.1:5180`.
- `server`: Nest/Express backend on container port `3001`, exposed at
  `127.0.0.1:3005`.
- The frontend proxies `/api`, `/uploads`, `/ws`, `/mcp`, `/oauth/*`, and
  `/.well-known/*` to the Docker backend through `TRIPPI_API_TARGET`.
- The backend uses `TRIPPI_DB_PROVIDER=sqlite` and
  `TRIPPI_DB_FILE=/workspace/server/data/testing-dev.db`.
- `/workspace/server/data` and `/workspace/server/uploads` are Docker named
  volumes, so local testing does not read or write `server/data/travel.db`.

This is the safe local parity lane for UI/API work. It uses the same migrations
and application schema as the app, and runtime code that has moved to
`asyncDb` still exercises that async wrapper. It is not a live Oracle instance;
for exact `oracle-async` enforcement, add or run focused async access guard
tests.

Known limitation: this lightweight dev image does not install the optional
KItinerary extractor binary, so booking-confirmation import is disabled here.
Use the production Dockerfile path when testing that specific integration.

## Optional Ports And Credentials

Override defaults by prefixing the compose command:

```bash
TRIPPI_TESTING_DEV_CLIENT_PORT=5181 \
TRIPPI_TESTING_DEV_API_PORT=3006 \
TRIPPI_TESTING_DEV_ADMIN_EMAIL=local@trippi.test \
TRIPPI_TESTING_DEV_ADMIN_PASSWORD='ChangeMe12345!' \
docker compose -f deploy/testing-dev/docker-compose.yml up --build
```
