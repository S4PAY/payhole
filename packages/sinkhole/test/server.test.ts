import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TierError } from "@payhole/sdk";
import { Blocklist } from "../src/blocklist.js";
import { QueryStats } from "../src/queryLog.js";
import { createAdminServer } from "../src/server.js";
import type { SubscriptionInfo } from "../src/subscriptions.js";
import type { DirectoryEntry } from "../src/swarm/directory.js";

const TOKEN = "test-token-123";
const PAY_TO = "0xb9A67f59bcfd3b45fe1ca2c55A55C19B2b35B58f";
const USDG = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168";

const blocklist = new Blocklist({ threshold: 2, ttlMs: 3_600_000 });
const published: { domain: string; reason: string }[][] = [];
const directory: DirectoryEntry[] = [];
const stats = new QueryStats();
const subscriptions = new Map<string, SubscriptionInfo>();
let healthy = true;
let base = "";

function subscription(url: string): SubscriptionInfo {
  return { id: "abcdefabcdef", url, addedAt: 1, lastFetchedAt: null, lastSuccessAt: null, lastError: null, entries: 0, bytes: 0, etag: null, lastModified: null, nextRefreshAt: 1 };
}

const server = createAdminServer({
  token: TOKEN,
  blocklist,
  status: () => ({ peerId: "12D3KooWtest", counts: blocklist.counts() }),
  health: () => ({ ok: healthy, dnsmasq: healthy }),
  directory: {
    list: () => directory,
    add: (input) => {
      if (input.url.includes("bad")) return Promise.resolve({ ok: false, reason: "not_402", detail: "status 200" });
      const entry: DirectoryEntry = {
        url: input.url,
        network: input.network,
        asset: USDG,
        payTo: PAY_TO,
        amount: "1000",
        scheme: "exact",
        reporter: PAY_TO,
        origin: "local",
        announcedTs: 1,
        verifiedAt: 1,
        lastSeen: 1,
        publishedAt: null,
        failures: 0,
      };
      directory.push(entry);
      return Promise.resolve({ ok: true, entry, probed: true });
    },
  },
  publish: (entries) => published.push(entries),
  stats: { snapshot: () => stats.snapshot(), queries: (filter) => stats.queries(filter) },
  subscriptions: {
    list: () => [...subscriptions.values()],
    get: (id) => subscriptions.get(id),
    add: (url) => {
      if (!url.startsWith("http")) return Promise.reject(new Error("url must be an http(s) URL without credentials"));
      const existing = [...subscriptions.values()].find((s) => s.url === url);
      if (existing) return Promise.resolve({ item: existing, added: false });
      const item = subscription(url);
      subscriptions.set(item.id, item);
      return Promise.resolve({ item, added: true });
    },
    remove: (id) => Promise.resolve(subscriptions.delete(id)),
    refresh: (id) => {
      const item = subscriptions.get(id);
      if (item) item.entries = 42;
      return Promise.resolve({ ok: true, changed: true, entries: 42, error: null });
    },
  },
  membership: {
    read: () =>
      Promise.resolve({
        address: PAY_TO,
        tier: 0,
        prices: { "1": "10000000", "2": "50000000", "3": "250000000" },
        usdgBalance: "12000000",
        ethBalance: "1000000000000000",
        allowance: "0",
        routeSet: false,
        canUnlock: true,
      }),
    unlock: (tier: number) => {
      if (tier === 3) return Promise.reject(new TierError("no_usdg", "tier 3 costs 250 USDG"));
      return Promise.resolve({ tier, price: "10000000", approveHash: "0xaa", unlockHash: "0xbb", tokensBurned: "0", held: true });
    },
  },
  maxBodyBytes: 2048,
});

beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function call(path: string, init: RequestInit = {}, token: string | null = TOKEN): Promise<Response> {
  const headers = new Headers(init.headers);
  if (token !== null) headers.set("authorization", `Bearer ${token}`);
  if (init.body !== undefined) headers.set("content-type", "application/json");
  return fetch(`${base}${path}`, { ...init, headers });
}

describe("admin api", () => {
  it("serves health and the page without a token, and refuses the api without it", async () => {
    expect((await call("/healthz", {}, null)).status).toBe(200);
    healthy = false;
    expect((await call("/healthz", {}, null)).status).toBe(503);
    healthy = true;
    const page = await call("/", {}, null);
    expect(page.status).toBe(200);
    expect(page.headers.get("content-type")).toContain("text/html");
    expect(await page.text()).toContain("PayHole Sinkhole");
    const missing = await call("/api/status", {}, null);
    expect(missing.status).toBe(401);
    expect(missing.headers.get("www-authenticate")).toBe("Bearer");
    expect((await call("/api/status", {}, "wrong")).status).toBe(401);
    expect((await call("/api/status", {}, `${TOKEN}x`)).status).toBe(401);
    expect((await call("/api/status", {}, TOKEN.slice(1))).status).toBe(401);
    expect((await call("/nope", {}, null)).status).toBe(404);
  });

  it("reports status", async () => {
    const res = await call("/api/status");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ peerId: "12D3KooWtest", counts: { local: 0, manual: 0, swarmConfirmed: 0, swarmFlagged: 0, list: 0, merged: 0 } });
  });

  it("accepts an extension push, then exports every format", async () => {
    const push = {
      version: 1,
      updatedAt: "2026-09-04T12:00:00.000Z",
      entries: [
        { domain: "Tracker.Example", reason: "tracker", flaggedAt: "2026-09-04T11:00:00.000Z" },
        { domain: "drainer.example", reason: "drainer", flaggedAt: "2026-09-04T11:30:00.000Z" },
        { domain: "http://nope.example/x", reason: "bad", flaggedAt: "2026-09-04T11:30:00.000Z" },
      ],
    };
    const res = await call("/api/blocklist", { method: "PUT", body: JSON.stringify(push) });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, accepted: 2, added: 2, removed: 0, rejected: ["http://nope.example/x"] });
    expect(published).toEqual([
      [
        { domain: "tracker.example", reason: "tracker" },
        { domain: "drainer.example", reason: "drainer" },
      ],
    ]);

    const list = (await (await call("/api/blocklist")).json()) as { count: number; matched: number; entries: { domain: string; sources: string[] }[] };
    expect(list.count).toBe(2);
    expect(list.matched).toBe(2);
    expect(list.entries.map((e) => e.domain)).toEqual(["drainer.example", "tracker.example"]);
    blocklist.setLists(new Set(["ads.example", "tracker.example", "zzz.example"]));
    const merged = (await (await call("/api/blocklist?limit=2")).json()) as { count: number; matched: number; entries: { domain: string; sources: string[] }[] };
    expect(merged.count).toBe(4);
    expect(merged.matched).toBe(4);
    expect(merged.entries.map((e) => [e.domain, e.sources])).toEqual([
      ["drainer.example", ["local"]],
      ["tracker.example", ["local", "list"]],
    ]);
    const searched = (await (await call("/api/blocklist?q=zzz")).json()) as { matched: number; entries: { domain: string; sources: string[] }[] };
    expect(searched.matched).toBe(1);
    expect(searched.entries).toEqual([{ domain: "zzz.example", sources: ["list"], reason: "subscribed list" }]);
    blocklist.setLists(new Set());

    const plain = await call("/api/blocklist/export?format=plain");
    expect(plain.headers.get("content-type")).toContain("text/plain");
    expect((await plain.text()).trim().split(/\s+/)).toEqual(["drainer.example", "tracker.example"]);
    expect(await (await call("/api/blocklist/export?format=hosts")).text()).toContain("0.0.0.0 drainer.example");
    expect(await (await call("/api/blocklist/export?format=dnsmasq")).text()).toContain("address=/tracker.example/0.0.0.0");
    const json = (await (await call("/api/blocklist/export?format=json")).json()) as { count: number };
    expect(json.count).toBe(2);
    expect((await call("/api/blocklist/export")).status).toBe(200);
    expect((await call("/api/blocklist/export?format=csv")).status).toBe(400);

    const bad = await call("/api/blocklist", { method: "PUT", body: JSON.stringify({ version: 2 }) });
    expect(bad.status).toBe(400);
    expect((await call("/api/blocklist", { method: "PUT", body: "{oops" })).status).toBe(400);
    expect((await call("/api/blocklist", { method: "PUT", body: JSON.stringify({ version: 1, updatedAt: "2026-09-04T12:00:00.000Z", entries: [{ domain: "x".repeat(3000) }] }) })).status).toBe(413);
    expect((await call("/api/blocklist", { method: "DELETE" })).status).toBe(405);
  });

  it("manages manual entries", async () => {
    const created = await call("/api/blocklist/manual", { method: "POST", body: JSON.stringify({ domain: "Manual.Example", reason: "operator" }) });
    expect(created.status).toBe(201);
    expect(await created.json()).toEqual({ domain: "manual.example", added: true });
    expect(published.at(-1)).toEqual([{ domain: "manual.example", reason: "operator" }]);
    const again = await call("/api/blocklist/manual", { method: "POST", body: JSON.stringify({ domain: "manual.example" }) });
    expect(again.status).toBe(200);
    expect((await call("/api/blocklist/manual", { method: "POST", body: JSON.stringify({ domain: "not a host" }) })).status).toBe(400);
    expect((await call("/api/blocklist/manual", { method: "POST", body: JSON.stringify({}) })).status).toBe(400);
    expect(blocklist.manualEntries().map((e) => e.domain)).toEqual(["manual.example"]);
    expect((await call("/api/blocklist/manual/manual.example", { method: "DELETE" })).status).toBe(200);
    expect((await call("/api/blocklist/manual/manual.example", { method: "DELETE" })).status).toBe(404);
    expect((await call("/api/blocklist/manual/manual.example", { method: "GET" })).status).toBe(405);
  });

  it("lists swarm flags", async () => {
    blocklist.recordFlag("swarm.example", PAY_TO, "seen", 1);
    const res = await call("/api/flags");
    expect(await res.json()).toEqual({ threshold: 2, ttlMs: 3_600_000, entries: [expect.objectContaining({ domain: "swarm.example", reporters: 1, confirmed: false })] });
  });

  it("adds directory entries through the probe", async () => {
    const ok = await call("/api/directory", { method: "POST", body: JSON.stringify({ url: "https://api.example/paid", payTo: PAY_TO }) });
    expect(ok.status).toBe(201);
    expect(await ok.json()).toMatchObject({ entry: { url: "https://api.example/paid", network: "eip155:4663" }, probed: true });
    const bad = await call("/api/directory", { method: "POST", body: JSON.stringify({ url: "https://api.example/bad", payTo: PAY_TO }) });
    expect(bad.status).toBe(422);
    expect(await bad.json()).toEqual({ error: "not_402", message: "status 200" });
    expect((await call("/api/directory", { method: "POST", body: JSON.stringify({ url: "https://api.example/x" }) })).status).toBe(400);
    const list = (await (await call("/api/directory")).json()) as { count: number };
    expect(list.count).toBe(1);
  });
});

describe("statistics and subscriptions", () => {
  it("serves the stats snapshot and the filtered query log", async () => {
    stats.ingest("dnsmasq[1]: 7 10.0.0.2/1 query[A] drainer.example from 10.0.0.2");
    stats.ingest("dnsmasq[1]: 7 10.0.0.2/1 config drainer.example is 0.0.0.0");
    stats.ingest("dnsmasq[1]: 8 10.0.0.2/2 query[A] ok.example from 10.0.0.2");
    stats.ingest("dnsmasq[1]: 8 10.0.0.2/2 cached ok.example is 1.2.3.4");
    const snap = (await (await call("/api/stats")).json()) as { summary: { queries24h: number; blocked24h: number }; minutes: { total: number[] } };
    expect(snap.summary).toMatchObject({ queries24h: 2, blocked24h: 1 });
    expect(snap.minutes.total).toHaveLength(1440);
    const all = (await (await call("/api/queries")).json()) as { count: number; entries: { domain: string; status: string }[] };
    expect(all.entries.map((q) => q.domain)).toEqual(["ok.example", "drainer.example"]);
    const blocked = (await (await call("/api/queries?status=blocked&limit=5")).json()) as { entries: { domain: string }[] };
    expect(blocked.entries.map((q) => q.domain)).toEqual(["drainer.example"]);
    expect((await call("/api/queries?status=weird")).status).toBe(400);
    expect((await call("/api/stats", { method: "POST" })).status).toBe(405);
  });

  it("manages subscriptions", async () => {
    const created = await call("/api/subscriptions", { method: "POST", body: JSON.stringify({ url: "https://lists.example/hosts.txt" }) });
    expect(created.status).toBe(201);
    expect(await created.json()).toMatchObject({ added: true, entry: { url: "https://lists.example/hosts.txt", entries: 42 }, refresh: { ok: true, entries: 42 } });
    const again = await call("/api/subscriptions", { method: "POST", body: JSON.stringify({ url: "https://lists.example/hosts.txt" }) });
    expect(again.status).toBe(200);
    expect((await call("/api/subscriptions", { method: "POST", body: JSON.stringify({ url: "ftp://x" }) })).status).toBe(400);
    expect((await call("/api/subscriptions", { method: "POST", body: JSON.stringify({}) })).status).toBe(400);
    const list = (await (await call("/api/subscriptions")).json()) as { count: number };
    expect(list.count).toBe(1);
    const refreshed = await call("/api/subscriptions/abcdefabcdef/refresh", { method: "POST" });
    expect(refreshed.status).toBe(200);
    expect(await refreshed.json()).toMatchObject({ refresh: { ok: true } });
    expect((await call("/api/subscriptions/000000000000/refresh", { method: "POST" })).status).toBe(404);
    expect((await call("/api/subscriptions/abcdefabcdef", { method: "DELETE" })).status).toBe(200);
    expect((await call("/api/subscriptions/abcdefabcdef", { method: "DELETE" })).status).toBe(404);
    expect((await call("/api/subscriptions/not-an-id", { method: "DELETE" })).status).toBe(404);
  });

  it("answers 404 for stats and lists when the node has them off", async () => {
    const bare = createAdminServer({
      token: TOKEN,
      blocklist: new Blocklist({ threshold: 2, ttlMs: 1000 }),
      status: () => ({}),
      health: () => ({ ok: true }),
      directory: { list: () => [], add: () => Promise.resolve({ ok: false, reason: "not_402", detail: "off" }) },
    });
    await new Promise<void>((resolve) => bare.listen(0, "127.0.0.1", resolve));
    const bareBase = `http://127.0.0.1:${(bare.address() as AddressInfo).port}`;
    const headers = { authorization: `Bearer ${TOKEN}` };
    expect((await fetch(`${bareBase}/api/stats`, { headers })).status).toBe(404);
    expect((await fetch(`${bareBase}/api/queries`, { headers })).status).toBe(404);
    expect((await fetch(`${bareBase}/api/subscriptions`, { headers })).status).toBe(404);
    await new Promise<void>((resolve) => bare.close(() => resolve()));
  });
});

describe("admin page assets", () => {
  it("serves the stylesheet, the client script, the logo, and the fonts from this origin", async () => {
    const expectations: [string, string][] = [
      ["/admin/styles.css", "text/css"],
      ["/admin/client.js", "text/javascript"],
      ["/admin/logo.png", "image/png"],
      ["/admin/fonts/Inter.woff2", "font/woff2"],
      ["/admin/fonts/SpaceGrotesk.woff2", "font/woff2"],
      ["/admin/fonts/JetBrainsMono.woff2", "font/woff2"],
    ];
    for (const [path, type] of expectations) {
      const res = await call(path, {}, null);
      expect(res.status, path).toBe(200);
      expect(res.headers.get("content-type"), path).toContain(type);
      expect((await res.arrayBuffer()).byteLength, path).toBeGreaterThan(100);
    }
  });

  it("keeps the page free of inline code and points it at the served assets", async () => {
    const res = await call("/", {}, null);
    const csp = res.headers.get("content-security-policy") ?? "";
    expect(csp).toContain("script-src 'self'");
    expect(csp).not.toContain("unsafe-inline");
    const html = await res.text();
    expect(html).toContain('src="/admin/client.js"');
    expect(html).toContain('href="/admin/styles.css"');
    expect(html).not.toMatch(/<script>[^<]/);
  });

  it("does not serve anything else under /admin", async () => {
    expect((await call("/admin/../package.json", {}, null)).status).toBe(404);
    expect((await call("/admin/other.js", {}, null)).status).toBe(404);
    expect((await call("/admin/styles.css", { method: "POST" }, null)).status).toBe(405);
  });
});

describe("membership api", () => {
  it("reports the operator's tier, prices, and balances", async () => {
    const res = await call("/api/membership");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { configured: boolean; tier: number; prices: Record<string, string>; canUnlock: boolean };
    expect(body.configured).toBe(true);
    expect(body.tier).toBe(0);
    expect(body.prices["1"]).toBe("10000000");
    expect(body.canUnlock).toBe(true);
  });

  it("validates the tier, runs an unlock, and maps tier errors to 400", async () => {
    expect((await call("/api/membership/unlock", { method: "POST", body: JSON.stringify({ tier: "1" }) })).status).toBe(400);
    expect((await call("/api/membership/unlock", { method: "POST", body: JSON.stringify({ tier: 0 }) })).status).toBe(400);
    const ok = await call("/api/membership/unlock", { method: "POST", body: JSON.stringify({ tier: 1 }) });
    expect(ok.status).toBe(200);
    const result = (await ok.json()) as { tier: number; held: boolean; unlockHash: string };
    expect(result).toMatchObject({ tier: 1, held: true, unlockHash: "0xbb" });
    const refused = await call("/api/membership/unlock", { method: "POST", body: JSON.stringify({ tier: 3 }) });
    expect(refused.status).toBe(400);
    expect(((await refused.json()) as { error: string }).error).toBe("no_usdg");
  });
});
