import { describe, expect, it, vi } from "vitest";
import { AddressCache, assess, collectAddresses, fetchAddress, inspectRequest, parseAddress, rolesOf, type AddressLookup } from "../lib/guard";

const DRAINER = "0x101ce0cedd142f199c9ef61739ae59b6611a0fc0";
const TOKEN = "0x5fc5360d0400a0fd4f2af552add042d716f1d168";
const SPENDER = "0x000000000022d473030f116ddee9f6b43ac78ba3";
const ME = "0xb6772ec78c5c133f298b60154d13f8e52a1dcbf3";
const MAX = "0x" + "f".repeat(64);

function word(address: string): string {
  return address.slice(2).padStart(64, "0");
}

function lookups(flagged: string[]): Map<string, AddressLookup | null> {
  const out = new Map<string, AddressLookup | null>();
  for (const address of flagged) out.set(address, { address, flagged: true, category: "drainer", sources: ["list"], label: "ScamSniffer" });
  return out;
}

describe("reading wallet requests", () => {
  it("reads a plain send, an ERC-20 transfer, and an approval, with the amounts that mean unlimited", () => {
    const send = inspectRequest("eth_sendTransaction", [{ from: ME, to: DRAINER, value: "0xde0b6b3a7640000" }]);
    expect(send).toMatchObject({ to: DRAINER, isCall: false, value: 10n ** 18n, transfers: [{ recipient: DRAINER, token: null }], addresses: [DRAINER] });
    const transfer = inspectRequest("eth_sendTransaction", [{ from: ME, to: TOKEN, data: `0xa9059cbb${word(DRAINER)}${"0".repeat(63)}1` }]);
    expect(transfer).toMatchObject({ to: TOKEN, isCall: true, transfers: [{ recipient: DRAINER, token: TOKEN }] });
    expect(transfer?.addresses).toEqual([TOKEN, DRAINER]);
    const approve = inspectRequest("eth_sendTransaction", [{ from: ME, to: TOKEN, data: `0x095ea7b3${word(SPENDER)}${MAX.slice(2)}` }]);
    expect(approve?.approvals).toEqual([{ kind: "approve", spender: SPENDER, token: TOKEN, unlimited: true }]);
    const small = inspectRequest("eth_sendTransaction", [{ from: ME, to: TOKEN, data: `0x095ea7b3${word(SPENDER)}${"0".repeat(60)}03e8` }]);
    expect(small?.approvals[0]?.unlimited).toBe(false);
    const all = inspectRequest("eth_sendTransaction", [{ from: ME, to: TOKEN, data: `0xa22cb465${word(SPENDER)}${"0".repeat(63)}1` }]);
    expect(all?.approvals).toEqual([{ kind: "approveAll", spender: SPENDER, token: TOKEN, unlimited: true }]);
    expect(inspectRequest("eth_getBalance", [ME, "latest"])).toBeNull();
    expect(inspectRequest("eth_sendTransaction", "nope")?.addresses).toEqual([]);
  });

  it("reads permits and Permit2 from typed data, and every address in anything else signed", () => {
    const permit = { types: {}, primaryType: "Permit", domain: { name: "USDG", verifyingContract: TOKEN }, message: { owner: ME, spender: SPENDER, value: MAX, nonce: 1, deadline: 9 } };
    const read = inspectRequest("eth_signTypedData_v4", [ME, JSON.stringify(permit)]);
    expect(read).toMatchObject({ to: TOKEN, isCall: false, approvals: [{ kind: "permit", spender: SPENDER, token: TOKEN, unlimited: true }] });
    expect(read?.addresses.sort()).toEqual([ME, SPENDER, TOKEN].sort());
    const permit2 = { primaryType: "PermitSingle", domain: { verifyingContract: SPENDER }, message: { details: { token: TOKEN, amount: "1461501637330902918203684832716283019655932542975", expiration: 1, nonce: 0 }, spender: DRAINER, sigDeadline: 1 } };
    expect(inspectRequest("eth_signTypedData_v4", [ME, permit2])?.approvals).toEqual([{ kind: "permit2", spender: DRAINER, token: TOKEN, unlimited: true }]);
    const order = { primaryType: "OrderComponents", domain: { verifyingContract: SPENDER }, message: { offerer: ME, consideration: [{ recipient: DRAINER }] } };
    const seaport = inspectRequest("eth_signTypedData_v4", [ME, JSON.stringify(order)]);
    expect(seaport?.approvals).toEqual([]);
    expect(seaport?.addresses).toContain(DRAINER);
    expect(inspectRequest("eth_signTypedData_v4", [ME, "{not json"])?.addresses).toEqual([]);
    expect(collectAddresses({ a: [{ b: DRAINER.toUpperCase().replace("0X", "0x") }], c: "x" })).toEqual(new Set([DRAINER]));
    expect(parseAddress("0x12")).toBeNull();
  });

  it("reads a batch of calls", () => {
    const batch = inspectRequest("wallet_sendCalls", [{ version: "1.0", calls: [{ to: TOKEN, data: `0x095ea7b3${word(SPENDER)}${MAX.slice(2)}` }, { to: DRAINER, value: "0x1" }] }]);
    expect(batch?.approvals).toHaveLength(1);
    expect(batch?.transfers).toEqual([{ recipient: DRAINER, token: null }]);
    expect(batch?.addresses.sort()).toEqual([DRAINER, SPENDER, TOKEN].sort());
  });
});

describe("weighing requests", () => {
  it("stops on a flagged recipient, spender, or contract, warns on an unlimited approval, and clears the rest", () => {
    const send = inspectRequest("eth_sendTransaction", [{ to: DRAINER, value: "0x1" }])!;
    const stopped = assess(send, lookups([DRAINER]), { warnUnlimited: true });
    expect(stopped.level).toBe("stop");
    expect(stopped.flagged).toEqual([{ address: DRAINER, role: "recipient", category: "drainer", label: "ScamSniffer", sources: ["list"] }]);
    expect(stopped.summary).toBe("Sending to 0x101c…0fc0, a known wallet drainer (ScamSniffer). The funds would not come back.");

    const approve = inspectRequest("eth_sendTransaction", [{ to: TOKEN, data: `0x095ea7b3${word(DRAINER)}${MAX.slice(2)}` }])!;
    expect(rolesOf(approve).get(DRAINER)).toBe("spender");
    const spender = assess(approve, lookups([DRAINER]), { warnUnlimited: true });
    expect(spender).toMatchObject({ level: "stop", unlimited: [] });
    expect(spender.summary).toContain("lets 0x101c…0fc0 move your tokens");

    const unlimited = inspectRequest("eth_sendTransaction", [{ to: TOKEN, data: `0x095ea7b3${word(SPENDER)}${MAX.slice(2)}` }])!;
    const warned = assess(unlimited, lookups([]), { warnUnlimited: true });
    expect(warned.level).toBe("warn");
    expect(warned.summary).toContain("Unlimited approval to 0x0000…8ba3");
    expect(assess(unlimited, lookups([]), { warnUnlimited: false }).level).toBe("clear");

    const call = inspectRequest("eth_sendTransaction", [{ to: DRAINER, data: "0x12345678" }])!;
    expect(assess(call, lookups([DRAINER]), { warnUnlimited: true }).summary).toContain("Calling it is how the funds leave");
    expect(assess(call, new Map([[DRAINER, null]]), { warnUnlimited: true }).level).toBe("clear");
  });
});

describe("asking about addresses", () => {
  it("fetches an answer and remembers it, longer when flagged, and answers null for what it cannot reach", async () => {
    let now = 1_800_000_000_000;
    const fetchImpl = vi.fn((url: string) => {
      const address = new URL(url).searchParams.get("address") ?? "";
      if (address === "0x" + "e".repeat(40)) return Promise.reject(new Error("offline"));
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ address, flagged: address === DRAINER, category: address === DRAINER ? "drainer" : null, sources: address === DRAINER ? ["list"] : [], label: address === DRAINER ? "ScamSniffer" : null, checkedAt: now }) } as Response);
    });
    expect(await fetchAddress(DRAINER, "https://dns.payhole.org/", fetchImpl as unknown as typeof fetch)).toMatchObject({ flagged: true, label: "ScamSniffer" });
    expect(fetchImpl).toHaveBeenCalledWith(`https://dns.payhole.org/address?address=${DRAINER}`, expect.anything());
    const cache = new AddressCache((address) => fetchAddress(address, "https://dns.payhole.org", fetchImpl as unknown as typeof fetch), { ttlMs: 1000, flaggedTtlMs: 5000, now: () => now });
    const all = await cache.lookupAll([DRAINER, TOKEN, "0x" + "e".repeat(40)]);
    expect(all.get(DRAINER)?.flagged).toBe(true);
    expect(all.get(TOKEN)?.flagged).toBe(false);
    expect(all.get("0x" + "e".repeat(40))).toBeNull();
    const calls = fetchImpl.mock.calls.length;
    await cache.lookupAll([DRAINER, TOKEN]);
    expect(fetchImpl.mock.calls.length).toBe(calls);
    now += 1500;
    expect(cache.known(TOKEN)).toBeNull();
    expect(cache.known(DRAINER)?.flagged).toBe(true);
  });
});
