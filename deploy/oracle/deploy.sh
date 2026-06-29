#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd -- "${SCRIPT_DIR}/../.." && pwd)"
ENV_FILE="${SCRIPT_DIR}/.env"
COMPOSE_FILE="${SCRIPT_DIR}/docker-compose.yml"

if [[ ! -f "${ENV_FILE}" ]]; then
  echo "Missing ${ENV_FILE}. Copy deploy/oracle/.env.example to deploy/oracle/.env and edit it first."
  exit 1
fi

if grep -q "replace-with-" "${ENV_FILE}"; then
  echo "deploy/oracle/.env still contains placeholder values. Edit it before deploying."
  exit 1
fi

set -a
# shellcheck disable=SC1090
. "${ENV_FILE}"
set +a

if [[ -z "${TRIPPI_DOMAIN:-}" || -z "${APP_URL:-}" || -z "${ALLOWED_ORIGINS:-}" ]]; then
  echo "TRIPPI_DOMAIN, APP_URL, and ALLOWED_ORIGINS must be set in deploy/oracle/.env."
  exit 1
fi

mkdir -p \
  "${TRIPPI_DATA_DIR:-/opt/trippi/data}" \
  "${TRIPPI_UPLOADS_DIR:-/opt/trippi/uploads}" \
  "${TRIPPI_CADDY_DATA_DIR:-/opt/trippi/caddy/data}" \
  "${TRIPPI_CADDY_CONFIG_DIR:-/opt/trippi/caddy/config}"

cd "${APP_DIR}"

docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" build app
docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" up -d

echo "Waiting for app health..."
for _ in $(seq 1 60); do
  if docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" ps --status running | grep -q "trippi-ai"; then
    if docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" exec -T app wget -qO- http://localhost:3000/api/health >/dev/null 2>&1; then
      echo "Healthy: ${APP_URL}"
      exit 0
    fi
  fi
  sleep 2
done

echo "App did not become healthy in time. Recent logs:"
docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" logs --tail=120 app
exit 1
