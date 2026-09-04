import { erc20Abi, maxUint256, type Account, type Address, type Chain, type Hex, type PublicClient, type Transport, type WalletClient } from "viem";
import { burnVaultAbi } from "@payhole/sdk";

export interface TierLimits {
  /** Live agent session keys at once. */
  agentKeys: number;
  /** Highest global cap, USDG base units. */
  globalCap: bigint;
  /** Highest per-site cap, USDG base units. */
  siteCap: bigint;
}

/**
 * Limits by BurnVault tier. Tier 0 is everyone; higher tiers are unlocked by burning $PayHole. Tier 2 and above share
 * the last row.
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
  token: Address;
  tokenSet: boolean;
  /** Cost of the next tier in token base units, zero when not offered. */
  nextTierCost: bigint;
}

export async function readTierState(client: PublicClient, vault: Address, owner: Address): Promise<TierState> {
  const [tier, token] = await Promise.all([
    client.readContract({ address: vault, abi: burnVaultAbi, functionName: "tierOf", args: [owner] }),
    client.readContract({ address: vault, abi: burnVaultAbi, functionName: "token" }),
  ]);
  const nextTier = tier + 1;
  const nextTierCost =
    nextTier <= 255 ? await client.readContract({ address: vault, abi: burnVaultAbi, functionName: "tierCost", args: [nextTier] }) : 0n;
  return { tier, limits: limitsForTier(tier), token, tokenSet: token !== ZERO_ADDRESS, nextTierCost };
}

export interface UnlockParams {
  publicClient: PublicClient;
  walletClient: WalletClient<Transport, Chain, Account>;
  vault: Address;
  tier: number;
}

/** Approves the tier cost in $PayHole to the vault and calls `unlock(tier)`. */
export async function unlockTier(params: UnlockParams): Promise<Hex[]> {
  const { publicClient, walletClient, vault, tier } = params;
  if (!Number.isInteger(tier) || tier < 1 || tier > 255) throw new Error("tier must be between 1 and 255");
  const token = await publicClient.readContract({ address: vault, abi: burnVaultAbi, functionName: "token" });
  if (token === ZERO_ADDRESS) throw new Error("the $PayHole token is not set on the vault yet");
  const cost = await publicClient.readContract({ address: vault, abi: burnVaultAbi, functionName: "tierCost", args: [tier] });
  if (cost === 0n) throw new Error(`tier ${tier} is not offered`);
  const owner = walletClient.account.address;
  const [balance, allowance] = await Promise.all([
    publicClient.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [owner] }),
    publicClient.readContract({ address: token, abi: erc20Abi, functionName: "allowance", args: [owner, vault] }),
  ]);
  if (balance < cost) throw new Error(`the owner holds ${balance.toString()} token units, the tier costs ${cost.toString()}`);
  const hashes: Hex[] = [];
  if (allowance < cost) {
    const approve = await walletClient.writeContract({ address: token, abi: erc20Abi, functionName: "approve", args: [vault, maxUint256] });
    await publicClient.waitForTransactionReceipt({ hash: approve });
    hashes.push(approve);
  }
  const { request } = await publicClient.simulateContract({
    account: walletClient.account,
    address: vault,
    abi: burnVaultAbi,
    functionName: "unlock",
    args: [tier],
  });
  const hash = await walletClient.writeContract(request);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error("unlock reverted");
  hashes.push(hash);
  return hashes;
}
