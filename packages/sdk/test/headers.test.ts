import { describe, expect, it } from "vitest";
import {
  decodeBase64Json,
  encodeBase64Json,
  parsePaymentRequired,
  parseSettleResponse,
  X402ProtocolError,
} from "../src/index.js";

const v2 = {
  x402Version: 2,
  resource: { url: "https://api.example.com/ping", description: "demo", mimeType: "application/json" },
  accepts: [
    {
      scheme: "exact",
      network: "eip155:4663",
      asset: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168",
      amount: "100",
      payTo: "0xb9A67f59bcfd3b45fe1ca2c55A55C19B2b35B58f",
      maxTimeoutSeconds: 300,
      extra: { name: "Global Dollar", version: "1" },
    },
  ],
};

describe("base64 json", () => {
  it("round-trips unicode with standard alphabet and padding", () => {
    const value = { text: "café ñ", n: 1 };
    const encoded = encodeBase64Json(value);
    expect(encoded).toMatch(/^[A-Za-z0-9+/]*={0,2}$/);
    expect(decodeBase64Json(encoded)).toEqual(value);
  });

  it("rejects base64url and whitespace", () => {
    expect(() => decodeBase64Json("eyJ4Ijox-Q")).toThrow(X402ProtocolError);
    expect(() => decodeBase64Json("eyJ4 IjoxfQ==")).toThrow(X402ProtocolError);
    expect(() => decodeBase64Json(encodeBase64Json("not an object").slice(0, -3))).toThrow(X402ProtocolError);
  });
});

describe("parsePaymentRequired", () => {
  it("reads a v2 header before any body", () => {
    const parsed = parsePaymentRequired((n) => (n === "payment-required" ? encodeBase64Json(v2) : null), "{}");
    expect(parsed?.x402Version).toBe(2);
    expect(parsed?.accepts[0]?.payTo).toBe(v2.accepts[0]?.payTo);
  });

  it("reads a v2 body when the header is missing", () => {
    const parsed = parsePaymentRequired(() => null, JSON.stringify(v2));
    expect(parsed?.x402Version).toBe(2);
  });

  it("reads a v1 body", () => {
    const v1 = {
      x402Version: 1,
      accepts: [
        {
          scheme: "exact",
          network: "robinhood",
          maxAmountRequired: "100",
          resource: "https://www.example.com/pay/1",
          description: "d",
          mimeType: "application/json",
          payTo: "0xb9A67f59bcfd3b45fe1ca2c55A55C19B2b35B58f",
          maxTimeoutSeconds: 3600,
          asset: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168",
          extra: { name: "Global Dollar", version: "1" },
        },
      ],
    };
    const parsed = parsePaymentRequired(() => null, JSON.stringify(v1));
    expect(parsed?.x402Version).toBe(1);
  });

  it("returns null for a plain 402", () => {
    expect(parsePaymentRequired(() => null, "payment required")).toBeNull();
    expect(parsePaymentRequired(() => null, "")).toBeNull();
  });

  it("rejects structurally invalid requests", () => {
    const broken = { ...v2, accepts: [{ ...v2.accepts[0], maxTimeoutSeconds: "300" }] };
    expect(() => parsePaymentRequired(() => encodeBase64Json(broken), null)).toThrow(X402ProtocolError);
    expect(() => parsePaymentRequired(() => encodeBase64Json({ x402Version: 3, accepts: [] }), null)).toThrow(X402ProtocolError);
  });
});

describe("parseSettleResponse", () => {
  it("reads v2 and v1 headers", () => {
    const settle = { success: true, transaction: "0xabc", network: "eip155:4663", payer: "0x1" };
    expect(parseSettleResponse((n) => (n === "payment-response" ? encodeBase64Json(settle) : null))).toEqual(settle);
    expect(parseSettleResponse((n) => (n === "x-payment-response" ? encodeBase64Json(settle) : null))).toEqual(settle);
    expect(parseSettleResponse(() => null)).toBeNull();
  });
});
