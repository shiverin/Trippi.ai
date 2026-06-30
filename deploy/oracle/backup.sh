#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${SCRIPT_DIR}/.env"

if [[ ! -f "${ENV_FILE}" ]]; then
  echo "Missing ${ENV_FILE}."
  exit 1
fi

set -a
# shellcheck disable=SC1090
. "${ENV_FILE}"
set +a

DATA_DIR="${TRIPPI_DATA_DIR:-/opt/trippi/data}"
UPLOADS_DIR="${TRIPPI_UPLOADS_DIR:-/opt/trippi/uploads}"
BACKUP_DIR="${TRIPPI_BACKUP_DIR:-/opt/trippi/backups}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUT_DIR="${BACKUP_DIR}/${STAMP}"
DB_PROVIDER="${TRIPPI_DB_PROVIDER:-oracle-async}"

if [[ "${DB_PROVIDER}" == "oracle-async" || "${DB_PROVIDER}" == "oracle" || "${DB_PROVIDER}" == "oracle-backed" || "${DB_PROVIDER}" == "oracle-mirror" ]]; then
  cat >&2 <<'EOF'
SQLite VM backups are disabled for Oracle cloud database deployments.
Oracle Autonomous Database is the source of truth; use Oracle export/backup tooling instead.
EOF
  exit 2
fi

mkdir -p "${OUT_DIR}"

if [[ -f "${DATA_DIR}/travel.db" ]]; then
  sqlite3 "${DATA_DIR}/travel.db" ".backup '${OUT_DIR}/travel.db'"
else
  echo "No SQLite database found at ${DATA_DIR}/travel.db"
fi

if [[ -d "${UPLOADS_DIR}" ]]; then
  tar -C "${UPLOADS_DIR}" -czf "${OUT_DIR}/uploads.tar.gz" .
fi

tar -C "${OUT_DIR}" -czf "${BACKUP_DIR}/trippi-${STAMP}.tar.gz" .
rm -rf "${OUT_DIR}"

echo "${BACKUP_DIR}/trippi-${STAMP}.tar.gz"
