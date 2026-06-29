#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/trippi/app}"
REPO_URL="${REPO_URL:-https://github.com/shiverin/Trippi.ai.git}"
BRANCH="${BRANCH:-main}"
ENABLE_UFW="${ENABLE_UFW:-0}"
SWAP_SIZE_GB="${SWAP_SIZE_GB:-4}"

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run as root: sudo APP_DIR=${APP_DIR} REPO_URL=${REPO_URL} bash deploy/oracle/install.sh"
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive

ensure_swap() {
  if ! [[ "${SWAP_SIZE_GB}" =~ ^[0-9]+$ ]]; then
    echo "SWAP_SIZE_GB must be a whole number of GB, got: ${SWAP_SIZE_GB}"
    exit 1
  fi

  if [[ "${SWAP_SIZE_GB}" == "0" ]]; then
    echo "Swap creation disabled."
    return
  fi

  if swapon --show=NAME --noheadings | grep -q .; then
    echo "Swap already configured."
    return
  fi

  local swapfile="/swapfile"
  if [[ ! -f "${swapfile}" ]]; then
    if ! fallocate -l "${SWAP_SIZE_GB}G" "${swapfile}"; then
      dd if=/dev/zero of="${swapfile}" bs=1M count="$((SWAP_SIZE_GB * 1024))" status=progress
    fi
    chmod 600 "${swapfile}"
    mkswap "${swapfile}"
  fi

  swapon "${swapfile}"
  if ! grep -qE '^[^#]+\s+none\s+swap\s+' /etc/fstab; then
    echo "${swapfile} none swap sw 0 0" >> /etc/fstab
  fi
  echo "Configured ${SWAP_SIZE_GB}GB swap."
}

ensure_swap

apt-get update
apt-get install -y ca-certificates curl gnupg git openssl sqlite3 ufw

install -m 0755 -d /etc/apt/keyrings
if [[ ! -f /etc/apt/keyrings/docker.asc ]]; then
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
fi

. /etc/os-release
echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu ${VERSION_CODENAME} stable" \
  > /etc/apt/sources.list.d/docker.list

apt-get update
apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

systemctl enable --now docker

mkdir -p \
  /opt/trippi/data \
  /opt/trippi/uploads \
  /opt/trippi/backups \
  /opt/trippi/caddy/data \
  /opt/trippi/caddy/config

if [[ ! -d "${APP_DIR}/.git" ]]; then
  mkdir -p "$(dirname "${APP_DIR}")"
  git clone --branch "${BRANCH}" "${REPO_URL}" "${APP_DIR}"
else
  git -C "${APP_DIR}" fetch origin "${BRANCH}"
  git -C "${APP_DIR}" checkout "${BRANCH}"
  git -C "${APP_DIR}" pull --ff-only origin "${BRANCH}"
fi

if [[ ! -f "${APP_DIR}/deploy/oracle/.env" ]]; then
  cp "${APP_DIR}/deploy/oracle/.env.example" "${APP_DIR}/deploy/oracle/.env"
  generated_key="$(openssl rand -hex 32)"
  generated_password="$(openssl rand -base64 24 | tr -d '\n')"
  sed -i "s/^ENCRYPTION_KEY=.*/ENCRYPTION_KEY=${generated_key}/" "${APP_DIR}/deploy/oracle/.env"
  sed -i "s/^ADMIN_PASSWORD=.*/ADMIN_PASSWORD=${generated_password}/" "${APP_DIR}/deploy/oracle/.env"
  chmod 600 "${APP_DIR}/deploy/oracle/.env"
  echo "Created ${APP_DIR}/deploy/oracle/.env with generated ENCRYPTION_KEY and ADMIN_PASSWORD."
  echo "Edit TRIPPI_DOMAIN, APP_URL, ALLOWED_ORIGINS, ADMIN_EMAIL, and ADMIN_PASSWORD before first deploy."
fi

if [[ "${ENABLE_UFW}" == "1" ]]; then
  ufw allow OpenSSH
  ufw allow 80/tcp
  ufw allow 443/tcp
  ufw --force enable
fi

echo "Install complete."
echo "Next:"
echo "  cd ${APP_DIR}"
echo "  nano deploy/oracle/.env"
echo "  bash deploy/oracle/deploy.sh"
