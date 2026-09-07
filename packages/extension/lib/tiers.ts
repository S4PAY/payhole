import type { Account, Address, Chain, Hex, PublicClient, Transport, WalletClient } from "viem";
import { readTierState as readVaultTier, unlockTier as unlockVaultTier } from "@payhole/sdk";

export interface TierLimits {
  /** Live agent session keys at once. */
  agentKeys: number;
  /** Highest global cap, USDG base units. */
  globalCap: bigint;
  /** Highest per-site cap, USDG base units. */
  siteCap: bigint;
}

/**
 * Limits by BurnVault tier. Tier 0 is everyone; higher tiers are bought with USDG that the vault turns into burned
 * PAYHOLE. Tier 2 and above share the last row.
 */
export const TIER_LIMITS: readonly TierLimits[] = [
  { agentKeys: 3, globalCap: 25_000_000n, siteCap: 5_000_000n },
  { agentKeys: 10, globalCap: 100_000_000n, siteCap: 20_000_000n },
  { agentKeys: 100, globalCap: 1_000_000_000n, siteCap: 100_000_000n },
];

export function limitsForTier(tier: number): TierLimits {
  const index = Math.max(0, Math.min(TIER_LIMITS.length - 1, Math.floor(tier)));
  return TIER_LIMITS[index] ?? TIER_LIMITS[0]!;
}

export const ZERO_ADDRESS: Address = "0x0000000000000000000000000000000000000000";

export interface TierState {
  tier: number;
  limits: TierLimits;
  /** True once the vault can swap USDG for PAYHOLE; before that an unlock's USDG is held for a later burn. */
  routeSet: boolean;
  /** Price of the next tier in USDG base units, zero when not offered. */
  nextTierPrice: bigint;
}

export async function readTierState(client: PublicClient, vault: Address, usdg: Address, owner: Address): Promise<TierState> {
  const state = await readVaultTier(client, { vault, usdg, address: owner });
  const nextTier = state.tier + 1;
  const nextTierPrice = nextTier <= 3 ? (state.prices[nextTier] ?? 0n) : 0n;
  return { tier: state.tier, limits: limitsForTier(state.tier), routeSet: state.routeSet, nextTierPrice };
}

export interface UnlockParams {
  publicClient: PublicClient;
  walletClient: WalletClient<Transport, Chain, Account>;
  vault: Address;
  usdg: Address;
  tier: number;
}

/** Approves the tier's USDG price to the vault when needed and calls `unlock`; the vault buys and burns PAYHOLE with it. */
export async function unlockTier(params: UnlockParams): Promise<Hex[]> {
  const { publicClient, walletClient, vault, usdg, tier } = params;
  if (!Number.isInteger(tier) || tier < 1 || tier > 3) throw new Error("tier must be 1, 2, or 3");
  const result = await unlockVaultTier(publicClient, walletClient, { vault, usdg, tier });
  return result.approveHash ? [result.approveHash, result.unlockHash] : [result.unlockHash];
}
