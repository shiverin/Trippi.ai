# Oracle Cloud Always Free Deployment

This deploys trippi on an Oracle Cloud Infrastructure VM with:

- the existing production Docker image built from this repo,
- SQLite persisted at `/opt/trippi/data`,
- uploads and generated PDFs persisted at `/opt/trippi/uploads`,
- Caddy terminating HTTPS on ports `80` and `443`,
- MCP and WebSockets proxied through the same public hostname.

This path preserves the current backend architecture. No database rewrite is required.
Despite the directory name, the VM installer and Docker Compose stack are generic
Ubuntu VM deployment assets; they can also be reused on Azure, Google Compute
Engine, AWS EC2, or another VPS. See
`docs/free-backend-fallback-runbook.md` for provider-specific zero-spend notes.

## Oracle setup

Create an OCI VM that fits the Always Free tier. Recommended shape:

- Image: Ubuntu 24.04 or 22.04
- Shape: Ampere A1 flex, 1 OCPU, 6 GB RAM
- Fallback shape: `VM.Standard.E2.1.Micro` if A1 capacity is unavailable
- Boot volume: 50 GB
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

The installer creates a 4 GB swap file by default. Keep that enabled for
`VM.Standard.E2.1.Micro`; Docker image builds are tight on 1 GB RAM. To override:

```bash
sudo SWAP_SIZE_GB=6 bash /tmp/trippi/deploy/oracle/install.sh
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

## Encrypted Vercel-to-VM Tunnel

If Vercel cannot reliably proxy to the VM's public HTTPS hostname, run a
Cloudflare quick tunnel on the VM and point Vercel rewrites at the tunnel URL:

```bash
cd /opt/trippi/app
sudo bash deploy/oracle/cloudflared-quick-tunnel.sh
```

The script prints `TRIPPI_TUNNEL_URL=https://...trycloudflare.com`. Use that
URL as the backend origin in `vercel.json`, then deploy Vercel. Traffic is:

```text
browser --HTTPS--> Vercel --HTTPS--> Cloudflare edge --encrypted tunnel--> VM
```

Quick-tunnel hostnames can change if the tunnel service restarts. For a durable
production hostname, create a named Cloudflare Tunnel on a domain you control
and use that hostname in `vercel.json` instead.

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

## OCI capacity troubleshooting

If OCI returns `Out of capacity for shape ... in availability domain AD-1`, the
request is valid but Oracle has no host capacity for that free shape at that
moment. Do not switch to a paid shape unless the account quota and budget policy
are intentionally changed first.

Safe retry order:

1. Retry `VM.Standard.A1.Flex` with Ubuntu 24.04 aarch64, 1 OCPU, 6 GB RAM.
2. Retry A1 with less RAM, down to 1 GB, if needed.
3. Retry `VM.Standard.E2.1.Micro` with regular Ubuntu 24.04.
4. If both fail, wait and retry later, or upgrade the account to Pay As You Go
   only after the account owner explicitly approves the billing change and while
   keeping quota policies capped to Always Free-sized resources.

For this repo, a 1 GB E2 micro can run the stack only with swap enabled. Expect
slow builds; A1 remains the preferred free shape.

For CLI-based retry attempts, use `deploy/oracle/safe-retry-launch.sh`. It
defaults to dry-run and refuses non-free candidate shapes or boot volumes above
50 GB.
