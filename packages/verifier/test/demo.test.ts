import { createServer as createHttpServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { HEADER_PAYMENT_REQUIRED, HEADER_PAYMENT_RESPONSE, decodeBase64Json, encodeBase64Json, type PaymentRequired, type SettleResponse } from "@payhole/sdk";
import { ARTICLE, DemoFacilitatorError, demoResponse, paymentRequiredFor, type DemoConfig } from "../src/demo.js";
import { RateLimiter } from "../src/rateLimit.js";
import { createServer } from "../src/server.js";

const GOOD_SIGNATURE = "0x" + "ab".repeat(65);
const TX = "0x" + "cd".repeat(32);
const PAY_TO = "0x4b860C51ED7B97d1Cd8e0e67D907Ea3283449931";
const USDG = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168";

let facilitator: Server;
let facilitatorBase = "";
let verifyCalls = 0;
let settleCalls = 0;

function listen(server: Server): Promise<string> {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`));
  });
}

beforeAll(async () => {
  facilitator = createHttpServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as { paymentPayload: { payload: { signature: string; authorization: { from: string } } } };
      const payer = body.paymentPayload.payload.authorization.from;
      const valid = body.paymentPayload.payload.signature === GOOD_SIGNATURE;
      const answer = (status: number, value: unknown) => {
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify(value));
      };
      if (req.url === "/verify") {
        verifyCalls += 1;
        return valid ? answer(200, { isValid: true, payer }) : answer(402, { isValid: false, invalidReason: "invalid_exact_evm_signature", payer });
      }
      if (req.url === "/settle") {
        settleCalls += 1;
        return answer(200, { success: true, transaction: TX, network: "eip155:4663", payer });
      }
      answer(404, {});
    });
  });
  facilitatorBase = await listen(facilitator);
});

afterAll(() => {
  facilitator.close();
});

function config(overrides: Partial<DemoConfig> = {}): DemoConfig {
  return {
    payTo: PAY_TO,
    price: 10_000n,
    asset: USDG,
    network: "eip155:4663",
    resourceUrl: "https://payhole.org/api/demo/article",
    facilitators: [facilitatorBase],
    timeoutMs: 2_000,
    ...overrides,
  };
}

function payment(overrides: { signature?: string; payTo?: string; amount?: string } = {}): string {
  const requirements = paymentRequiredFor(config()).accepts[0]!;
  const accepted = { ...requirements, payTo: overrides.payTo ?? requirements.payTo, amount: overrides.amount ?? requirements.amount };
  return encodeBase64Json({
    x402Version: 2,
    accepted,
    payload: {
      signature: overrides.signature ?? GOOD_SIGNATURE,
      authorization: { from: "0x759B87aD218BA7ac868D15F988210Eb8B8458E5e", to: accepted.payTo, value: accepted.amount, validAfter: "0", validBefore: "9999999999", nonce: "0x" + "11".repeat(32) },
    },
  });
}

describe("demo article", () => {
  it("challenges an unpaid request with the offer in PAYMENT-REQUIRED", async () => {
    const out = await demoResponse({ config: config() }, undefined);
    expect(out.status).toBe(402);
    const required = decodeBase64Json<PaymentRequired>(out.headers[HEADER_PAYMENT_REQUIRED]!);
    expect(required.x402Version).toBe(2);
    expect(required.accepts[0]).toMatchObject({ scheme: "exact", network: "eip155:4663", amount: "10000", payTo: PAY_TO, asset: USDG, extra: { name: "Global Dollar", version: "1" } });
    expect(out.body).toMatchObject({ error: "payment_required", price: "0.01 USDG" });
  });

  it("rejects garbage and mismatched payloads without calling a facilitator", async () => {
    const before = verifyCalls;
    const garbage = await demoResponse({ config: config() }, "not base64 json");
    expect(garbage.status).toBe(402);
    expect(garbage.body).toMatchObject({ reason: "malformed_payment" });
    const wrongWallet = await demoResponse({ config: config() }, payment({ payTo: "0x0000000000000000000000000000000000000001" }));
    expect(wrongWallet.body).toMatchObject({ reason: "requirements_mismatch", message: expect.stringContaining("payTo") as string });
    const wrongAmount = await demoResponse({ config: config() }, payment({ amount: "1" }));
    expect(wrongAmount.body).toMatchObject({ reason: "requirements_mismatch", message: expect.stringContaining("amount") as string });
    expect(verifyCalls).toBe(before);
  });

  it("serves the article with PAYMENT-RESPONSE after the facilitator settles", async () => {
    const out = await demoResponse({ config: config() }, payment());
    expect(out.status).toBe(200);
    expect(out.body).toMatchObject({ title: ARTICLE.title, paid: { transaction: TX, payTo: PAY_TO, amount: "10000" } });
    const settlement = decodeBase64Json<SettleResponse>(out.headers[HEADER_PAYMENT_RESPONSE]!);
    expect(settlement).toMatchObject({ success: true, transaction: TX, network: "eip155:4663" });
  });

  it("answers 402 with a failed PAYMENT-RESPONSE when the facilitator rejects the signature", async () => {
    const out = await demoResponse({ config: config() }, payment({ signature: "0x" + "00".repeat(65) }));
    expect(out.status).toBe(402);
    expect(out.body).toMatchObject({ reason: "invalid_exact_evm_signature" });
    expect(decodeBase64Json<SettleResponse>(out.headers[HEADER_PAYMENT_RESPONSE]!)).toMatchObject({ success: false, errorReason: "invalid_exact_evm_signature" });
  });

  it("skips a facilitator that cannot be reached for verification", async () => {
    const settled = settleCalls;
    const out = await demoResponse({ config: config({ facilitators: ["http://127.0.0.1:9", facilitatorBase], timeoutMs: 1_000 }) }, payment());
    expect(out.status).toBe(200);
    expect(settleCalls).toBe(settled + 1);
  });

  it("reports an outage when no facilitator answers", async () => {
    await expect(demoResponse({ config: config({ facilitators: ["http://127.0.0.1:9"], timeoutMs: 1_000 }) }, payment())).rejects.toBeInstanceOf(DemoFacilitatorError);
  });
});

describe("server route", () => {
  let base = "";
  let bareBase = "";
  let server: Server;
  let bare: Server;

  beforeAll(async () => {
    server = createServer({
      attest: () => Promise.reject(new Error("unused")),
      limiter: new RateLimiter(2, 60_000),
      trustProxy: false,
      health: () => ({}),
      demo: { config: config() },
    });
    bare = createServer({ attest: () => Promise.reject(new Error("unused")), limiter: new RateLimiter(2, 60_000), trustProxy: false, health: () => ({}) });
    base = await listen(server);
    bareBase = await listen(bare);
  });
  afterAll(() => {
    server.close();
    bare.close();
  });

  it("is absent when no demo is configured", async () => {
    const res = await fetch(`${bareBase}/demo/article`);
    expect(res.status).toBe(404);
  });

  it("exposes the payment headers and only limits paid attempts", async () => {
    const unpaid = await fetch(`${base}/demo/article`);
    expect(unpaid.status).toBe(402);
    expect(unpaid.headers.get(HEADER_PAYMENT_REQUIRED)).toBeTruthy();
    expect(unpaid.headers.get("access-control-expose-headers")).toContain("payment-response");
    for (let i = 0; i < 3; i += 1) expect((await fetch(`${base}/demo/article`)).status).toBe(402);
    const paid = await fetch(`${base}/demo/article`, { headers: { "payment-signature": payment() } });
    expect(paid.status).toBe(200);
    expect(paid.headers.get(HEADER_PAYMENT_RESPONSE)).toBeTruthy();
    await fetch(`${base}/demo/article`, { headers: { "payment-signature": payment() } });
    const limited = await fetch(`${base}/demo/article`, { headers: { "payment-signature": payment() } });
    expect(limited.status).toBe(429);
  });
});
