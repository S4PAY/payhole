import { describe, expect, it } from "vitest";
import { createPriceSource, tokensFor, type ReadContract } from "../src/price.js";

const FACTORY = "0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e";
const TOKEN = "0x292a1edc920745c055670bb9a91c910a3669b7ce";
const CURVE = "0xE5109e038e0708beD8fFcd7d7DefF4ecd2499058";
const ZERO = "0x0000000000000000000000000000000000000000";

function fakeChain(state: { ready: boolean; phase: number; quote: bigint; tokens: bigint; pairToken?: string }): ReadContract {
  return (args) => {
    if (args.functionName === "getLaunchedToken") return Promise.resolve({ token: TOKEN, curve: CURVE, pairToken: state.pairToken ?? ZERO, phase: state.phase, exists: true });
    if (args.functionName === "getReserves") return Promise.resolve([state.quote, state.tokens] as const);
    if (args.functionName === "readyToGraduate") return Promise.resolve(state.ready);
    return Promise.reject(new Error(`unexpected ${args.functionName}`));
  };
}

const fakeFetch = (answers: Record<string, { status: number; body: unknown }>): typeof fetch =>
  ((url: string) => {
    const hit = Object.entries(answers).find(([prefix]) => url.startsWith(prefix));
    if (!hit) return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) } as Response);
    return Promise.resolve({ ok: hit[1].status < 400, status: hit[1].status, json: () => Promise.resolve(hit[1].body) } as Response);
  }) as typeof fetch;

describe("token price", () => {
  it("prices from the Pons curve in dollars and rounds ten dollars up to whole tokens", async () => {
    let now = 1_800_000_000_000;
    // 3.75 ETH over 447,182,414 tokens, ETH at 2,500 USD: about 0.000021 USD per token.
    const chain = fakeChain({ ready: false, phase: 0, quote: 3_756_856_140_569_186_476n, tokens: 447_182_414_534_901_476_927_250_797n });
    const price = createPriceSource({ readContract: chain, fetch: fakeFetch({ "https://api.coinbase.com": { status: 200, body: { data: { amount: "2500.00" } } } }), ponsFactory: FACTORY, token: TOKEN, clock: () => now });
    const quote = await price();
    expect(quote.source).toBe("pons-curve");
    expect(quote.usd).toBeCloseTo(0.000021, 6);
    expect(tokensFor(10, quote)).toBe(Math.ceil(10 / quote.usd));
    expect(tokensFor(10, quote)).toBeGreaterThan(400_000);
    expect(tokensFor(10, quote)).toBeLessThan(600_000);
    now += 60_000;
    expect(await price()).toBe(quote);
  });

  it("falls back to CoinGecko for ETH, then to the price URL after graduation, and fails loudly with neither", async () => {
    const graduated = fakeChain({ ready: true, phase: 1, quote: 1n, tokens: 1n });
    const withUrl = createPriceSource({
      readContract: graduated,
      fetch: fakeFetch({ "https://prices.example": { status: 200, body: { token: { usd: 0.00005 } } } }),
      ponsFactory: FACTORY,
      token: TOKEN,
      priceUrl: "https://prices.example/payhole",
      priceJsonPath: "token.usd",
    });
    expect(await withUrl()).toMatchObject({ source: "price-url", usd: 0.00005 });
    const gecko = createPriceSource({
      readContract: fakeChain({ ready: false, phase: 0, quote: 10n ** 18n, tokens: 10n ** 24n }),
      fetch: fakeFetch({ "https://api.coinbase.com": { status: 500, body: {} }, "https://api.coingecko.com": { status: 200, body: { ethereum: { usd: 2000 } } } }),
      ponsFactory: FACTORY,
      token: TOKEN,
    });
    expect((await gecko()).usd).toBeCloseTo(2000 / 1_000_000, 9);
    const nothing = createPriceSource({ readContract: graduated, fetch: fakeFetch({}), ponsFactory: FACTORY, token: TOKEN });
    await expect(nothing()).rejects.toThrow(/graduated.*no PRICE_URL/);
  });
});
