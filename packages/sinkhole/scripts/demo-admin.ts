/**
 * Preview the admin page with seeded data and no dnsmasq or swarm: pnpm exec tsx scripts/demo-admin.ts [port]
 * Token is "demo". Useful for styling work and screenshots; never run it on a public interface.
 */
import { mkdtempSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import { Blocklist } from "../src/blocklist.js";
import { QueryStats } from "../src/queryLog.js";
import { createAdminServer } from "../src/server.js";
import { Subscriptions } from "../src/subscriptions.js";
import type { DirectoryEntry } from "../src/swarm/directory.js";

const port = Number(process.argv[2] ?? "18053");
const now = Date.now();
const blocklist = new Blocklist({ threshold: 5, ttlMs: 30 * 86_400_000 });
blocklist.setLocal({
  version: 1,
  updatedAt: new Date(now - 4 * 60_000).toISOString(),
  entries: [
    { domain: "wallet-drainer.example", reason: "approve-all prompt", flaggedAt: new Date(now - 3_600_000).toISOString() },
    { domain: "claim-airdrop.example", reason: "fake claim page", flaggedAt: new Date(now - 7_200_000).toISOString() },
    { domain: "tracker.adnet.example", reason: "tracker", flaggedAt: new Date(now - 86_400_000).toISOString() },
  ],
});
blocklist.addManual("phish-usdg.example", "reported by a reader");
blocklist.addManual("seed-backup.example", "asks for the recovery phrase");
const reporters = ["0x1111111111111111111111111111111111111111", "0x2222222222222222222222222222222222222222", "0x3333333333333333333333333333333333333333", "0x4444444444444444444444444444444444444444", "0x5555555555555555555555555555555555555555", "0x6666666666666666666666666666666666666666"];
for (const reporter of reporters.slice(0, 5)) blocklist.recordFlag("mint-now.example", reporter, "drainer contract", now - 600_000);
for (const reporter of reporters.slice(0, 2)) blocklist.recordFlag("free-usdg.example", reporter, "fake faucet", now - 120_000);
blocklist.recordFlag("support-chat.example", reporters[5] ?? reporters[0]!, "impersonates support", now - 30_000);

const directory: DirectoryEntry[] = [
  {
    url: "https://payhole.org/api/demo/article",
    network: "eip155:4663",
    asset: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168",
    payTo: "0x4b860C51ED7B97d1Cd8e0e67D907Ea3283449931",
    amount: "10000",
    scheme: "exact",
    reporter: "0x4b860C51ED7B97d1Cd8e0e67D907Ea3283449931",
    origin: "local",
    announcedTs: now - 3_600_000,
    verifiedAt: now - 3_600_000,
    lastSeen: now - 60_000,
    publishedAt: null,
    failures: 0,
  },
];

// A week of synthetic traffic: a daily rhythm, a handful of clients, a few names that keep getting blocked.
const stats = new QueryStats({ logSize: 1000 });
const clients = ["192.168.100.51", "192.168.100.102", "192.168.100.201", "192.168.100.202", "192.168.100.14"];
const permitted = ["payhole.org", "api.naven.network", "rpc.mainnet.chain.robinhood.com", "github.com", "fonts.gstatic.com", "youtube.com", "i.ytimg.com", "cdn.jsdelivr.net"];
const blocked = ["tracker.adnet.example", "wallet-drainer.example", "mint-now.example", "metrics.example", "claim-airdrop.example"];
let seed = 7;
const rand = (): number => {
  seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
  return seed / 2_147_483_648;
};
let id = 1;
const weekAgo = now - 7 * 86_400_000;
for (let t = weekAgo; t < now; t += 60_000) {
  const hour = new Date(t).getHours();
  const rate = hour < 7 ? 1 : hour < 18 ? 2.5 : 4;
  const count = Math.floor(rate + rand() * rate);
  for (let i = 0; i < count; i += 1) {
    const client = clients[Math.floor(rand() * clients.length)] ?? "192.168.100.14";
    const isBlocked = rand() < 0.19;
    const domain = isBlocked ? (blocked[Math.floor(rand() * blocked.length)] ?? "metrics.example") : (permitted[Math.floor(rand() * permitted.length)] ?? "payhole.org");
    const type = rand() < 0.7 ? "A" : rand() < 0.5 ? "AAAA" : "HTTPS";
    const prefix = `${id} ${client}/5${id % 9000}`;
    stats.ingest(`dnsmasq[18]: ${prefix} query[${type}] ${domain} from ${client}`, t);
    if (isBlocked) stats.ingest(`dnsmasq[18]: ${prefix} ${domain.includes("example") && rand() < 0.5 ? "/data/dnsmasq/blocked.hosts" : "config"} ${domain} is 0.0.0.0`, t);
    else if (rand() < 0.4) stats.ingest(`dnsmasq[18]: ${prefix} cached ${domain} is 172.66.147.243`, t);
    else {
      stats.ingest(`dnsmasq[18]: ${prefix} forwarded ${domain} to ${rand() < 0.6 ? "1.1.1.1" : "9.9.9.9"}`, t);
      stats.ingest(`dnsmasq[18]: ${prefix} reply ${domain} is ${type === "AAAA" ? "2606:4700::6810:84e5" : "104.20.23.154"}`, t);
    }
    id += 1;
  }
}

const listsDir = mkdtempSync(join(tmpdir(), "sinkhole-demo-lists-"));
const fakeFetch: typeof fetch = (input) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const body = url.includes("small") ? "0.0.0.0 ads.example\n0.0.0.0 metrics.example\n" : Array.from({ length: 120_000 }, (_, i) => `0.0.0.0 host${i}.ads.example`).join("\n") + "\n";
  return Promise.resolve(new Response(body, { status: 200, headers: { "content-type": "text/plain", etag: '"demo-1"' } }));
};
const subscriptions = await Subscriptions.load({ dir: listsDir, refreshMs: 24 * 3_600_000, fetch: fakeFetch }, [
  "https://raw.githubusercontent.com/StevenBlack/hosts/master/hosts",
  "https://lists.example/small.txt",
]);
await subscriptions.refreshDue();
blocklist.setLists(subscriptions.domains());
subscriptions.onChange(() => blocklist.setLists(subscriptions.domains()));

const startedAt = now - 5 * 3_600_000;
const server = createAdminServer({
  token: "demo",
  blocklist,
  health: () => ({ ok: true, dnsmasq: true, peers: 2 }),
  status: () => ({
    peerId: "12D3KooWC4VmNLxWkBQbrLUakCyWHxsjdykNfSf8dsGUyCMWsaV9",
    listenAddrs: ["/ip4/192.168.100.102/tcp/4001/p2p/12D3KooWC4VmNLxWkBQbrLUakCyWHxsjdykNfSf8dsGUyCMWsaV9"],
    connectedPeers: ["12D3KooWQY1aHnGfE5jqTNbG2z7wv6nP9pW2X1Mk4p9GaoCCTGGh", "12D3KooWRk7mEV1w2M1M2XcRRgBw6fM3p2cQ2mL9u4M4o3K3nQ2t"],
    identity: { address: "0x4b860C51ED7B97d1Cd8e0e67D907Ea3283449931", publishing: true },
    counts: { ...blocklist.counts(), queries24h: stats.snapshot().summary.queries24h, blocked24h: stats.snapshot().summary.blocked24h },
    queryLog: { enabled: true },
    lists: subscriptions.size,
    flagThreshold: blocklist.threshold,
    flagTtlDays: 30,
    directory: directory.length,
    lastSync: { extension: blocklist.localMeta(), swarm: now - 30_000 },
    swarm: { received: 41, accepted: 38, dropped: { stale: 2, tier: 1 } },
    dnsmasq: { running: true, pid: 18, restarts: 3, unexpectedExits: 0, lastReloadAt: now - 600_000, lastExit: null },
    uptimeSeconds: (Date.now() - startedAt) / 1000,
    node: { hostname: hostname(), version: "0.1.0", startedAt },
    config: {
      dns: { listen: "0.0.0.0", port: 53, upstream: ["1.1.1.1", "9.9.9.9"], cacheSize: 10_000 },
      admin: { listen: "0.0.0.0", port: 8053 },
      swarm: { enabled: true, listen: ["/ip4/0.0.0.0/tcp/4001"], bootstrap: [], mdns: false },
      membership: { minTier: 1, vault: "0x298712ca3a1367bbd8caabd5269b05985228eedf" },
      extension: { url: null, pullMinutes: 15 },
      flags: { threshold: 5, ttlDays: 30, reannounceMinutes: 30 },
      queryLog: { enabled: true },
      lists: { refreshHours: 24 },
    },
  }),
  stats: { snapshot: () => stats.snapshot(), queries: (filter) => stats.queries(filter) },
  subscriptions: {
    list: () => subscriptions.list(),
    get: (id) => subscriptions.get(id),
    add: (url) => subscriptions.add(url),
    setCategory: () => Promise.resolve(undefined),
    remove: (id) => subscriptions.remove(id),
    refresh: (id) => subscriptions.refresh(id),
  },
  directory: {
    list: () => directory,
    add: (input) => Promise.resolve({ ok: false as const, reason: "not_402", detail: `demo mode does not probe ${input.url}` }),
  },
});
server.listen(port, "127.0.0.1", () => {
  console.log(`demo admin page on http://127.0.0.1:${(server.address() as AddressInfo).port} (token: demo)`);
});
