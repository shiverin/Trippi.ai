# FAQ

## Do I need a Google Maps API key?

No. Hosted trippi.ai supports place search without each user managing a map key. If a workspace admin enables Google Places, users can also see richer place data such as photos, ratings, and opening hours.

## Can I use trippi.ai offline?

Yes. trippi.ai is a Progressive Web App. After your first visit, the service worker (powered by Workbox) caches map tiles (Carto and OpenStreetMap), non-sensitive API responses, uploaded covers and avatars, and all static assets. Subsequent visits work without a network connection for already-cached content. See [Offline Mode and PWA](Offline-Mode-and-PWA) for installation instructions.

> **Note:** Auth, admin, backup, and settings endpoints are intentionally excluded from the offline cache.

## How many MCP tokens can I create?

Each user can create up to **10 static API tokens**. Static tokens are deprecated — migrate to OAuth 2.1 when possible.

For OAuth 2.1, each user can register up to **10 OAuth clients**. The default limit for concurrent MCP sessions is **200 per user** (configurable via `MCP_MAX_SESSION_PER_USER`). See [MCP Setup](MCP-Setup).

> **Admin:** MCP must be enabled in Admin Panel > Addons before any user can access it.

## Where is my data stored?

In the hosted service, trip data, uploads, logs, and backups are stored in managed cloud infrastructure operated for trippi.ai. Internal operator deployments have their own storage configuration; those details are covered in the operator docs for [Backups](Backups), [Environment Variables](Environment-Variables), and [Install: Docker Compose](Install-Docker-Compose).

## How do I update trippi.ai?

Hosted trippi.ai updates are handled by the service operators. Internal operators maintaining non-public deployments can use [Updating](Updating) for the deployment runbook.

## Can I restrict who can register?

Yes. An admin can disable open registration so that new accounts can only be created via invite links. See [Admin: Users and Invites](Admin-Users-and-Invites).

## Does trippi.ai support single sign-on?

Yes, via OpenID Connect (OIDC). Compatible providers include Google, Authentik, Keycloak, and any standard OIDC-compliant IdP. Set `OIDC_ONLY=true` to disable password login entirely. See [OIDC SSO](OIDC-SSO).
