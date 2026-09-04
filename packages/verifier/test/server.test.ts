import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AttestError, type Attestation } from "../src/attest.js";
import { RateLimiter } from "../src/rateLimit.js";
import { createServer } from "../src/server.js";

const attestation: Attestation = {
  domain: "example.com",
  domainHash: "0x" + "11".repeat(32),
  wallet: "0xb9A67f59bcfd3b45fe1ca2c55A55C19B2b35B58f",
  nonce: "0",
  deadline: "1800003600",
  signature: "0x" + "22".repeat(65),
  chainId: 4663,
  registry: "0x1000000000000000000000000000000000000001",
  verifier: "0x2000000000000000000000000000000000000002",
} as Attestation;

let base = "";
const server = createServer({
  attest: (input) => {
    if (input.domain === "bad.example") return Promise.reject(new AttestError(422, "txt_record_missing", "missing", { seen: [] }));
    return Promise.resolve(attestation);
  },
  limiter: new RateLimiter(3, 60_000),
  trustProxy: true,
  health: () => ({ verifier: attestation.verifier }),
});

beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("verifier http", () => {
  it("serves health", async () => {
    const res = await fetch(`${base}/healthz`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, verifier: attestation.verifier });
  });

  it("attests, reports errors, and rate limits per client", async () => {
    const post = (body: string, ip: string) =>
      fetch(`${base}/attest`, { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": ip }, body });
    const ok = await post(JSON.stringify({ domain: "example.com", wallet: attestation.wallet }), "10.0.0.1");
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual(attestation);

    const bad = await post(JSON.stringify({ domain: "bad.example", wallet: attestation.wallet }), "10.0.0.1");
    expect(bad.status).toBe(422);
    expect(await bad.json()).toMatchObject({ error: "txt_record_missing", details: { seen: [] } });

    const notJson = await post("{nope", "10.0.0.1");
    expect(notJson.status).toBe(400);

    const limited = await post("{}", "10.0.0.1");
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toMatch(/^\d+$/);

    const otherClient = await post(JSON.stringify({ domain: "example.com", wallet: attestation.wallet }), "10.0.0.2");
    expect(otherClient.status).toBe(200);
  });

  it("rejects unknown routes and methods", async () => {
    expect((await fetch(`${base}/nope`)).status).toBe(404);
    expect((await fetch(`${base}/attest`)).status).toBe(405);
    expect((await fetch(`${base}/healthz`, { method: "POST" })).status).toBe(405);
  });
});
