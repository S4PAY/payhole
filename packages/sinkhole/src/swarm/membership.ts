import { createPublicClient, http, type Address } from "viem";
import { burnVaultAbi, customChain, robinhoodChain } from "@payhole/sdk";

/** Reads the BurnVault unlock tier of an operator wallet. */
export type TierReader = (address: Address) => Promise<number>;

export interface TierReaderOptions {
  rpcUrl: string;
  chainId: number;
  vault: Address;
}

/** `BurnVault.tierOf(address)` through the configured RPC. */
export function createTierReader(options: TierReaderOptions): TierReader {
  const chain = options.chainId === robinhoodChain.id ? robinhoodChain : customChain(options.chainId, options.rpcUrl);
  const client = createPublicClient({ chain, transport: http(options.rpcUrl) });
  return async (address) => {
    const tier = await client.readContract({ address: options.vault, abi: burnVaultAbi, functionName: "tierOf", args: [address] });
    return Number(tier);
  };
}

export interface TierCacheOptions {
  ttlMs: number;
  /** How long a failed lookup is remembered before the RPC is asked again. */
  errorTtlMs?: number;
  clock?: () => number;
}

interface CacheEntry {
  expires: number;
  tier: number | null;
  error: unknown;
}

/** Memoises a tier reader per address, de-duplicating concurrent lookups. */
export function cachedTierReader(read: TierReader, options: TierCacheOptions): TierReader {
  const clock = options.clock ?? Date.now;
  const errorTtl = options.errorTtlMs ?? 60_000;
  const cache = new Map<string, CacheEntry>();
  const inflight = new Map<string, Promise<number>>();
  return (address) => {
    const key = address.toLowerCase();
    const now = clock();
    const hit = cache.get(key);
    if (hit && hit.expires > now) {
      if (hit.tier === null) return Promise.reject(hit.error instanceof Error ? hit.error : new Error(String(hit.error)));
      return Promise.resolve(hit.tier);
    }
    const pending = inflight.get(key);
    if (pending) return pending;
    if (cache.size > 10_000) {
      for (const [k, entry] of cache) if (entry.expires <= now) cache.delete(k);
    }
    const promise = read(address).then(
      (tier) => {
        cache.set(key, { expires: clock() + options.ttlMs, tier, error: null });
        return tier;
      },
      (error: unknown) => {
        cache.set(key, { expires: clock() + errorTtl, tier: null, error });
        throw error;
      },
    );
    inflight.set(key, promise);
    void promise.finally(() => inflight.delete(key)).catch(() => undefined);
    return promise;
  };
}
