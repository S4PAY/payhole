import type { PublicClient } from "viem";
import { describe, expect, it } from "vitest";
import { feeFor, quoteBurn, QUOTER_V2, ROUTE_KIND_V3, ROUTE_KIND_V4 } from "../lib/topup";

const VAULT = "0x1000000000000000000000000000000000000001";
const V4_QUOTER = "0x2000000000000000000000000000000000000002";
const USDG = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168";
const TOKEN = "0x3000000000000000000000000000000000000003";
const PATH = "0x5fc5360d0400a0fd4f2af552add042d716f1d1680027103000000000000000000000000000000000000003";

interface Fake {
  token: string;
  kind: number;
  route: unknown[];
  path: string;
  quote: bigint | Error;
  calls: { address: string; functionName: string; args?: unknown }[];
}

function client(f: Fake): PublicClient {
  const fake = {
    readContract(params: { address: string; functionName: string; args?: unknown }) {
      f.calls.push(params);
      switch (params.functionName) {
        case "token":
          return Promise.resolve(f.token);
        case "routeKind":
          return Promise.resolve(f.kind);
        case "route":
          return Promise.resolve(f.route);
        case "routeV3":
          return Promise.resolve(f.path);
        default:
          return Promise.reject(new Error(`unexpected read ${params.functionName}`));
      }
    },
    simulateContract(params: { address: string; functionName: string; args?: unknown }) {
      f.calls.push(params);
      if (f.quote instanceof Error) return Promise.reject(f.quote);
      return Promise.resolve({ result: [f.quote, [], [], 0n] });
    },
  };
  return fake as unknown as PublicClient;
}

describe("quoteBurn", () => {
  it("quotes a V4 single hop through the V4 quoter with a 2 percent tolerance", async () => {
    const f: Fake = { token: TOKEN, kind: ROUTE_KIND_V4, route: [{ currency0: USDG, currency1: TOKEN, fee: 0, tickSpacing: 200, hooks: "0x0000000000000000000000000000000000000000" }], path: "0x", quote: 1_000_000n, calls: [] };
    const quote = await quoteBurn(client(f), VAULT, V4_QUOTER, USDG, 10_000n);
    expect(quote).toEqual({ ok: true, amountOut: 1_000_000n, minAmountOut: 980_000n });
    expect(f.calls.at(-1)).toMatchObject({ address: V4_QUOTER, functionName: "quoteExactInputSingle" });
  });

  it("quotes a V3 path through QuoterV2", async () => {
    const f: Fake = { token: TOKEN, kind: ROUTE_KIND_V3, route: [], path: PATH, quote: 500n, calls: [] };
    const quote = await quoteBurn(client(f), VAULT, V4_QUOTER, USDG, 10_000n);
    expect(quote).toEqual({ ok: true, amountOut: 500n, minAmountOut: 490n });
    expect(f.calls.at(-1)).toMatchObject({ address: QUOTER_V2, functionName: "quoteExactInput", args: [PATH, 10_000n] });
  });

  it("skips instead of burning without a minimum", async () => {
    const unset: Fake = { token: "0x0000000000000000000000000000000000000000", kind: ROUTE_KIND_V4, route: [], path: "0x", quote: 1n, calls: [] };
    expect(await quoteBurn(client(unset), VAULT, V4_QUOTER, USDG, 1n)).toMatchObject({ ok: false });
    const noRoute: Fake = { token: TOKEN, kind: 0, route: [], path: "0x", quote: 1n, calls: [] };
    expect(await quoteBurn(client(noRoute), VAULT, V4_QUOTER, USDG, 1n)).toMatchObject({ ok: false, reason: "the vault has no USDG route" });
    const twoHops: Fake = { token: TOKEN, kind: ROUTE_KIND_V4, route: [{}, {}], path: "0x", quote: 1n, calls: [] };
    expect(await quoteBurn(client(twoHops), VAULT, V4_QUOTER, USDG, 1n)).toMatchObject({ ok: false });
    const failing: Fake = { token: TOKEN, kind: ROUTE_KIND_V3, route: [], path: PATH, quote: new Error("execution reverted"), calls: [] };
    expect(await quoteBurn(client(failing), VAULT, V4_QUOTER, USDG, 1n)).toMatchObject({ ok: false, reason: "quote failed: execution reverted" });
  });

  it("computes fees in basis points", () => {
    expect(feeFor(1_000_000n, 1)).toBe(10_000n);
    expect(feeFor(1_000_000n, 0.25)).toBe(2_500n);
    expect(feeFor(1_000_000n, 0)).toBe(0n);
  });
});
