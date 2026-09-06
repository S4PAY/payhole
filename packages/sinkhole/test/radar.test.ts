import { createServer, type Server } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Blocklist, type BlocklistState } from "../src/blocklist.js";
import { brandsOf, buildRadar, impersonatedBrands, labelFor, memoize } from "../src/radar.js";
import { Subscriptions, subscriptionId } from "../src/subscriptions.js";

const HOUR = 3_600_000;
const NL = String.fromCharCode(10);
const A = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const B = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

describe("brands", () => {
  it("names the brand a hostname trades on and skips the brand's own registrable name", () => {
    expect(brandsOf("metamask-verify.pages.dev")).toEqual(["MetaMask"]);
    expect(brandsOf("accounts.google.com.login-secure.tk")).toEqual(["Google"]);
    expect(brandsOf("metamask.io")).toEqual([]);
    expect(brandsOf("sites.google.com")).toEqual([]);
    expect(brandsOf("okx-airdrop.claims")).toEqual(["OKX"]);
    expect(brandsOf("okxcoin.example")).toEqual([]);
    expect(brandsOf("usdc2claim.xyz")).toEqual(["Circle"]);
    expect(brandsOf("nothing-here.example")).toEqual([]);
    expect(brandsOf("localhost")).toEqual([]);
  });

  it("counts brands across names, most impersonated first, with examples", () => {
    const brands = impersonatedBrands(["metamask-verify.xyz", "wallet-metamask.top", "ledger-live-update.com", "plain.example"]);
    expect(brands).toEqual([
      { brand: "MetaMask", count: 2, sample: ["metamask-verify.xyz", "wallet-metamask.top"] },
      { brand: "Ledger", count: 1, sample: ["ledger-live-update.com"] },
    ]);
  });

  it("labels list URLs by their GitHub repository or host", () => {
    expect(labelFor("https://raw.githubusercontent.com/scamsniffer/scam-database/refs/heads/main/blacklist/domains.json")).toBe("scamsniffer/scam-database");
    expect(labelFor("https://lists.example/hosts.txt")).toBe("lists.example");
    expect(labelFor("not a url")).toBe("not a url");
  });
});

describe("swarm confirmations", () => {
  it("remembers what the swarm confirmed, survives a restart, and answers by window", () => {
    let now = 1_700_000_000_000;
    const blocklist = new Blocklist({ threshold: 2, ttlMs: 30 * 24 * HOUR, clock: () => now });
    blocklist.recordFlag("kit.example", A, "drainer kit", now, now, "drainer");
    expect(blocklist.recentConfirmations(0)).toEqual([]);
    now += HOUR;
    blocklist.recordFlag("kit.example", B, "seen it too", now, now, "infra");
    expect(blocklist.recentConfirmations(0)).toEqual([{ domain: "kit.example", category: "infra", reporters: 2, at: now, firstReporter: A }]);
    blocklist.recordFlag("kit.example", A, "again", now, now, "drainer");
    expect(blocklist.recentConfirmations(0)).toHaveLength(1);
    const state = JSON.parse(JSON.stringify(blocklist)) as BlocklistState;
    const restored = new Blocklist({ threshold: 2, ttlMs: 30 * 24 * HOUR, clock: () => now }, state);
    expect(restored.recentConfirmations(now)).toHaveLength(1);
    expect(restored.recentConfirmations(now + 1)).toEqual([]);
  });
});

describe("list history and the radar", () => {
  let server: Server;
  let base = "";
  let dir = "";
  let version = 1;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "sinkhole-radar-"));
    server = createServer((req, res) => {
      res.writeHead(200, { "content-type": "text/plain" });
      const names = version === 1 ? ["one.example", "two.example"] : ["one.example", "metamask-claim.example", "coinbase-login.example"];
      res.end(names.join(NL) + NL);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(dir, { recursive: true, force: true });
  });

  it("records what a refresh gained once a baseline exists, keeps it on disk, and feeds the radar", async () => {
    let now = 1_700_000_000_000;
    const url = `${base}/list.txt`;
    const subs = await Subscriptions.load({ dir, refreshMs: 6 * HOUR, clock: () => now }, [url]);
    const id = subscriptionId(url);
    await subs.setCategory(id, "phishing");
    await subs.refresh(id);
    expect(subs.historyOf(id)).toEqual([]);
    version = 2;
    now += HOUR;
    await subs.refresh(id);
    expect(subs.historyOf(id)).toEqual([{ at: now, entries: 3, added: 2, removed: 1, names: ["metamask-claim.example", "coinbase-login.example"] }]);
    const onDisk = JSON.parse(await readFile(join(dir, "history.json"), "utf8")) as { items: Record<string, unknown[]> };
    expect(onDisk.items[id]).toHaveLength(1);

    const reloaded = await Subscriptions.load({ dir, refreshMs: 6 * HOUR, clock: () => now }, [url]);
    expect(reloaded.historyOf(id)).toHaveLength(1);

    const blocklist = new Blocklist({ threshold: 1, ttlMs: 30 * 24 * HOUR, clock: () => now });
    blocklist.recordFlag("ledger-update.example", A, "phishing kit", now, now, "phishing");
    blocklist.recordFlag("pending.example", B, "seen once", now, now, "phishing");
    blocklist.setLists(reloaded.domains());
    const radar = buildRadar({ blocklist: { recentConfirmations: (since) => blocklist.recentConfirmations(since).filter((c) => c.domain !== "pending.example"), flagSummaries: () => [{ domain: "x", category: "phishing", reporters: 1, confirmed: false, firstSeen: now, lastSeen: now, reasons: [] }] }, lists: reloaded, clock: () => now + HOUR });
    expect(radar.swarm).toMatchObject({ confirmed: 1, confirmedWeek: 1, pending: 1 });
    expect(radar.swarm.recent[0]).toMatchObject({ domain: "ledger-update.example", category: "phishing" });
    expect(radar.lists).toEqual([expect.objectContaining({ url, label: "127.0.0.1", entries: 3, refreshes: 1, added: 2, removed: 1, sample: ["metamask-claim.example", "coinbase-login.example"] })]);
    expect(radar.categories.phishing).toBe(1 + 2);
    expect(radar.brands.map((b) => b.brand)).toEqual(["Coinbase", "Ledger", "MetaMask"]);
    expect(radar.totals).toEqual({ listNames: 3, lists: 1 });

    const stale = buildRadar({ blocklist, lists: reloaded, clock: () => now + 30 * HOUR });
    expect(stale.lists[0]).toMatchObject({ refreshes: 0, added: 0, sample: [] });
    expect(stale.swarm.confirmed).toBe(0);
    expect(stale.swarm.confirmedWeek).toBe(2);

    await subs.remove(id);
    expect(subs.historyOf(id)).toEqual([]);
  });

  it("memoizes a build for the interval", () => {
    let now = 0;
    let builds = 0;
    const get = memoize(() => (builds += 1), 60_000, () => now);
    expect([get(), get()]).toEqual([1, 1]);
    now = 60_000;
    expect(get()).toBe(2);
  });
});
