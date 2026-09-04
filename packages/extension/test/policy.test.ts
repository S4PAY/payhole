import { describe, expect, it, vi } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import { decodeBase64Json, type PaymentPayload, type PaymentRequired } from "@payhole/sdk";
import { Ledger } from "../lib/ledger";
import { PaymentCore, type ApprovalRequest, type PaymentCoreDeps } from "../lib/payments";
import { decide } from "../lib/policy";
import { memoryStore } from "../lib/storage";

const USDG = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168";
const PAY_TO = "0xb9A67f59bcfd3b45fe1ca2c55A55C19B2b35B58f";

function required(amount: bigint, url = "https://api.example/paid"): PaymentRequired {
  return {
    x402Version: 2,
    resource: { url },
    accepts: [{ scheme: "exact", network: "eip155:4663", asset: USDG, amount: amount.toString(), payTo: PAY_TO, maxTimeoutSeconds: 300, extra: { name: "Global Dollar", version: "1" } }],
  };
}

describe("decide", () => {
  const base = { amount: 100n, paused: false, blocked: false, siteCap: 1_000n, siteSpent: 0n, globalCap: 10_000n, globalSpent: 0n, alreadyPrompted: false, alreadyAttempted: false };

  it("pays silently under both caps", () => {
    expect(decide(base)).toEqual({ kind: "pay" });
    expect(decide({ ...base, siteSpent: 900n })).toEqual({ kind: "pay" });
  });

  it("prompts once over the site or global cap", () => {
    expect(decide({ ...base, siteSpent: 901n })).toEqual({ kind: "prompt" });
    expect(decide({ ...base, globalSpent: 9_950n })).toEqual({ kind: "prompt" });
    expect(decide({ ...base, siteSpent: 901n, alreadyPrompted: true })).toEqual({ kind: "refuse", reason: "prompt-shown" });
  });

  it("refuses paused, blocked, and repeated requests before anything else", () => {
    expect(decide({ ...base, paused: true })).toEqual({ kind: "refuse", reason: "paused" });
    expect(decide({ ...base, blocked: true })).toEqual({ kind: "refuse", reason: "blocked" });
    expect(decide({ ...base, alreadyAttempted: true, paused: true })).toEqual({ kind: "refuse", reason: "already-attempted" });
  });
});

async function setup(overrides: Partial<{ paused: boolean; blocked: string[]; siteCap: bigint; globalCap: bigint; approve: boolean }> = {}) {
  const ledger = new Ledger(memoryStore());
  await ledger.load();
  const signer = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");
  const ensure = vi.fn(() => Promise.resolve({ balance: 1_000_000n, funded: 0n, txHashes: [] }));
  const prompt = vi.fn((_request: ApprovalRequest) => Promise.resolve(overrides.approve ?? false));
  const deps: PaymentCoreDeps = {
    chainId: 4663,
    usdg: USDG,
    signerFor: () => Promise.resolve(signer),
    funder: { ensure },
    ledger,
    policy: () => ({
      paused: overrides.paused ?? false,
      globalCap: overrides.globalCap ?? 25_000_000n,
      siteCap: () => overrides.siteCap ?? 1_000_000n,
      isBlocked: (hostname) => (overrides.blocked ?? []).includes(hostname),
    }),
    prompt,
  };
  return { core: new PaymentCore(deps), ledger, ensure, prompt, signer };
}

const request = (requestId: string, amount = 250_000n) => ({ requestId, tabId: 1, url: "https://api.example/paid", origin: "https://app.example", paymentRequired: required(amount) });

describe("PaymentCore", () => {
  it("pays silently under the cap and records the signed payment", async () => {
    const { core, ledger, ensure, prompt, signer } = await setup();
    const outcome = await core.handle(request("r1"));
    expect(outcome.kind).toBe("pay");
    if (outcome.kind !== "pay") return;
    expect(outcome.headerName).toBe("payment-signature");
    expect(outcome.payer).toBe(signer.address);
    const payload = decodeBase64Json<PaymentPayload>(outcome.headerValue);
    expect(payload.x402Version).toBe(2);
    expect(payload.payload.authorization.from).toBe(signer.address);
    expect(payload.payload.authorization.value).toBe("250000");
    expect(payload.accepted).toEqual(required(250_000n).accepts[0]);
    expect(prompt).not.toHaveBeenCalled();
    expect(ensure).toHaveBeenCalledWith(signer.address, 250_000n, 1_000_000n);
    expect(ledger.spentFor("https://app.example")).toBe(250_000n);
    expect(ledger.recent(1)[0]?.status).toBe("signed");
  });

  it("prompts exactly once per observed offer when over the cap", async () => {
    const { core, prompt, ledger } = await setup({ siteCap: 100_000n });
    const first = await core.handle(request("r1"));
    expect(first.kind).toBe("refused");
    expect(prompt).toHaveBeenCalledTimes(1);
    const again = await core.handle(request("r1"));
    expect(again.kind).toBe("refused");
    expect(prompt).toHaveBeenCalledTimes(1);
    expect(ledger.spentFor("https://app.example")).toBe(0n);
    expect(ledger.recent(5).every((e) => e.status === "refused")).toBe(true);
  });

  it("pays the single approved offer without changing caps", async () => {
    const { core, prompt, ledger } = await setup({ siteCap: 100_000n, approve: true });
    const outcome = await core.handle(request("r1"));
    expect(outcome.kind).toBe("pay");
    expect(prompt).toHaveBeenCalledTimes(1);
    const call = prompt.mock.calls[0]?.[0];
    expect(call?.amount).toBe("250000");
    expect(call?.siteCap).toBe("100000");
    expect(call?.origin).toBe("https://app.example");
    expect(ledger.spentFor("https://app.example")).toBe(250_000n);
    // the cap is unchanged, so the next offer prompts again; declining it refuses
    prompt.mockResolvedValueOnce(false);
    const next = await core.handle({ ...request("r2"), tabId: 2 });
    expect(next).toEqual({ kind: "refused", reason: "declined by the user" });
    expect(prompt).toHaveBeenCalledTimes(2);
    expect(ledger.spentFor("https://app.example")).toBe(250_000n);
  });

  it("refuses blocked sites and paused wallets without prompting or signing", async () => {
    const blocked = await setup({ blocked: ["app.example"] });
    expect(await blocked.core.handle(request("r1"))).toEqual({ kind: "refused", reason: "the site is on the blocklist" });
    expect(blocked.prompt).not.toHaveBeenCalled();
    expect(blocked.ensure).not.toHaveBeenCalled();
    const paused = await setup({ paused: true });
    expect(await paused.core.handle(request("r1"))).toEqual({ kind: "refused", reason: "payments are paused" });
    expect(paused.ensure).not.toHaveBeenCalled();
    expect(paused.ledger.recent(1)[0]?.note).toBe("payments are paused");
  });

  it("never pays a second 402 for the same request", async () => {
    const { core, ensure } = await setup();
    expect((await core.handle(request("r1"))).kind).toBe("pay");
    const second = await core.handle(request("r2"));
    expect(second).toEqual({ kind: "refused", reason: "a payment was already attached to this request" });
    expect(ensure).toHaveBeenCalledTimes(1);
  });

  it("refuses offers it cannot satisfy and funding failures", async () => {
    const { core, ensure } = await setup();
    const wrong = required(1n);
    wrong.accepts[0]!.asset = "0x0000000000000000000000000000000000000001";
    const outcome = await core.handle({ ...request("r1"), paymentRequired: wrong });
    expect(outcome.kind).toBe("refused");
    if (outcome.kind === "refused") expect(outcome.reason).toContain("not USDG");
    ensure.mockRejectedValueOnce(new Error("the owner account has no ETH for gas"));
    const failed = await core.handle({ ...request("r2"), url: "https://api.example/other" });
    expect(failed).toEqual({ kind: "refused", reason: "funding failed: the owner account has no ETH for gas" });
  });

  it("records settlements from the retried response", async () => {
    const { core, ledger } = await setup();
    const outcome = await core.handle(request("r1"));
    if (outcome.kind !== "pay") throw new Error("expected pay");
    const settle = btoa(JSON.stringify({ success: true, transaction: `0x${"1".repeat(64)}`, network: "eip155:4663" }));
    await core.recordSettlement(outcome.ledgerId, (name) => (name === "payment-response" ? settle : null), 200);
    expect(ledger.recent(1)[0]).toMatchObject({ status: "settled", txHash: `0x${"1".repeat(64)}` });
    expect(ledger.spentFor("https://app.example")).toBe(250_000n);
    const second = await core.handle({ ...request("r2"), url: "https://api.example/two" });
    if (second.kind !== "pay") throw new Error("expected pay");
    await core.recordSettlement(second.ledgerId, () => null, 402);
    expect(ledger.recent(1)[0]?.status).toBe("failed");
    expect(ledger.spentFor("https://app.example")).toBe(250_000n);
  });
});
