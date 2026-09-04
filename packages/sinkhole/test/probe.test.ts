import { createServer, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chainConfig } from "@payhole/sdk";
import { RateLimiter } from "../src/rateLimit.js";
import { Directory, type DirectoryEntry } from "../src/swarm/directory.js";
import { isForbiddenAddress, probeEndpoint, type ProbeRequest, type ProbeResult } from "../src/swarm/probe.js";

const PAY_TO = "0xb9A67f59bcfd3b45fe1ca2c55A55C19B2b35B58f" as const;
const OTHER = "0x1000000000000000000000000000000000000001" as const;
const BASE_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const USDG = chainConfig.usdg;

function requirementsV2(payTo: string, url: string, network = "eip155:4663", asset: string = USDG): unknown {
  return {
    x402Version: 2,
    resource: { url },
    accepts: [{ scheme: "exact", network, asset, amount: "1000", payTo, maxTimeoutSeconds: 60, extra: { name: "Global Dollar", version: "1" } }],
  };
}

function requirementsV1(payTo: string): unknown {
  return {
    x402Version: 1,
    accepts: [
      {
        scheme: "exact",
        network: "robinhood",
        maxAmountRequired: "2000",
        resource: "/v1",
        description: "",
        mimeType: "application/json",
        payTo,
        maxTimeoutSeconds: 60,
        asset: USDG,
        extra: { name: "Global Dollar", version: "1" },
      },
    ],
  };
}

function encode(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64");
}

let server: Server;
let base = "";
let port = 0;
const pending: ServerResponse[] = [];

beforeAll(async () => {
  server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    switch (url.pathname) {
      case "/v2":
        res.writeHead(402, { "payment-required": encode(requirementsV2(PAY_TO, `${base}/v2`)), "content-type": "application/json" });
        res.end("{}");
        return;
      case "/v1":
        res.writeHead(402, { "content-type": "application/json" });
        res.end(JSON.stringify(requirementsV1(PAY_TO)));
        return;
      case "/other":
        res.writeHead(402, { "payment-required": encode(requirementsV2(OTHER, `${base}/other`)) });
        res.end();
        return;
      case "/base":
        res.writeHead(402, { "payment-required": encode(requirementsV2(PAY_TO, `${base}/base`, "eip155:8453", BASE_USDC)) });
        res.end();
        return;
      case "/ok":
        res.writeHead(200, { "content-type": "text/plain" });
        res.end("hello");
        return;
      case "/plain":
        res.writeHead(402);
        res.end("pay me");
        return;
      case "/slow":
        pending.push(res);
        return;
      default:
        res.writeHead(404);
        res.end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = (server.address() as AddressInfo).port;
  base = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  for (const res of pending) res.destroy();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

const local = { allowPrivate: true };

describe("probeEndpoint", () => {
  it("accepts a v2 402 whose offer matches the announcement", async () => {
    const result = await probeEndpoint({ url: `${base}/v2`, network: "eip155:4663", asset: USDG, payTo: PAY_TO.toLowerCase() }, local);
    expect(result).toEqual({ ok: true, offer: { network: "eip155:4663", asset: USDG, payTo: PAY_TO, amount: "1000", scheme: "exact" } });
  });

  it("accepts a v1 JSON body announced with the robinhood slug", async () => {
    const result = await probeEndpoint({ url: `${base}/v1`, network: "robinhood", asset: USDG, payTo: PAY_TO }, local);
    expect(result).toMatchObject({ ok: true, offer: { amount: "2000", payTo: PAY_TO } });
  });

  it("uses the permissive matcher for other networks", async () => {
    const result = await probeEndpoint({ url: `${base}/base`, network: "eip155:8453", asset: BASE_USDC, payTo: PAY_TO }, local);
    expect(result).toMatchObject({ ok: true, offer: { network: "eip155:8453", asset: BASE_USDC, amount: "1000" } });
    const wrongAsset = await probeEndpoint({ url: `${base}/base`, network: "eip155:8453", asset: USDG, payTo: PAY_TO }, local);
    expect(wrongAsset).toMatchObject({ ok: false, reason: "no_matching_offer" });
  });

  it("rejects a 200, a mismatched payTo and a 402 without a payment request", async () => {
    expect(await probeEndpoint({ url: `${base}/ok`, network: "eip155:4663", asset: USDG, payTo: PAY_TO }, local)).toMatchObject({ ok: false, reason: "not_402" });
    expect(await probeEndpoint({ url: `${base}/other`, network: "eip155:4663", asset: USDG, payTo: PAY_TO }, local)).toMatchObject({ ok: false, reason: "no_matching_offer" });
    expect(await probeEndpoint({ url: `${base}/v2`, network: "eip155:4663", asset: OTHER, payTo: PAY_TO }, local)).toMatchObject({ ok: false, reason: "no_matching_offer" });
    expect(await probeEndpoint({ url: `${base}/plain`, network: "eip155:4663", asset: USDG, payTo: PAY_TO }, local)).toMatchObject({ ok: false, reason: "no_payment_required" });
  });

  it("refuses loopback, private and metadata destinations before any request is made", async () => {
    let calls = 0;
    const request: ProbeRequest = () => {
      calls += 1;
      return Promise.reject(new Error("must not be called"));
    };
    const announcement = { network: "eip155:4663", asset: USDG, payTo: PAY_TO };
    expect(await probeEndpoint({ ...announcement, url: `${base}/v2` }, { request })).toMatchObject({ ok: false, reason: "forbidden_address" });
    expect(await probeEndpoint({ ...announcement, url: "http://169.254.169.254/latest/meta-data" }, { request })).toMatchObject({ ok: false, reason: "forbidden_address" });
    expect(await probeEndpoint({ ...announcement, url: "http://[::1]:8080/x" }, { request })).toMatchObject({ ok: false, reason: "forbidden_address" });
    expect(await probeEndpoint({ ...announcement, url: "http://localhost/x" }, { request, resolve: () => Promise.resolve(["127.0.0.1"]) })).toMatchObject({ ok: false, reason: "forbidden_address" });
    expect(await probeEndpoint({ ...announcement, url: "https://intranet.example/x" }, { request, resolve: () => Promise.resolve(["10.0.0.5"]) })).toMatchObject({ ok: false, reason: "forbidden_address" });
    expect(await probeEndpoint({ ...announcement, url: "https://mixed.example/x" }, { request, resolve: () => Promise.resolve(["1.1.1.1", "192.168.1.1"]) })).toMatchObject({ ok: false, reason: "forbidden_address" });
    expect(await probeEndpoint({ ...announcement, url: "ftp://files.example/x" }, { request })).toMatchObject({ ok: false, reason: "invalid_url" });
    expect(await probeEndpoint({ ...announcement, url: "http://user:secret@api.example/x" }, { request })).toMatchObject({ ok: false, reason: "invalid_url" });
    expect(await probeEndpoint({ ...announcement, url: "not a url" }, { request })).toMatchObject({ ok: false, reason: "invalid_url" });
    expect(await probeEndpoint({ ...announcement, url: "https://gone.example/x" }, { request, resolve: () => Promise.reject(new Error("ENOTFOUND")) })).toMatchObject({ ok: false, reason: "resolve_failed" });
    expect(calls).toBe(0);
  });

  it("pins the connection to the vetted address while keeping the host header", async () => {
    const result = await probeEndpoint(
      { url: `http://probe.test:${port}/v2`, network: "eip155:4663", asset: USDG, payTo: PAY_TO },
      { allowPrivate: true, resolve: () => Promise.resolve(["127.0.0.1"]) },
    );
    expect(result).toMatchObject({ ok: true });
  });

  it("gives up after the timeout", async () => {
    const result = await probeEndpoint({ url: `${base}/slow`, network: "eip155:4663", asset: USDG, payTo: PAY_TO }, { allowPrivate: true, timeoutMs: 300 });
    expect(result).toMatchObject({ ok: false, reason: "timeout" });
  });
});

describe("isForbiddenAddress", () => {
  it("classifies addresses", () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.5.5", "192.168.0.9", "169.254.169.254", "100.64.0.1", "0.0.0.0", "224.0.0.1", "::1", "::", "fe80::1", "fd00::1", "::ffff:127.0.0.1", "::ffff:7f00:1", "::ffff:10.0.0.1", "64:ff9b::7f00:1", "not-an-ip"]) {
      expect(isForbiddenAddress(ip), ip).toBe(true);
    }
    for (const ip of ["1.1.1.1", "8.8.8.8", "104.16.0.1", "2606:4700::1111", "::ffff:1.1.1.1"]) expect(isForbiddenAddress(ip), ip).toBe(false);
  });
});

describe("Directory", () => {
  const offer = { network: "eip155:4663", asset: USDG, payTo: PAY_TO, amount: "1000", scheme: "exact" };
  function make(limit = 10) {
    let now = 1_700_000_000_000;
    let outcome: ProbeResult = { ok: true, offer };
    let probes = 0;
    const directory = new Directory(
      {
        probe: () => {
          probes += 1;
          return Promise.resolve(outcome);
        },
        limiter: new RateLimiter(limit, 60 * 60_000),
        reverifyMs: 60 * 60_000,
        republishMs: 60 * 60_000,
        ttlMs: 7 * 24 * 60 * 60_000,
        maxFailures: 3,
        clock: () => now,
      },
    );
    return { directory, probes: () => probes, advance: (ms: number) => (now += ms), setOutcome: (o: ProbeResult) => (outcome = o) };
  }
  const body = { type: "endpoint" as const, url: "https://api.example/paid#frag", network: "eip155:4663", asset: USDG, payTo: PAY_TO, ts: 1 };

  it("stores verified announcements and skips the probe while the entry is fresh", async () => {
    const { directory, probes, advance } = make();
    const first = await directory.handleAnnouncement(body, OTHER);
    expect(first).toMatchObject({ ok: true, probed: true, entry: { url: "https://api.example/paid", origin: "swarm", reporter: OTHER, amount: "1000" } });
    expect(probes()).toBe(1);
    advance(10 * 60_000);
    expect(await directory.handleAnnouncement(body, OTHER)).toMatchObject({ ok: true, probed: false });
    expect(probes()).toBe(1);
    advance(60 * 60_000);
    expect(await directory.handleAnnouncement(body, OTHER)).toMatchObject({ ok: true, probed: true });
    expect(probes()).toBe(2);
    expect(await directory.handleAnnouncement({ ...body, payTo: OTHER }, OTHER)).toMatchObject({ ok: true, probed: true, entry: { payTo: OTHER } });
    expect(probes()).toBe(3);
    expect(directory.list()).toHaveLength(1);
  });

  it("rate-limits probes per host and drops entries after repeated failures", async () => {
    const { directory, probes, setOutcome, advance } = make(2);
    expect(await directory.handleAnnouncement(body, OTHER)).toMatchObject({ ok: true });
    expect(await directory.addLocal({ url: "https://api.example/second", network: "eip155:4663", asset: USDG, payTo: PAY_TO }, PAY_TO)).toMatchObject({ ok: true, entry: { origin: "local" } });
    expect(await directory.addLocal({ url: "https://api.example/third", network: "eip155:4663", asset: USDG, payTo: PAY_TO }, PAY_TO)).toMatchObject({ ok: false, reason: "rate_limited" });
    expect(probes()).toBe(2);
    advance(2 * 60 * 60_000);
    setOutcome({ ok: false, reason: "not_402", detail: "status 200" });
    for (let i = 0; i < 3; i += 1) {
      expect(await directory.handleAnnouncement(body, OTHER)).toMatchObject({ ok: false, reason: "not_402" });
      advance(60 * 60_000);
    }
    expect(directory.get(body.url)).toBeUndefined();
    expect(directory.size).toBe(1);
  });

  it("tracks publication and prunes stale entries, surviving a JSON round trip", async () => {
    const { directory, advance } = make();
    await directory.handleAnnouncement(body, OTHER);
    expect(directory.dueForPublish().map((e) => e.url)).toEqual(["https://api.example/paid"]);
    directory.markPublished("https://api.example/paid");
    expect(directory.dueForPublish()).toEqual([]);
    advance(61 * 60_000);
    expect(directory.dueForPublish()).toHaveLength(1);
    expect(await directory.reverify("https://api.example/paid")).toBe(true);
    const restored = new Directory({ probe: () => Promise.resolve({ ok: true, offer }) }, JSON.parse(JSON.stringify(directory.toJSON())) as DirectoryEntry[]);
    expect(restored.list()).toEqual(directory.list());
    advance(8 * 24 * 60 * 60_000);
    expect(directory.prune()).toBe(true);
    expect(directory.size).toBe(0);
  });

  it("rejects invalid URLs and addresses without probing", async () => {
    const { directory, probes } = make();
    expect(await directory.handleAnnouncement({ ...body, url: "ftp://x.example" }, OTHER)).toMatchObject({ ok: false, reason: "invalid_url" });
    expect(await directory.addLocal({ url: "https://x.example", network: "eip155:4663", asset: "usdg", payTo: PAY_TO }, PAY_TO)).toMatchObject({ ok: false, reason: "no_matching_offer" });
    expect(probes()).toBe(0);
  });
});
