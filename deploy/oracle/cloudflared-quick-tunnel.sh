#!/usr/bin/env bash
set -euo pipefail

# Installs a Cloudflare quick tunnel on the VM and points it at local Caddy.
# This encrypts the public edge-to-VM hop without requiring inbound TLS from
# Vercel to the VM. For a permanent hostname, replace this with a named
# Cloudflare Tunnel attached to a domain you control.

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run as root: sudo bash deploy/oracle/cloudflared-quick-tunnel.sh" >&2
  exit 1
fi

if ! command -v cloudflared >/dev/null 2>&1; then
  arch="$(dpkg --print-architecture)"
  case "${arch}" in
    amd64) asset="cloudflared-linux-amd64.deb" ;;
    arm64) asset="cloudflared-linux-arm64.deb" ;;
    *)
      echo "Unsupported architecture: ${arch}" >&2
      exit 1
      ;;
  esac

  curl -fsSL -o /tmp/cloudflared.deb \
    "https://github.com/cloudflare/cloudflared/releases/latest/download/${asset}"
  apt-get update -y
  apt-get install -y /tmp/cloudflared.deb
fi

cloudflared_bin="$(command -v cloudflared)"

cat > /etc/systemd/system/trippi-cloudflared.service <<SERVICE
[Unit]
Description=Trippi encrypted Cloudflare quick tunnel
After=network-online.target docker.service
Wants=network-online.target

[Service]
Type=simple
ExecStart=${cloudflared_bin} tunnel --no-autoupdate --url http://127.0.0.1:80 --metrics 127.0.0.1:46723 --logfile /var/log/trippi-cloudflared.log
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
SERVICE

touch /var/log/trippi-cloudflared.log
chmod 0644 /var/log/trippi-cloudflared.log
systemctl daemon-reload
systemctl enable --now trippi-cloudflared.service
systemctl restart trippi-cloudflared.service

url=""
for _ in $(seq 1 60); do
  url="$(grep -Eo 'https://[-a-z0-9]+\.trycloudflare\.com' /var/log/trippi-cloudflared.log | tail -n 1 || true)"
  [[ -n "${url}" ]] && break
  sleep 2
done

if [[ -z "${url}" ]]; then
  echo "Cloudflare tunnel did not publish a URL in time." >&2
  systemctl --no-pager status trippi-cloudflared.service || true
  tail -n 80 /var/log/trippi-cloudflared.log || true
  exit 1
fi

echo "TRIPPI_TUNNEL_URL=${url}"
curl -fsS --max-time 20 "${url}/api/health"
echo
