import { hashTypedData, verifyTypedData } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { describe, expect, it } from "vitest";
import {
  authorizationTypedData,
  buildAuthorization,
  decodeBase64Json,
  preparePayment,
  selectOffer,
  TRANSFER_WITH_AUTHORIZATION_TYPES,
  type PaymentPayload,
  type PaymentRequired,
} from "../src/index.js";

const USDG = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168";
const required: PaymentRequired = {
  x402Version: 2,
  resource: { url: "https://api.naven.network/x402-test/ping", description: "demo", mimeType: "application/json" },
  accepts: [
    {
      scheme: "exact",
      network: "eip155:4663",
      asset: USDG,
      amount: "100",
      payTo: "0xb9A67f59bcfd3b45fe1ca2c55A55C19B2b35B58f",
      maxTimeoutSeconds: 300,
      extra: { name: "Global Dollar", version: "1" },
    },
  ],
};
const signer = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");

describe("EIP-3009 authorization", () => {
  const offer = selectOffer(required, { chainId: 4663, asset: USDG });

  it("builds the reference window and a fresh 32-byte nonce", () => {
    const now = 1_800_000_000;
    const a = buildAuthorization(offer, signer.address, now);
    expect(a.from).toBe(signer.address);
    expect(a.to).toBe("0xb9A67f59bcfd3b45fe1ca2c55A55C19B2b35B58f");
    expect(a.value).toBe("100");
    expect(a.validAfter).toBe("0");
    expect(a.validBefore).toBe(String(now + 300));
    expect(a.nonce).toMatch(/^0x[0-9a-f]{64}$/);
    expect(buildAuthorization(offer, signer.address, now).nonce).not.toBe(a.nonce);
  });

  it("signs under the USDG domain and the TransferWithAuthorization type", async () => {
    const payment = await preparePayment(signer, offer, 1_800_000_000);
    const typed = authorizationTypedData(offer, payment.authorization);
    expect(typed.domain).toEqual({ name: "Global Dollar", version: "1", chainId: 4663, verifyingContract: USDG });
    expect(typed.types).toBe(TRANSFER_WITH_AUTHORIZATION_TYPES);
    expect(payment.signature).toMatch(/^0x[0-9a-f]{130}$/);
    expect(await verifyTypedData({ address: signer.address, signature: payment.signature, ...typed })).toBe(true);
    // domain typehash check: hashing with a different name must not verify
    const wrong = { ...typed, domain: { ...typed.domain, name: "USDG" } };
    expect(hashTypedData(wrong)).not.toBe(hashTypedData(typed));
    expect(await verifyTypedData({ address: signer.address, signature: payment.signature, ...wrong })).toBe(false);
  });

  it("encodes a v2 payload that echoes the accepted requirements verbatim", async () => {
    const payment = await preparePayment(signer, offer);
    expect(payment.headerName).toBe("payment-signature");
    const payload = decodeBase64Json<PaymentPayload>(payment.headerValue);
    expect(payload.x402Version).toBe(2);
    expect(payload.accepted).toEqual(required.accepts[0]);
    expect(payload.resource).toEqual(required.resource);
    expect(payload.payload.authorization).toEqual(payment.authorization);
    expect(payload.payload.signature).toBe(payment.signature);
  });
});
