/**
 * Preview the admin page with seeded data and no dnsmasq or swarm: pnpm exec tsx scripts/demo-admin.ts [port]
 * Token is "demo". Useful for styling work and screenshots; never run it on a public interface.
 */
import type { AddressInfo } from "node:net";
import { hostname } from "node:os";
import { Blocklist } from "../src/blocklist.js";
import { createAdminServer } from "../src/server.js";
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
    counts: blocklist.counts(),
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
    },
  }),
  directory: {
    list: () => directory,
    add: (input) => Promise.resolve({ ok: false as const, reason: "not_402", detail: `demo mode does not probe ${input.url}` }),
  },
});
server.listen(port, "127.0.0.1", () => {
  console.log(`demo admin page on http://127.0.0.1:${(server.address() as AddressInfo).port} (token: demo)`);
});
