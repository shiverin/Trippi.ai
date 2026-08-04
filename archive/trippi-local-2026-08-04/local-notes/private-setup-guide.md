# Private Setup Guide

This file is intentionally ignored by git. It was moved out of the public README.

## Get started in 30 seconds

```bash
ENCRYPTION_KEY=$(openssl rand -hex 32) docker run -d -p 3000:3000 \
  -e ENCRYPTION_KEY=$ENCRYPTION_KEY \
  -v ./data:/app/data -v ./uploads:/app/uploads shiverin/trippi.ai
```

Open `http://localhost:3000`. On first boot trippi.ai seeds an admin account — if you set `ADMIN_EMAIL`/`ADMIN_PASSWORD` those are used, otherwise the credentials are printed to the container log (`docker logs trek`).

<div align="center">

&nbsp;&nbsp;·&nbsp;&nbsp;<a href="#docker-compose-production">Docker Compose</a>&nbsp;&nbsp;·&nbsp;&nbsp;<a href="deploy/oracle/README.md">Oracle Always Free</a>&nbsp;&nbsp;·&nbsp;&nbsp;<a href="#helm-kubernetes">Helm / Kubernetes</a>&nbsp;&nbsp;·&nbsp;&nbsp;<a href="#install-as-app-pwa">Install as PWA</a>&nbsp;&nbsp;·&nbsp;&nbsp;<a href="#reverse-proxy">Reverse Proxy</a>&nbsp;&nbsp;·&nbsp;&nbsp;

</div>

<br />

## Tech stack

<div align="center">

![Node.js](https://img.shields.io/badge/Node.js_22-339933?style=flat-square&logo=node.js&logoColor=white)
![NestJS](https://img.shields.io/badge/NestJS_11-E0234E?style=flat-square&logo=nestjs&logoColor=white)
![SQLite](https://img.shields.io/badge/SQLite-003B57?style=flat-square&logo=sqlite&logoColor=white)
![React](https://img.shields.io/badge/React_19-61DAFB?style=flat-square&logo=react&logoColor=black)
![Vite](https://img.shields.io/badge/Vite-646CFF?style=flat-square&logo=vite&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=flat-square&logo=typescript&logoColor=white)
![Tailwind](https://img.shields.io/badge/Tailwind-06B6D4?style=flat-square&logo=tailwindcss&logoColor=white)
![Leaflet](https://img.shields.io/badge/Leaflet-199900?style=flat-square&logo=leaflet&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-2496ED?style=flat-square&logo=docker&logoColor=white)

</div>

Real-time sync via WebSocket (`ws`). Backend on NestJS 11. State with Zustand. Auth via JWT + OAuth 2.1 + OIDC + Passkeys (WebAuthn) + TOTP MFA. Weather via Open-Meteo (no key required). Maps with Leaflet and Mapbox GL.

<br />

<h2 id="docker-compose-production">Docker Compose (production)</h2>

<details>
<summary>Full compose example with secure defaults</summary>

```yaml
services:
  app:
    image: shiverin/trippi.ai:latest
    container_name: trek
    read_only: true
    security_opt:
      - no-new-privileges:true
    cap_drop:
      - ALL
    cap_add:
      - CHOWN
      - SETUID
      - SETGID
    tmpfs:
      - /tmp:noexec,nosuid,size=64m
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=production
      - PORT=3000
      - ENCRYPTION_KEY=${ENCRYPTION_KEY:-}   # generate with: openssl rand -hex 32
      - TZ=${TZ:-UTC}
      - LOG_LEVEL=${LOG_LEVEL:-info}
      - ALLOWED_ORIGINS=${ALLOWED_ORIGINS:-}
      - APP_URL=${APP_URL:-}                 # required for OIDC + email links
      # - FORCE_HTTPS=true                   # behind a TLS-terminating proxy
      # - TRUST_PROXY=1
      # - OIDC_ISSUER=https://auth.example.com
      # - OIDC_CLIENT_ID=trippi
      # - OIDC_CLIENT_SECRET=supersecret
      # - OIDC_DISPLAY_NAME=SSO
      # - OIDC_ADMIN_CLAIM=groups
      # - OIDC_ADMIN_VALUE=app-trippi-admins
    volumes:
      - ./data:/app/data
      - ./uploads:/app/uploads
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://localhost:3000/api/health"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 15s
```

Then:

```bash
docker compose up -d
```

**HTTPS notes:** `FORCE_HTTPS=true` is optional — it adds a 301 redirect, HSTS, CSP upgrade-insecure-requests, and forces the `secure` cookie flag. Only use it behind a TLS-terminating reverse proxy. `TRUST_PROXY=1` tells the server how many proxies sit in front so real client IPs and `X-Forwarded-Proto` work.

</details>

<br />

<h2 id="helm-kubernetes">Helm (Kubernetes)</h2>

```bash
helm repo add trek https://github.com/shiverin/Trippi.ai
helm repo update
helm install trippi trippi/trippi
```

See [`charts/README.md`](charts/README.md) for values.

<h2 id="install-as-app-pwa">Install as App (PWA)</h2>

trippi.ai works as a Progressive Web App — no App Store needed.

1. Open trippi.ai in the browser (HTTPS required)
2. **iOS**: Share ▸ *Add to Home Screen*
3. **Android**: Menu ▸ *Install app* (or *Add to Home Screen*)

trippi.ai then launches fullscreen with its own icon, just like a native app.

<br />

## Updating

**Docker Compose:**

```bash
docker compose pull && docker compose up -d
```

**Docker run** — reuse the original volume paths:

```bash
docker pull shiverin/trippi.ai
docker rm -f trek
docker run -d --name trek -p 3000:3000 -v ./data:/app/data -v ./uploads:/app/uploads --restart unless-stopped shiverin/trippi.ai
```

> Not sure which paths you used? `docker inspect trippi --format '{{json .Mounts}}'` before removing the container.

Your data stays in the mounted `data` and `uploads` volumes — updates never touch it.

> [!IMPORTANT]
> Mount **only** the data and uploads directories — `-v ./data:/app/data -v ./uploads:/app/uploads`. **Never mount a volume at `/app`.** Doing so hides the application code shipped in the image and the container fails to start with `Cannot find module 'tsconfig-paths/register'`. If you previously mounted `/app`, switch to the two mounts above; your data in `data/` and `uploads/` is preserved.

<h3>Rotating the Encryption Key</h3>

If you need to rotate `ENCRYPTION_KEY` (e.g. upgrading from a version that derived encryption from `JWT_SECRET`):

```bash
docker exec -it trippi node --import tsx scripts/migrate-encryption.ts
```

The script creates a timestamped DB backup before making changes and prompts for old + new keys (input is not echoed).

<h2 id="reverse-proxy">Reverse Proxy</h2>

For production, put trippi.ai behind a TLS-terminating reverse proxy. trippi.ai uses WebSockets for real-time sync, so the proxy **must** support WebSocket upgrades on `/ws`.

<details>
<summary>Nginx</summary>

```nginx
server {
    listen 80;
    server_name trippi.yourdomain.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name trippi.yourdomain.com;

    ssl_certificate     /etc/ssl/fullchain.pem;
    ssl_certificate_key /etc/ssl/privkey.pem;

    # 500 MB covers backup-restore uploads (capped at 500 MB server-side).
    client_max_body_size 500m;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location /ws {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_read_timeout 86400;
    }
}
```

</details>

<details>
<summary>Caddy</summary>

```caddy
trippi.yourdomain.com {
    reverse_proxy localhost:3000
}
```

Caddy handles TLS and WebSockets automatically.

</details>

<br />

## Environment variables

<details>
<summary><b>Full reference</b></summary>

<br />

| Variable | Description | Default |
|----------|-------------|---------|
| **Core** | | |
| `PORT` | Server port | `3000` |
| `NODE_ENV` | Environment (`production` / `development`) | `production` |
| `ENCRYPTION_KEY` | At-rest encryption key for stored secrets (API keys, MFA, SMTP, OIDC). Recommended: generate with `openssl rand -hex 32`. If unset, falls back to `data/.jwt_secret` (existing installs) or auto-generates a key (fresh installs). | Auto |
| `TZ` | Timezone for logs, reminders and cron jobs (e.g. `Europe/Berlin`) | `UTC` |
| `LOG_LEVEL` | `info` = concise user actions, `debug` = verbose details | `info` |
| `DEFAULT_LANGUAGE` | Default language on the login page for users with no saved preference. Browser/OS language is auto-detected first; this is the fallback. Supported: `de`, `en`, `es`, `fr`, `hu`, `nl`, `br`, `cs`, `pl`, `ru`, `zh`, `zh-TW`, `it`, `ar`, `id`, `tr`, `ja`, `ko`, `uk`, `gr` | `en` |
| `ALLOWED_ORIGINS` | Comma-separated origins for CORS and email links | same-origin |
| `FORCE_HTTPS` | Optional. When `true`: 301-redirects HTTP to HTTPS, sends HSTS, adds CSP `upgrade-insecure-requests`, forces the session cookie `secure` flag. Useful behind a TLS-terminating reverse proxy. Requires `TRUST_PROXY`. | `false` |
| `HSTS_INCLUDE_SUBDOMAINS` | When `true`: adds the `includeSubDomains` directive to the HSTS header, extending HTTPS enforcement to all subdomains. Only effective when HSTS is active (`FORCE_HTTPS=true` or `NODE_ENV=production`). Leave `false` if you run other services on sibling subdomains over plain HTTP. | `false` |
| `COOKIE_SECURE` | Controls the `secure` flag on the `trippi_session` cookie. Auto-derived: on when `NODE_ENV=production` or `FORCE_HTTPS=true`. Escape hatch: set `false` to allow session cookies over plain HTTP. Not recommended in production. | auto |
| `SESSION_DURATION` | How long a login session stays valid when **"Remember me" is unchecked** (the default): sets the `trippi_session` JWT `exp` and issues a browser-session cookie (cleared when the browser closes). Accepts `ms`-style strings: `1h`, `12h`, `7d`, `30d`, `90d`. Invalid values warn at startup and fall back to the default. | `24h` |
| `SESSION_DURATION_REMEMBER` | Session length when **"Remember me" is ticked** at login: a longer-lived JWT plus a persistent `trippi_session` cookie that survives browser restarts. Same format and startup-fallback behaviour as `SESSION_DURATION`. | `30d` |
| `TRUST_PROXY` | Number of trusted reverse proxies. Tells the server to read client IP from `X-Forwarded-For` and protocol from `X-Forwarded-Proto`. Defaults to `1` in production; off in dev unless set. | `1` |
| `ALLOW_INTERNAL_NETWORK` | Allow outbound requests to private/RFC-1918 IPs (e.g. Immich on your LAN). Loopback and link-local addresses remain blocked. | `false` |
| `APP_URL` | Public base URL of this instance (e.g. `https://trippi.example.com`). Required when OIDC is enabled; used as base for email notification links. | — |
| **OIDC / SSO** | | |
| `OIDC_ISSUER` | OpenID Connect provider URL | — |
| `OIDC_CLIENT_ID` | OIDC client ID | — |
| `OIDC_CLIENT_SECRET` | OIDC client secret | — |
| `OIDC_DISPLAY_NAME` | Label shown on the SSO login button | `SSO` |
| `OIDC_ONLY` | Force SSO-only mode: disables password login + registration, regardless of Admin > Settings. The first SSO login becomes admin. | `false` |
| `OIDC_ADMIN_CLAIM` | OIDC claim used to identify admin users | — |
| `OIDC_ADMIN_VALUE` | Value of the OIDC claim that grants admin role | — |
| `OIDC_SCOPE` | Space-separated OIDC scopes. **Fully replaces** the default — always include `openid email profile`. | `openid email profile` |
| `OIDC_DISCOVERY_URL` | Override the auto-constructed OIDC discovery endpoint (e.g. Authentik: `.../application/o/trippi/.well-known/openid-configuration`) | — |
| **Initial setup** | | |
| `ADMIN_EMAIL` | Email for the first admin on initial boot. Must be set together with `ADMIN_PASSWORD`. If either is omitted a random password is printed to the server log. No effect once a user exists. | `admin@trippi.local` |
| `ADMIN_PASSWORD` | Password for the first admin on initial boot. Pairs with `ADMIN_EMAIL`. | random |
| **Other** | | |
| `DEMO_MODE` | Enable demo mode (hourly data resets) | `false` |
| `MCP_RATE_LIMIT` | Max MCP API requests per user per minute | `300` |
| `MCP_MAX_SESSION_PER_USER` | Max concurrent MCP sessions per user | `200` |

</details>

<br />

## Data & Backups

- **Database** — SQLite, stored in `./data/travel.db`
- **Uploads** — stored in `./uploads/`
- **Logs** — `./data/logs/trippi.log` (auto-rotated)
- **Backups** — create and restore via Admin Panel
- **Auto-Backups** — configurable schedule and retention in Admin Panel

<br />

## Data sources

The Atlas map's country and sub-national (province/county) boundaries come from
[**geoBoundaries**](https://www.geoboundaries.org/) (Runfola et al., 2020), licensed
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). See [NOTICE.md](NOTICE.md)
for full third-party attributions.
