# PayHole Proxy

Golang service that pairs a DNS sinkhole with an HTTP forward proxy to enforce PayHole’s ad blocking and x402 payment requirements.

## Features
- DNS sinkhole (UDP/TCP) plus DNS-over-HTTPS (`/dns-query`) entrypoints backed by an upstream resolver.
- HTTP forward proxy that enforces ad/tracker blocking and premium paywall rules, returning a rich HTML payment screen with Solana QR and Phantom/Solflare deep links for unpaid users.
- Automatic ingestion of EasyList/EasyPrivacy filter lists in addition to the local `data/blocklist.txt`, with custom premium domain overrides.
- JWT unlock verification (shared with the payments service) and IP-based cache to grant 30‑day access across DNS + HTTP surfaces.
- Block analytics emitted to the `/analytics` endpoint for ad and premium denials.

## Getting Started

```bash
go run ./cmd/proxy
```

Environment variables:

- `PAYMENTS_JWT_SECRET` (required) – secret used to verify unlock JWTs.
- `HTTP_PROXY_ADDR` (default `:8080`) – HTTP proxy listen address.
- `DOH_ADDR` (default matches `HTTP_PROXY_ADDR`) – optional dedicated DNS-over-HTTPS listener.
- `DNS_PROXY_ADDR` (default `:5353`) – DNS (TCP/UDP) listen address.
- `UPSTREAM_DNS_ADDR` (default `1.1.1.1:53`) – upstream recursive resolver for allowed traffic.
- `BLOCKLIST_PATH` (default `data/blocklist.txt`) – blocklist file path.
- `BLOCKLIST_URLS` – comma-separated remote filter lists (defaults to EasyList + EasyPrivacy).
- `PREMIUM_DOMAINS` – comma-separated premium domains requiring payment.
- `ANALYTICS_URL` – optional HTTP endpoint that records block telemetry.
- `UPSTREAM_TIMEOUT_SECONDS` – resolver HTTP timeout (default `3` seconds).

## Testing

```bash
go test ./...
```

Unit and integration tests cover blocklist matching, JWT verification, HTTP/DNS enforcement, DNS-over-HTTPS handling, and premium unlock flows.

## Roadmap
- Persist premium unlock cache across restarts.
- Support CONNECT tunnelling with privacy-preserving TLS interception policies.
- Stream analytics to a durable message bus for aggregation.

