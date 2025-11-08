# edge

DNS sinkhole and resolver responsible for intercepting ad-serving domains via DoH, maintaining blocklists, and emitting only local, privacy-preserving telemetry.

## Features

- miekg/dns based UDP/TCP resolver with RFC 8484 DNS-over-HTTPS support
- Automatic ingestion of the shared PayHole blocklist file and optional remote filter lists
- Rate limiting, Prometheus metrics, and active session gauge for premium unlocks
- gRPC and WebSocket control plane for receiving unlock pushes from the proxy

## Configuration

Configuration is read from environment variables with the following defaults:

| Variable | Default | Description |
| --- | --- | --- |
| `RESOLVER_DNS_ADDR` | `:53` | UDP/TCP listener for traditional DNS |
| `RESOLVER_DOH_ADDR` | `:8053` | HTTP listener exposing `/dns-query` |
| `RESOLVER_METRICS_ADDR` | `:9102` | Prometheus metrics endpoint |
| `RESOLVER_CONTROL_PLANE_GRPC` | `:9600` | Control-plane gRPC listener |
| `RESOLVER_CONTROL_PLANE_WS` | `:9601` | Control-plane WebSocket listener (path `/control/unlock`) |
| `BLOCKLIST_PATH` | `../proxy/data/blocklist.txt` | Shared blocklist file location |
| `BLOCKLIST_URLS` | _empty_ | Comma-separated remote filter list URLs |
| `UPSTREAM_DNS_ADDR` | `1.1.1.1:53` | Upstream DNS resolver |
| `UPSTREAM_TIMEOUT` | `5s` | Upstream DNS timeout |
| `RATE_LIMIT_RPS` | `20` | Requests per second enforced per client IP |
| `RATE_LIMIT_BURST` | `40` | Burst tokens per client IP |
| `RATE_LIMIT_TTL` | `10m` | How long idle limiter entries are retained |

## Docker Compose

Add the resolver alongside the existing proxy service, ensuring both containers share the blocklist volume so they remain in sync.

```yaml
services:
  resolver:
    build:
      context: ./edge
    command: ["/app/resolver"]
    environment:
      RESOLVER_DNS_ADDR: ":53"
      RESOLVER_DOH_ADDR: ":8053"
      RESOLVER_METRICS_ADDR: ":9102"
      RESOLVER_CONTROL_PLANE_GRPC: ":9600"
      RESOLVER_CONTROL_PLANE_WS: ":9601"
      BLOCKLIST_PATH: "/data/blocklist.txt"
      UPSTREAM_DNS_ADDR: "1.1.1.1:53"
    ports:
      - "53:53/udp"
      - "8053:8053"
      - "9102:9102"
    volumes:
      - payhole-blocklist:/data
    depends_on:
      - proxy

  proxy:
    # existing configuration…
    volumes:
      - payhole-blocklist:/data

volumes:
  payhole-blocklist:
```

The proxy should issue unlock notifications to either the gRPC endpoint (`controlplane.UnlockService/PushUnlock`) or the WebSocket endpoint (`ws://resolver:9601/control/unlock`). Payloads accept `clientIp` and optional `expiresAt` (RFC3339) fields.

## Firewall guidance

Only expose UDP/53 and HTTPS/8053 to trusted networks. Restrict control-plane ports (9600/9601) and Prometheus (9102) to internal management networks. When fronting the resolver with a load balancer or firewall, ensure UDP/53 traffic preserves the client source IP so rate limiting and unlock enforcement remain accurate.

