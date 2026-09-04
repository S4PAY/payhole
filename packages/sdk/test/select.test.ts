import { describe, expect, it } from "vitest";
import { chainIdFromNetwork, NoAcceptableOfferError, selectOffer, type PaymentRequired } from "../src/index.js";

const USDG = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168";
const base = {
  scheme: "exact",
  network: "eip155:4663",
  asset: USDG.toLowerCase(),
  amount: "100",
  payTo: "0xb9A67f59bcfd3b45fe1ca2c55A55C19B2b35B58f",
  maxTimeoutSeconds: 300,
  extra: { name: "Global Dollar", version: "1" },
};
const required = (accepts: PaymentRequired["accepts"]): PaymentRequired => ({
  x402Version: 2,
  resource: { url: "https://x.example/r" },
  accepts,
});

describe("selectOffer", () => {
  it("normalises a matching v2 offer", () => {
    const offer = selectOffer(required([base]), { chainId: 4663, asset: USDG });
    expect(offer.version).toBe(2);
    expect(offer.amount).toBe(100n);
    expect(offer.asset).toBe(USDG);
    expect(offer.chainId).toBe(4663);
    expect(offer.eip712).toEqual({ name: "Global Dollar", version: "1" });
    expect(offer.raw).toBe(required([base]).accepts[0] ?? offer.raw);
  });

  it("skips offers PayHole cannot pay and explains why", () => {
    const req = required([
      { ...base, scheme: "upto" },
      { ...base, network: "eip155:8453" },
      { ...base, asset: "0x0000000000000000000000000000000000000001" },
      { ...base, extra: { name: "Global Dollar", version: "1", assetTransferMethod: "permit2" } },
      { ...base, extra: { name: "Global Dollar", version: "1", paymentFlow: "escrow" } },
      { ...base, extra: { version: "1" } },
    ]);
    try {
      selectOffer(req, { chainId: 4663, asset: USDG });
      throw new Error("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(NoAcceptableOfferError);
      expect((error as NoAcceptableOfferError).reasons).toHaveLength(6);
    }
  });

  it("takes the first acceptable entry", () => {
    const req = required([{ ...base, network: "eip155:1" }, { ...base, amount: "7" }, base]);
    expect(selectOffer(req, { chainId: 4663, asset: USDG }).amount).toBe(7n);
  });

  it("understands the v1 robinhood slug", () => {
    expect(chainIdFromNetwork("robinhood")).toBe(4663);
    expect(chainIdFromNetwork("eip155:4663")).toBe(4663);
    expect(chainIdFromNetwork("base")).toBeNull();
    const offer = selectOffer(
      {
        x402Version: 1,
        accepts: [
          {
            scheme: "exact",
            network: "robinhood",
            maxAmountRequired: "250",
            resource: "https://x.example/r",
            description: "",
            mimeType: "",
            payTo: base.payTo,
            maxTimeoutSeconds: 3600,
            asset: USDG,
            extra: base.extra,
          },
        ],
      },
      { chainId: 4663, asset: USDG },
    );
    expect(offer.version).toBe(1);
    expect(offer.amount).toBe(250n);
    expect(offer.network).toBe("robinhood");
  });
});
