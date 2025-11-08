# PayHole Dashboard

Next.js 14 dashboard for managing PayHole authentication, payments, and proxy onboarding.

## Features
- Solana wallet connection using Phantom & Solflare adapters.
- JWT-backed unlock flow via the `/payments` service with local token storage.
- Connection banner highlighting wallet + payment status, proxy onboarding walkthrough when verified.
- Admin analytics console gated by a server-side admin JWT.
- Proxy status card with health checks, setup instructions, QR onboarding, and live blocked-request totals.
- Placeholder analytics cards ready for real-time telemetry integration.

## Getting Started

```bash
npm install
npm run dev
```

Environment variables:

- `PAYMENTS_API_BASE_URL` – base URL for the payments service (defaults to `http://localhost:4000`).
- `ADMIN_JWT_SECRET` – server-side secret for verifying admin JWTs (required for `/api/admin/analytics`).
- `ANALYTICS_API_BASE_URL` – optional upstream analytics service base URL; when omitted, a fallback data set is returned.
- `NEXT_PUBLIC_PROXY_HTTP_URL` – public HTTP proxy endpoint for onboarding (defaults to `http://localhost:8080`).
- `NEXT_PUBLIC_PROXY_DNS_ADDR` – DNS sinkhole address for onboarding (defaults to `127.0.0.1:5353`).
- `NEXT_PUBLIC_PROXY_HEALTH_URL` – optional explicit proxy health endpoint; falls back to `${NEXT_PUBLIC_PROXY_HTTP_URL}/health`.

## Testing

```bash
npm test -- --runInBand
```

Unit tests cover Solana wallet UI states, payment verification logic, connection banner, and proxy health checks.

## Admin Analytics

- `ADMIN_JWT_SECRET` – shared secret for verifying admin JWTs (required).
- `ADMIN_ANALYTICS_BASE_URL` – optional upstream analytics endpoint. When omitted, the dashboard serves mock metrics.
- Browse to `/admin/analytics`, paste a valid admin JWT, and load metrics covering DAU, paid users, blocked requests, and revenue.

## Production Build

```bash
npm run build
npm start
```

Ensure environment variables are configured via `.env.production` without committing secrets. The dashboard depends on the `/payments` service for JWT validation and the `/proxy` service for onboarding metadata.

