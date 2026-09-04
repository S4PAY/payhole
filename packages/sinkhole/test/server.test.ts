import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Blocklist } from "../src/blocklist.js";
import { createAdminServer } from "../src/server.js";
import type { DirectoryEntry } from "../src/swarm/directory.js";

const TOKEN = "test-token-123";
const PAY_TO = "0xb9A67f59bcfd3b45fe1ca2c55A55C19B2b35B58f";
const USDG = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168";

const blocklist = new Blocklist({ threshold: 2, ttlMs: 3_600_000 });
const published: { domain: string; reason: string }[][] = [];
const directory: DirectoryEntry[] = [];
let healthy = true;
let base = "";

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
    expect(await res.json()).toEqual({ peerId: "12D3KooWtest", counts: { local: 0, manual: 0, swarmConfirmed: 0, swarmFlagged: 0, merged: 0 } });
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

    const list = (await (await call("/api/blocklist")).json()) as { count: number; entries: { domain: string; sources: string[] }[] };
    expect(list.count).toBe(2);
    expect(list.entries.map((e) => e.domain)).toEqual(["drainer.example", "tracker.example"]);

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
