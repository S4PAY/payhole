import type { Address } from "viem";

/**
 * The token's price in USD, read live so "ten dollars of PAYHOLE" means today's ten dollars. Before the
 * Pons pool graduates the price is the bonding curve's spot price, quote reserve over token reserve, in ETH;
 * ETH is turned into dollars with a public spot feed. After graduation a configured price URL takes over
 * until the pool itself is read. Nothing here is trusted for more than a few minutes.
 */

export interface PriceQuote {
  /** USD per whole token. */
  usd: number;
  source: string;
  at: number;
  detail: string;
}

export type ReadContract = (args: { address: Address; abi: readonly unknown[]; functionName: string; args?: readonly unknown[] }) => Promise<unknown>;

export interface PriceSourceOptions {
  readContract: ReadContract;
  fetch?: typeof fetch | undefined;
  /** The Pons V2 launch factory that knows the token's bonding curve. */
  ponsFactory: Address;
  token: Address;
  /** A JSON endpoint with the token's USD price, for after graduation; `priceJsonPath` picks the field. */
  priceUrl?: string | undefined;
  priceJsonPath?: string | undefined;
  ttlMs?: number | undefined;
  clock?: (() => number) | undefined;
  log?: ((line: string) => void) | undefined;
}

export const PONS_V2_FACTORY: Address = "0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e";

const LAUNCHED_ABI = [
  {
    type: "function",
    name: "getLaunchedToken",
    stateMutability: "view",
    inputs: [{ name: "token", type: "address" }],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "token", type: "address" },
          { name: "curve", type: "address" },
          { name: "deployer", type: "address" },
          { name: "creatorFeeRecipient", type: "address" },
          { name: "pairToken", type: "address" },
          { name: "graduationThreshold", type: "uint256" },
          { name: "poolFee", type: "uint24" },
          { name: "tickSpacing", type: "int24" },
          { name: "creatorTaxBps", type: "uint16" },
          { name: "buybackEnabled", type: "bool" },
          { name: "phase", type: "uint8" },
          { name: "sweptQuote", type: "uint256" },
          { name: "sweptTokens", type: "uint256" },
          { name: "sweptAt", type: "uint256" },
          { name: "exists", type: "bool" },
        ],
      },
    ],
  },
] as const;

const CURVE_ABI = [
  { type: "function", name: "getReserves", stateMutability: "view", inputs: [], outputs: [{ name: "quoteReserve_", type: "uint256" }, { name: "tokenReserve_", type: "uint256" }] },
  { type: "function", name: "readyToGraduate", stateMutability: "view", inputs: [], outputs: [{ type: "bool" }] },
] as const;

interface Launched {
  curve: Address;
  pairToken: Address;
  phase: number;
  exists: boolean;
}

const ZERO = "0x0000000000000000000000000000000000000000";

/** ETH in USD from Coinbase, then CoinGecko; USDG is a dollar for this purpose. */
export async function ethUsd(fetchImpl: typeof fetch): Promise<number> {
  const attempts: { url: string; pick: (body: unknown) => unknown }[] = [
    { url: "https://api.coinbase.com/v2/prices/ETH-USD/spot", pick: (body) => (body as { data?: { amount?: string } }).data?.amount },
    { url: "https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd", pick: (body) => (body as { ethereum?: { usd?: number } }).ethereum?.usd },
  ];
  let lastError = "no source answered";
  for (const attempt of attempts) {
    try {
      const response = await fetchImpl(attempt.url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(6000) });
      if (!response.ok) {
        lastError = `${attempt.url}: ${response.status}`;
        continue;
      }
      const value = Number(attempt.pick(await response.json()));
      if (Number.isFinite(value) && value > 0) return value;
      lastError = `${attempt.url}: no price in the answer`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
  }
  throw new Error(`ETH price unavailable: ${lastError}`);
}

function pick(body: unknown, path: string): unknown {
  let current: unknown = body;
  for (const part of path.split(".").filter((segment) => segment.length > 0)) {
    if (typeof current !== "object" || current === null) return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

/** A price source that remembers its last answer for `ttlMs`. */
export function createPriceSource(options: PriceSourceOptions): () => Promise<PriceQuote> {
  const fetchImpl = options.fetch ?? fetch;
  const clock = options.clock ?? Date.now;
  const ttl = options.ttlMs ?? 5 * 60_000;
  const log = options.log ?? (() => undefined);
  let cached: PriceQuote | null = null;
  let inflight: Promise<PriceQuote> | null = null;

  const fromCurve = async (): Promise<PriceQuote> => {
    const launched = (await options.readContract({ address: options.ponsFactory, abi: LAUNCHED_ABI, functionName: "getLaunchedToken", args: [options.token] })) as Launched;
    if (!launched.exists || launched.curve.toLowerCase() === ZERO) throw new Error("the token is not a Pons launch");
    if (launched.pairToken.toLowerCase() !== ZERO) throw new Error("the curve is not quoted in ETH");
    const [reserves, ready] = await Promise.all([
      options.readContract({ address: launched.curve, abi: CURVE_ABI, functionName: "getReserves" }) as Promise<readonly [bigint, bigint]>,
      options.readContract({ address: launched.curve, abi: CURVE_ABI, functionName: "readyToGraduate" }) as Promise<boolean>,
    ]);
    if (ready || launched.phase !== 0) throw new Error("the token has graduated; the curve price no longer applies");
    const [quote, tokens] = reserves;
    if (tokens === 0n) throw new Error("the curve has no tokens");
    const ethPerToken = Number(quote) / Number(tokens);
    const eth = await ethUsd(fetchImpl);
    return { usd: ethPerToken * eth, source: "pons-curve", at: clock(), detail: `${ethPerToken.toExponential(3)} ETH per token, ETH at ${eth.toFixed(2)} USD` };
  };

  const fromUrl = async (): Promise<PriceQuote> => {
    if (!options.priceUrl) throw new Error("no PRICE_URL configured");
    const response = await fetchImpl(options.priceUrl, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(6000) });
    if (!response.ok) throw new Error(`PRICE_URL answered ${response.status}`);
    const value = Number(pick(await response.json(), options.priceJsonPath ?? "price"));
    if (!Number.isFinite(value) || value <= 0) throw new Error("PRICE_URL had no usable price");
    return { usd: value, source: "price-url", at: clock(), detail: options.priceUrl };
  };

  const refresh = async (): Promise<PriceQuote> => {
    const errors: string[] = [];
    for (const attempt of [fromCurve, fromUrl]) {
      try {
        const quote = await attempt();
        cached = quote;
        return quote;
      } catch (error) {
        errors.push(error instanceof Error ? error.message : String(error));
      }
    }
    const message = `token price unavailable: ${errors.join("; ")}`;
    log(message);
    throw new Error(message);
  };

  return () => {
    const now = clock();
    if (cached && now - cached.at < ttl) return Promise.resolve(cached);
    inflight ??= refresh().finally(() => {
      inflight = null;
    });
    return inflight;
  };
}

/** Whole tokens worth `usd` dollars at `quote`, rounded up. */
export function tokensFor(usd: number, quote: PriceQuote): number {
  return Math.ceil(usd / quote.usd);
}
