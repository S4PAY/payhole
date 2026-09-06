import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Blocklist } from "../src/blocklist.js";
import { DnsForwarder } from "../src/dnsForwarder.js";
import { createDohServer } from "../src/encryptedDns.js";
import { RateLimiter } from "../src/rateLimit.js";

const blocklist = new Blocklist({ threshold: 2, ttlMs: 3_600_000 });
blocklist.addManual("kit.example", "drainer backend", undefined, "infra");
blocklist.setListCategoryResolver((domain) => (domain === "ads.example" ? "ad" : null));
blocklist.setLists(new Set(["ads.example"]));

const limiter = new RateLimiter(5, 60_000);
const server = createDohServer({
  forwarder: new DnsForwarder({ host: "127.0.0.1", port: 9, timeoutMs: 100 }),
  limiter,
  log: () => undefined,
  verdict: (name) => blocklist.inspect(name),
});
let base = "";

beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
});

describe("public verdict route", () => {
  it("answers what the node knows about a name, with cross-origin reads allowed", async () => {
    const res = await fetch(`${base}/verdict?name=KIT.example`);
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = (await res.json()) as { domain: string; blocked: boolean; category: string; sources: string[]; checkedAt: number };
    expect(body).toMatchObject({ domain: "kit.example", blocked: true, category: "infra", sources: ["manual"] });
    expect(body.checkedAt).toBeGreaterThan(0);
    const listed = (await (await fetch(`${base}/verdict?name=ads.example`)).json()) as { blocked: boolean; category: string; sources: string[] };
    expect(listed).toMatchObject({ blocked: true, category: "ad", sources: ["list"] });
    const clean = (await (await fetch(`${base}/verdict?name=clean.example`)).json()) as { blocked: boolean; category: null };
    expect(clean).toMatchObject({ blocked: false, category: null });
  });

  it("rejects bad input and other methods without spending the rate limit, then limits lookups", async () => {
    expect((await fetch(`${base}/verdict`)).status).toBe(400);
    expect((await fetch(`${base}/verdict?name=x.example`, { method: "POST" })).status).toBe(405);
    // the three lookups above used three of five tokens; a bad hostname still costs one
    expect((await fetch(`${base}/verdict?name=not%20a%20host`)).status).toBe(400);
    expect((await fetch(`${base}/verdict?name=x.example`)).status).toBe(200);
    const limited = await fetch(`${base}/verdict?name=x.example`);
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBeTruthy();
  });

  it("is not served when the node has no verdict function", async () => {
    const bare = createDohServer({ forwarder: new DnsForwarder({ host: "127.0.0.1", port: 9, timeoutMs: 100 }), limiter: new RateLimiter(3, 60_000), log: () => undefined });
    await new Promise<void>((resolve) => bare.listen(0, "127.0.0.1", resolve));
    const port = (bare.address() as AddressInfo).port;
    expect((await fetch(`http://127.0.0.1:${port}/verdict?name=x.example`)).status).toBe(404);
    await new Promise<void>((resolve, reject) => bare.close((error) => (error ? reject(error) : resolve())));
  });
});
