# Infrastructure Overview

This directory hosts containerisation, orchestration, CI/CD, and deployment assets for PayHole.

## Containers

Each service ships with a production-ready Dockerfile:

| Service   | Path                   | Entrypoint                     | Exposed Ports |
|-----------|------------------------|--------------------------------|---------------|
| Dashboard | `dashboard/Dockerfile` | `npm run start` (`next start`) | `3000/tcp`    |
| Payments  | `payments/Dockerfile`  | `node dist/server.js`          | `4000/tcp`    |
| Proxy     | `proxy/Dockerfile`     | `./payhole-proxy`              | `8080/tcp`, `5353/tcp`, `5353/udp` |

The root `docker-compose.yml` wires the three services together for local development with a shared network and environment variables loaded from `.env`. Copy the template in the docs below into a new `.env` file before running compose.

```bash
docker compose up --build
```

## Environment Template

Create a `.env` at the repository root using the following template:

```
PAYMENTS_API_BASE_URL=http://payments:4000
NEXT_PUBLIC_PROXY_HTTP_URL=http://proxy:8080
NEXT_PUBLIC_PROXY_DNS_ADDR=proxy:5353
NEXT_PUBLIC_PROXY_HEALTH_URL=http://proxy:8080/health
ADMIN_JWT_SECRET=change-me-admin-secret-at-least-32-chars
ANALYTICS_API_BASE_URL=
PROXY_UNLOCK_WEBHOOK=http://proxy:8080/webhooks/unlock

HELIUS_RPC_URL=https://api.helius.dev
JWT_SECRET=change-me-jwt-secret-at-least-32-chars
UNLOCK_DB_PATH=data/unlocks.json
USDC_MINT_ADDRESS=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZeh9Bx
ANALYTICS_BUFFER_LIMIT=10000

UPSTREAM_DNS_ADDR=1.1.1.1:53
BLOCKLIST_PATH=data/blocklist.txt
BLOCKLIST_URLS=https://easylist-downloads.adblockplus.org/easylist.txt,https://easylist-downloads.adblockplus.org/easyprivacy.txt
PREMIUM_DOMAINS=premium.payhole.news,exclusive.payhole.media
ANALYTICS_URL=http://payments:4000/analytics/events
```

Secrets must never be committed; prefer GitHub/Cloud secret stores in production. A production-oriented template lives at `.env.production` with placeholders for Helius, Solana, JWT, and webhook credentials that should be set via your secret store before deploying.

## Production Stack

`infra/production/compose.yml` defines a hardened stack for the VPS rollout:

- **Caddy** terminates HTTPS for `${DASHBOARD_DOMAIN}`, `${PAYMENTS_DOMAIN}`, and `${PROXY_DOMAIN}`, forwarding `/healthz` probes to each upstream.
- **Dashboard**, **Payments**, and **Proxy** containers pull from GHCR images and expose runtime health checks.
- **Persistent unlocks storage** mounts a named Docker volume (`payhole-payments-unlocks`) at `/app/data` so `payments/data/unlocks.json` survives restarts.
- **Loki + Promtail** ship container logs into Loki for auditability.

Set the image prefix, release tag, and TLS domains via environment variables (or an `.env` file) before starting the stack:

```bash
IMAGE_PREFIX=ghcr.io/your-org/payhole \
IMAGE_TAG=$(git rev-parse --short HEAD) \
DASHBOARD_DOMAIN=payhole.example.com \
PAYMENTS_DOMAIN=api.payhole.example.com \
PROXY_DOMAIN=proxy.payhole.example.com \
CADDY_ADMIN_EMAIL=ops@example.com \
docker compose -f infra/production/compose.yml up -d
```

## CI/CD

`.github/workflows/ci.yml` implements the following pipeline:

- **Pull Requests** – run unit tests and builds for `dashboard`, `payments`, and `proxy`.
- **Push to `main`** – build production Docker images and publish them to GHCR under `ghcr.io/<repo>/{dashboard,payments,proxy}` tagged with `latest` and the commit SHA.

The workflow assumes default permissions for `GITHUB_TOKEN` with write access to GHCR.

## Staging Deployment Recipes

Reference configs are provided under `infra/staging`:

- `digitalocean/docker-compose.yml` – Docker Compose stack for DigitalOcean Droplets / App Platform.
- `fly/dashboard.fly.toml`, `fly/payments.fly.toml`, `fly/proxy.fly.toml` – example Fly.io apps (one per service) using GHCR images.
- `railway/README.md` – service definitions and environment expectations for Railway.

These files should be adapted with project-specific image names, secrets, and scaling parameters before deployment.
# infra

Infrastructure definitions for Docker builds, CI/CD workflows, monitoring, and Anycast deployment. TODO: scaffold reusable GitHub Actions, IaC manifests, and security baselines consistent with PayHole privacy policies.

