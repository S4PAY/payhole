# Railway Staging Deployment

Railway can orchestrate each PayHole service as an individual deployment connected via a shared project environment.

## Services

| Service   | Runtime      | Image                                      | Recommended Plan |
|-----------|--------------|--------------------------------------------|------------------|
| dashboard | Node (Docker) | `ghcr.io/your-org/payhole/dashboard:latest` | Starter+         |
| payments  | Node (Docker) | `ghcr.io/your-org/payhole/payments:latest`  | Starter+         |
| proxy     | Docker       | `ghcr.io/your-org/payhole/proxy:latest`     | Performance      |

## Environment Variables

Create project-level variables and reference them from each service:

- `PAYMENTS_API_BASE_URL` (dashboard) → `https://<payments-service>.railway.app`
- `NEXT_PUBLIC_PROXY_HTTP_URL` → `https://<proxy-service>.railway.app`
- `NEXT_PUBLIC_PROXY_DNS_ADDR` → `<proxy-service>.railway.app:5353`
- `NEXT_PUBLIC_PROXY_HEALTH_URL` → `https://<proxy-service>.railway.app/health`
- `ADMIN_JWT_SECRET` (dashboard) – configure via Railway Secrets
- `ANALYTICS_API_BASE_URL` (dashboard) – optional
- `HELIUS_RPC_URL`, `JWT_SECRET`, `UNLOCK_DB_PATH`, `USDC_MINT_ADDRESS` (payments)
- `UPSTREAM_DNS_ADDR`, `BLOCKLIST_PATH`, `PAYMENTS_JWT_SECRET` (proxy)

Railway automatically provisions TLS endpoints. Map the DNS service separately if you require Anycast DNS.

## Deployment Steps

1. Push production images to GHCR via the GitHub Actions pipeline (merge to `main`).
2. In Railway, create three services using the Docker image option and provide the GHCR image URL.
3. Configure secrets/environment variables as described above.
4. For the payments service, attach a persistent volume (1–2 GB) mounted at `/data`.
5. Redeploy services after updating secrets or image tags.

> **Note:** Railway doesn’t expose UDP by default; run the proxy’s DNS listener behind a separate provider (e.g., Fly.io) or abstract it behind a TCP-to-UDP gateway if required.

