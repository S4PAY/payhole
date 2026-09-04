# @payhole/sinkhole

DNS-level blocker for PayHole users plus the sync agent that feeds it. One container runs two things:

- **dnsmasq**, configured entirely from files the agent renders, answering `0.0.0.0` (and `::`) for every blocked domain and all of its subdomains, and forwarding everything else upstream.
- **The agent** (Node, PID 1), which receives the browser extension's blocklist, joins a libp2p gossipsub swarm of other Sinkhole nodes to share drainer and scam domain flags and a directory of verified x402 endpoints, merges the sources, and restarts dnsmasq whenever the merged list changes.

Point a machine's or a network's DNS at the Sinkhole and drainer domains stop resolving. It can run behind a Pi-hole or
replace one: it subscribes to the same public hosts-format blocklists, and its admin page counts and charts every query.

## Blocklist sources

| Source | How it gets in | Blocks |
|---|---|---|
| Local flags | The extension pushes its list to `PUT /api/blocklist`, or the agent pulls the same JSON from `EXTENSION_BLOCKLIST_URL` | Always |
| Manual entries | `MANUAL_BLOCKLIST_FILE` (one hostname per line, hosts-file lines and `#` comments accepted) plus `POST /api/blocklist/manual` and `DELETE /api/blocklist/manual/:domain` | Always |
| Swarm flags | Flag messages from other nodes | Only after `FLAG_THRESHOLD` distinct reporters (default 5) with valid membership proofs have flagged the domain within `FLAG_TTL_DAYS` (default 30) |
| Subscribed lists | `BLOCKLIST_URLS` plus `POST /api/subscriptions` on the admin page; hosts format or one name per line, refetched every `BLOCKLIST_REFRESH_HOURS` (default 24) with `ETag` and `If-Modified-Since` | Always, by exact name |

Hostnames are validated everywhere they enter: lowercase, punycode, no scheme, path, port or IP literal, at least two labels. Anything else is rejected and reported, never silently repaired.

The curated sources (extension, manual, swarm) are rendered to `DATA_DIR/dnsmasq/blocklist.conf` as `address=/<domain>/0.0.0.0` lines, which sink the domain and every subdomain. dnsmasq only reads `address=` rules at startup, so a change to that set is applied with a quick graceful restart; a burst of changes is coalesced into one restart, and clients that query during the few milliseconds of restart retry on their own.

Subscribed lists go to `DATA_DIR/dnsmasq/blocked.hosts` as `0.0.0.0 <name>` lines, loaded with `addn-hosts`. Public lists enumerate exact hostnames, and dnsmasq answers a name it knows locally without forwarding it (A gets 0.0.0.0, AAAA gets NODATA), so this is the right shape for them, and it keeps the config parser out of the picture: a hosts file is re-read on SIGHUP, so a list refresh never restarts the resolver. Rendering the 300 000 names of a large list takes about 150 ms in the agent (measured in `test/dnsmasq.test.ts`); the file is about 9.5 MB, and dnsmasq loads it into its cache table on the reload. On the Rock Pi 4B+ where the swarm test ran, a list of that size is expected to cost dnsmasq tens of megabytes of memory and a second or two per reload; measure it there before subscribing to several very large lists on a 2 GB box.

## Query statistics

With `QUERY_LOG_ENABLED=1` (the default) dnsmasq runs with `log-queries=extra` and writes its log to the agent, which reads each line and keeps fixed-size counters: 24 hours at one-minute resolution and 7 days at one-hour resolution (total, blocked, cached, forwarded), the last 24 hours per client, the top blocked and top permitted names, query types, upstreams, and a ring of the last 1000 queries. A snapshot goes to `DATA_DIR/stats.json` once a minute when something changed, so a restart keeps the history. Memory is bounded by the ring sizes: at most 256 clients and 1500 distinct names per source are ranked per hour; a busier hour still counts in the totals. `GET /api/stats` and `GET /api/queries` serve the admin page's Queries tab: the stacked 24-hour chart, the 7-day chart, the ranked lists, and the query log with client, domain and status filters.

## Privacy

Only explicit flags leave the node: the domains the extension pushed and the manual entries. Swarm announcements carry a domain, a reason, a timestamp and the operator's signatures; nothing about traffic. Query statistics stay on the node: they are counters and a short ring in `DATA_DIR`, readable only with the admin token, and `QUERY_LOG_ENABLED=0` turns the query log off entirely, in which case the resolver never observes what is resolved.

## The swarm

Nodes connect over TCP with Noise encryption and Yamux multiplexing, find each other through `SWARM_BOOTSTRAP` multiaddrs (and optionally mDNS on a LAN), and exchange messages on two gossipsub topics:

- `payhole/flags/v1`: `{type: "flag", domain, reason, ts}`
- `payhole/directory/v1`: `{type: "endpoint", url, network, asset, payTo, ts}`

Every message is JSON `{kind, body, reporter, proof, signature}`:

- `reporter` is the operator wallet.
- `proof` binds the libp2p peer to that wallet: `{peerId, address, issuedAt, signature}` where `signature` is an EIP-191 personal signature by `address` over the exact text
  ```
  PayHole Sinkhole membership
  peer: <peerId>
  address: <address>
  issued: <issuedAt>
  ```
- `signature` is an EIP-191 signature by `reporter` over the body serialised as JSON with keys sorted at every level.

A receiving node accepts a message only if the proof's `peerId` equals the libp2p peer that signed the gossipsub envelope (the original publisher, not the relay), the proof signature verifies, `reporter` equals the proof address, the body signature verifies, the timestamp is within a short window, and `BurnVault.tierOf(reporter)` is at least `MIN_TIER` (read through `RPC_URL`, cached for an hour). Verification runs inside the gossipsub topic validator, so a message that fails is neither handled nor forwarded to other peers, and the reason is counted (`GET /api/status` shows the counters).

Membership therefore costs a BurnVault unlock: one tier-holding wallet is one reporter, however many peers it runs, and `FLAG_THRESHOLD` distinct wallets are needed before a domain is blocked on your node. Flags expire after `FLAG_TTL_DAYS`; nodes re-announce their own explicit flags every `FLAG_REANNOUNCE_MINUTES` so late joiners converge.

### Directory of x402 endpoints

Before an announced endpoint is stored or re-published, the node probes it: a plain `GET` with a 5 second timeout and no payment. The entry is accepted only if the answer is 402 and the payment request parses (`parsePaymentRequired` from the SDK) with an offer that matches the announced `network`, `asset` and `payTo`. On Robinhood Chain the offer must also be one PayHole can pay (`selectOffer`: `exact` scheme, USDG, plain EIP-3009); on other networks a plain match of the three fields is enough. URLs that are not http(s), carry credentials, or resolve to loopback, private, link-local, CGNAT, multicast or metadata ranges are refused before any connection, and the connection is pinned to the address that was vetted so a DNS rebind cannot redirect it. Probes are rate-limited per host.

Verified entries carry `verifiedAt`, are re-probed before being trusted again after an hour, and are re-published at most once an hour; entries that stop verifying are dropped after three failures, and entries not seen for a week expire. Operators add their own endpoints with `POST /api/directory`, which runs the same probe before publishing.

### Node identity

The libp2p key is generated on first start and kept at `DATA_DIR/peer.key` (mode 600), so the PeerId is stable across restarts. The operator identity comes from the environment:

- `NODE_OPERATOR_KEY`: the wallet's private key. The agent signs the membership proof at startup and signs every announcement with it.
- `NODE_OPERATOR_ADDRESS` plus `NODE_PROOF_JSON`: a proof signed offline with any wallet. Announcement bodies must be signed by the reporter wallet too, so a node configured this way verifies and consumes swarm data but does not publish (status shows `publishing: false`). This is the mode for a node that should only consume the swarm while proving nothing.

Two CLI subcommands help:

```sh
docker run --rm -v sinkhole-data:/data -e NODE_OPERATOR_ADDRESS=0xYourWallet payhole-sinkhole peer-id
# prints the PeerId, the exact text to sign, and the NODE_PROOF_JSON skeleton

docker run --rm -v sinkhole-data:/data -e NODE_OPERATOR_KEY=0x... payhole-sinkhole sign-proof
# prints a signed proof for the key in the volume
```

Run them against the same volume the service uses, otherwise the proof is for a different peer.

## Admin page

The admin API serves a dashboard at `/` on the admin port: status cards (resolver, queries and blocked in the last 24
hours, blocked domains by source, peers, pending flags, last syncs), a Queries tab with the charts, ranked lists and
query log, the blocklist with manual entries, search and exports, a Lists tab to subscribe, refresh and remove public
blocklists, swarm flags with reporter counts, the x402 directory with the probe form, and a Node tab with the running
configuration. It loads only from this origin (fonts,
logo, and script are bundled under `/admin/`), keeps the token in the browser's local storage, and refreshes every 30
seconds. Preview it with seeded data and no resolver: `pnpm exec tsx scripts/demo-admin.ts 18053`, token `demo`.

## Ports and the firewall

Docker publishes container ports by inserting its own iptables rules ahead of ufw, so a `0.0.0.0` port mapping is reachable from the internet even when ufw denies incoming traffic. The compose file therefore binds every port to `127.0.0.1`: DNS (53), the admin API (8053), and the swarm (4001). Exposing a port is a deliberate two-step change: edit the mapping in `docker-compose.yml` to the interface you want (`0.0.0.0:53:53/udp` for a resolver clients can reach, `0.0.0.0:4001:4001/tcp` for swarm peers), then allow only the sources that need it in ufw, for example `ufw allow from 203.0.113.0/24 to any port 53` or `ufw allow 4001/tcp`. Never expose 8053; reach the admin API and push blocklists through an SSH tunnel (`ssh -L 8053:127.0.0.1:8053 host`). `scripts/container-test.sh` maps its test ports to localhost only.

## Setup on a host with Docker

1. Build from the repository root: `docker build -f packages/sinkhole/Dockerfile -t payhole-sinkhole .`
2. `cp packages/sinkhole/.env.example packages/sinkhole/.env` and fill in at least `ADMIN_TOKEN` (`openssl rand -hex 32`) and, for the swarm, `SWARM_BOOTSTRAP`, `BURN_VAULT_ADDRESS` (until the SDK deployment record carries it) and `NODE_OPERATOR_KEY`. Set `SWARM_ENABLED=0` for a purely local blocker.
3. `docker compose -f packages/sinkhole/docker-compose.yml up -d`
4. Check `curl http://127.0.0.1:8053/healthz` and open `http://127.0.0.1:8053/` for the admin page (paste the token).
5. Point clients at the host's IP as their DNS server, and configure the extension to push to `http://<host>:8053/api/blocklist` with the token.

**Port 53 must be free.** On Ubuntu, systemd-resolved runs a stub listener on `127.0.0.53:53`, and depending on the setup Docker will refuse to publish `53:53`. The operator decides how to handle that: disable the stub listener in systemd-resolved's configuration and point `/etc/resolv.conf` elsewhere, or publish the Sinkhole's port 53 only on a specific non-loopback address (`- "192.0.2.10:53:53/udp"` in the compose file), which does not collide with the stub listener. This README deliberately gives no commands that edit `/etc`.

The admin port is bound to `127.0.0.1` in the compose file; put a reverse proxy with TLS in front of it if the extension or an operator must reach it remotely. The swarm port (4001/tcp) should be reachable from other nodes if this node is to be a bootstrap peer.

Data lives in the `sinkhole-data` volume: `state.json` (flags, manual entries, directory), `stats.json` (query counters), `lists/` (subscribed lists and their metadata), `peer.key`, and `dnsmasq/` with the rendered configuration. Back up `peer.key` if the PeerId matters (the membership proof is bound to it).

## Environment

| Variable | Default | Meaning |
|---|---|---|
| `DNS_LISTEN` | `0.0.0.0` | Address dnsmasq binds |
| `DNS_PORT` | `53` | Port dnsmasq binds |
| `UPSTREAM_DNS` | `1.1.1.1,9.9.9.9` | Upstream resolvers, comma separated, `ip` or `ip#port` |
| `DNS_CACHE_SIZE` | `10000` | dnsmasq cache entries |
| `DNSMASQ_USER` | (image: `dnsmasq`) | Unprivileged user dnsmasq switches to; omit outside the image |
| `DNSMASQ_BINARY` | `dnsmasq` | Path of the dnsmasq binary |
| `ADMIN_LISTEN` | `0.0.0.0` | Address of the admin API |
| `ADMIN_PORT` | `8053` | Port of the admin API |
| `ADMIN_TOKEN` | required | Bearer token for `/api/*` |
| `DATA_DIR` | `/data` | State, rendered configuration and libp2p key |
| `EXTENSION_BLOCKLIST_URL` | unset | Pull the extension JSON from here |
| `EXTENSION_PULL_MINUTES` | `15` | Pull interval |
| `MANUAL_BLOCKLIST_FILE` | unset | Hostnames to always block, read at startup |
| `BLOCKLIST_URLS` | unset | Public blocklists to subscribe to, comma separated |
| `BLOCKLIST_REFRESH_HOURS` | `24` | How often subscribed lists are refetched |
| `QUERY_LOG_ENABLED` | `1` | `0` disables the query log and the statistics |
| `FLAG_THRESHOLD` | `5` | Distinct reporters needed to block a swarm-flagged domain |
| `FLAG_TTL_DAYS` | `30` | Flag lifetime |
| `FLAG_REANNOUNCE_MINUTES` | `30` | Re-announcement interval for own flags |
| `SWARM_ENABLED` | `1` | `0` disables the swarm |
| `SWARM_LISTEN` | `/ip4/0.0.0.0/tcp/4001` | libp2p listen multiaddrs, comma separated |
| `SWARM_BOOTSTRAP` | unset | Bootstrap multiaddrs with `/p2p/<peerId>`, comma separated |
| `SWARM_MDNS` | `0` | `1` enables mDNS discovery |
| `MIN_TIER` | `1` | Minimum BurnVault tier; `0` skips the on-chain check |
| `RPC_URL` | Robinhood Chain RPC | RPC for the tier lookup |
| `CHAIN_ID` | `4663` | Chain of the BurnVault |
| `BURN_VAULT_ADDRESS` | SDK deployment record | BurnVault address; required when `MIN_TIER > 0` and the record has none |
| `NODE_OPERATOR_KEY` | unset | Operator wallet private key |
| `NODE_OPERATOR_ADDRESS` | unset | Operator address for the offline-proof mode |
| `NODE_PROOF_JSON` | unset | Pre-signed membership proof |
| `PROBE_ALLOW_PRIVATE` | `0` | Development only: allow probing private and loopback endpoints |

## Admin API

All routes except `/healthz` and the page at `/` need `Authorization: Bearer <ADMIN_TOKEN>`. Errors are JSON `{error, message}`.

| Route | Purpose |
|---|---|
| `GET /healthz` | `{ok, dnsmasq, peers}`; 503 when dnsmasq is not running |
| `GET /` | Single-file admin page; reads the endpoints below with a pasted token |
| `GET /api/status` | Peer id, listen addresses, connected peers, counts (local, manual, swarm confirmed, merged), directory size, last extension sync and last swarm message, dropped-message counters, dnsmasq state |
| `GET /api/blocklist?q=&limit=` | Merged list with the sources of every domain; `q` filters, `limit` caps the page (default 1000, max 5000), `count` and `matched` report the totals |
| `GET /api/blocklist/export?format=hosts\|dnsmasq\|plain\|json` | Download the merged list |
| `PUT /api/blocklist` | Extension push `{version: 1, updatedAt, entries: [{domain, reason, flaggedAt}]}`; replaces the local list, answers `{accepted, added, removed, rejected}` |
| `POST /api/blocklist/manual` | `{domain, reason?}`; 201 when new |
| `DELETE /api/blocklist/manual/:domain` | Remove a manual entry (file entries return at the next start) |
| `GET /api/directory` | Verified x402 endpoints |
| `POST /api/directory` | `{url, payTo, network?, asset?}`; probes, stores and announces, or 422 with the probe failure |
| `GET /api/flags` | Swarm flag counts per domain with the threshold |
| `GET /api/stats` | Query statistics: 24-hour and 7-day series, summary, clients, top blocked and permitted, types, upstreams; 404 when logging is off |
| `GET /api/queries?limit=&client=&domain=&status=` | Most recent queries, newest first; `status` is blocked, cached, forwarded, local, unanswered or unknown |
| `GET /api/subscriptions` | Subscribed lists with entries, last fetch, next refresh and last error |
| `POST /api/subscriptions` | `{url}`; subscribes and fetches at once; 201 when new |
| `POST /api/subscriptions/:id/refresh` | Fetch one list now |
| `DELETE /api/subscriptions/:id` | Unsubscribe and drop its names |

Bodies are limited to 4 MB.

## Development

```sh
pnpm install
pnpm --filter @payhole/sdk build
pnpm --filter @payhole/sinkhole test        # vitest, no Docker or dnsmasq needed
pnpm --filter @payhole/sinkhole typecheck
pnpm --filter @payhole/sinkhole lint
pnpm --filter @payhole/sinkhole build
```

The tests cover the merge and threshold rules, hostname validation, the dnsmasq log parser and the statistics rings (correlation of queries with their outcome, windows, the log ring, persistence), list subscriptions against a local server (hosts and plain formats, conditional requests, size cap, timeout, persistence), message signing and verification with a mocked tier reader, the directory probe against a local mock server (valid 402, 200, mismatched payTo, loopback refused before any request, timeout), dnsmasq rendering and the supervisor (with a stand-in binary), the admin API, and a three-node swarm in-process: A publishes a flag, B records one reporter and relays it to C, a second distinct operator confirms it at threshold 2, and messages with a mismatched proof or an unqualified operator are dropped, counted, and not forwarded.

To run the agent outside Docker, dnsmasq must be installed (`DNSMASQ_BINARY` if it is not on `PATH`), the process needs to bind the chosen `DNS_PORT`, and `pnpm dev` starts it from the sources.

### Container test

`scripts/container-test.sh` needs Docker, `dig` and `curl`. It builds the image, starts a container with a temporary data directory holding a manual blocklist with `blocked.example`, waits for `/healthz`, pushes a blocklist with `tracker.example`, then checks that `tracker.example`, `sub.tracker.example` and `blocked.example` resolve to `0.0.0.0` while `example.com` gets a real answer, that the export lists both domains, and that the API refuses requests without the token. Ports default to 5553 (DNS) and 18053 (admin) on localhost; `TEST_DNS_PORT`, `TEST_ADMIN_PORT`, `TEST_UPSTREAM_DNS`, `SKIP_BUILD=1` and `TEST_SWARM_ENABLED=1` adjust it. The swarm is off in the test by default because it needs no peers to prove the resolver path.

## Known limitations

- dnsmasq is restarted, not reloaded, when the blocklist changes. `address=` rules cannot be reloaded with SIGHUP; the restart takes milliseconds and changes are coalesced, but a query arriving in that window is retried by the client.
- A node without `NODE_OPERATOR_KEY` cannot sign announcements: the message format requires the reporter wallet's signature over the body. Delegated signing keys would need an extension of the proof text.
- Membership is only as strong as the tier lookup. With `MIN_TIER=0` anyone can reach the threshold; keep it at 1 or higher on public swarms, and remember that the SDK deployment record has no BurnVault address until the contract is deployed.
- Timestamps are checked against the local clock (15 minutes back, 5 minutes ahead); nodes need reasonably accurate clocks.
- Re-announcing thousands of local flags every `FLAG_REANNOUNCE_MINUTES` costs one message per flag. Large lists on many nodes add up; raise the interval for big deployments.
- Gossipsub is awaited on the directory probe (up to 5 seconds per new entry) before forwarding, which is deliberate so unverified entries never propagate, but it slows directory gossip on busy nodes.
- IPv6 blocking answers `::` for AAAA; a client that ignores the AAAA answer and only has IPv4 is unaffected either way.
- The admin page keeps the token in the browser's local storage until Disconnect; use it from a trusted browser.
- Query statistics are counters, not a database: there is no per-client history beyond 24 hours and no full query archive. Pi-hole's long-term database has no equivalent here by design.
- Subscribed lists are matched by exact name, as in every hosts-format list. Blocking a whole zone with its subdomains is what the curated sources do.

## Run it at home on a Raspberry Pi or another edge box

Sinkhole runs where a Pi-hole runs: one always-on Linux box that the router hands out as the network's DNS server.
The image is built from `node:24-alpine` and Alpine's `dnsmasq`, both published for 64-bit ARM and x86, so a
Raspberry Pi 4 or 5 on the 64-bit OS, a NAS with Docker, or a mini PC all work. Build on the device itself; a Pi 4
takes a few minutes the first time.

1. Install Docker on the box, for example with Docker's convenience script, and give the box a fixed address on the
   router so clients can rely on it.
2. Make sure nothing else holds port 53. Raspberry Pi OS leaves it free; Ubuntu runs `systemd-resolved` on it, see
   "Ports and the firewall" for the two-line fix.
3. Clone the repository, copy `packages/sinkhole/.env.example` to `packages/sinkhole/.env`, set `ADMIN_TOKEN`
   (`openssl rand -hex 32`), and if the extension should sync its blocklist to this box add `ADMIN_BIND=<box LAN address>`.
4. Start it: `docker compose -f packages/sinkhole/docker-compose.home.yml up -d --build`. On a box whose Docker
   daemon is older than its compose plugin (Debian 12 ships Docker 20.10; the build fails with "client version is too
   new"), build the image directly and let compose only run it:
   `DOCKER_BUILDKIT=0 docker build -f packages/sinkhole/Dockerfile -t payhole-sinkhole .` from the repository root,
   then `docker compose -f packages/sinkhole/docker-compose.home.yml up -d --no-build`. Verified on a Rock Pi 4B+
   (64-bit ARM, Debian 12): the build takes about fifteen minutes and the running container uses about 120 MB.
5. Check it answers and blocks: `dig @<box LAN address> example.com` returns an address, and a domain on the list
   returns nothing. `curl -H "Authorization: Bearer $ADMIN_TOKEN" http://<box LAN address>:8053/healthz` shows the
   resolver, list size, and peer count.
6. Point the network at it: set the router's DHCP DNS server to the box's address, or set it per device. Every phone,
   laptop, and TV on the network now gets the list with no software installed on them.
7. In the extension's Blocklist settings, enter `http://<box LAN address>:8053` and the token so your own reports
   reach the box.

Already running Pi-hole on the same box? Set `DNS_HOST_PORT=5335` in `.env`, start Sinkhole, then in Pi-hole's
Settings, DNS, add `<box LAN address>#5335` as the only upstream. Pi-hole keeps its ad lists in front and Sinkhole
adds the drainer list behind it; remove the upstream entry to undo.

Ports on a home network: 53 is open to the LAN on purpose, the admin API stays on the box unless you bind it, and the
swarm on TCP 4001 works outbound-only behind NAT; forward 4001 on the router only if you want to accept inbound peers.
