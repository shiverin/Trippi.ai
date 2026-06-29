# Oracle Cloud Always Free Deployment

This deploys trippi on an Oracle Cloud Infrastructure VM with:

- the existing production Docker image built from this repo,
- SQLite persisted at `/opt/trippi/data`,
- uploads and generated PDFs persisted at `/opt/trippi/uploads`,
- Caddy terminating HTTPS on ports `80` and `443`,
- MCP and WebSockets proxied through the same public hostname.

This path preserves the current backend architecture. No database rewrite is required.

## Oracle setup

Create an OCI VM that fits the Always Free tier. Recommended shape:

- Image: Ubuntu 24.04 or 22.04
- Shape: Ampere A1 flex, 1 OCPU, 6 GB RAM or higher if available
- Boot volume: 50 GB+
- VCN ingress rules:
  - TCP `22` from your IP
  - TCP `80` from `0.0.0.0/0`
  - TCP `443` from `0.0.0.0/0`

Point a DNS `A` record such as `trippi.example.com` to the VM public IPv4.

## Install on the VM

SSH into the VM, then run:

```bash
sudo apt-get update
sudo apt-get install -y git
git clone https://github.com/shiverin/Trippi.ai.git /tmp/trippi
sudo bash /tmp/trippi/deploy/oracle/install.sh
```

For a private repo or fork, pass `REPO_URL`:

```bash
sudo REPO_URL=https://github.com/<owner>/<repo>.git bash /tmp/trippi/deploy/oracle/install.sh
```

The installer creates `/opt/trippi/app`, installs Docker Compose, creates persistent
directories, and writes `/opt/trippi/app/deploy/oracle/.env` with generated secrets.

## Configure

Edit the environment file:

```bash
sudo nano /opt/trippi/app/deploy/oracle/.env
```

Set at minimum:

```bash
TRIPPI_DOMAIN=trippi.example.com
APP_URL=https://trippi.example.com
ALLOWED_ORIGINS=https://trippi.example.com
ADMIN_EMAIL=you@example.com
ADMIN_PASSWORD=<long random first-login password>
```

Keep:

```bash
FORCE_HTTPS=true
TRUST_PROXY=1
COOKIE_SECURE=true
DEMO_MODE=false
```

## Deploy

```bash
cd /opt/trippi/app
sudo bash deploy/oracle/deploy.sh
```

Check logs:

```bash
sudo docker compose --env-file deploy/oracle/.env -f deploy/oracle/docker-compose.yml logs -f app
```

Open `https://trippi.example.com`.

## Backups

Create a local backup archive:

```bash
cd /opt/trippi/app
sudo bash deploy/oracle/backup.sh
```

The archive is written to `/opt/trippi/backups`.

For production, copy backups off the VM with `rclone`, OCI Object Storage, or another
external storage target. The VM disk is persistent, but it is not a backup by itself.

## Updating

```bash
cd /opt/trippi/app
sudo git pull --ff-only
sudo bash deploy/oracle/deploy.sh
```

## MCP notes

Use the public `APP_URL` as the MCP server base. The MCP endpoint is:

```text
https://trippi.example.com/mcp
```

Caddy proxies the streamable HTTP endpoint and WebSockets on the same hostname.
