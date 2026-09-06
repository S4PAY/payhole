import {
  encodeAbiParameters,
  encodeEventTopics,
  erc20Abi,
  parseEventLogs,
  type Address,
  type Hash,
  type Hex,
  type Log,
  type TransactionReceipt,
} from "viem";
import { burnVaultAbi } from "./generated/abi.js";

/** Tiers the vault offers. Prices live on chain; a zero price means the tier is not offered. */
export const TIERS = [1, 2, 3] as const;

export interface TierState {
  address: Address;
  /** Highest tier the address has unlocked. */
  tier: number;
  /** USDG base units per tier; 0 when the tier is not offered. */
  prices: Record<number, bigint>;
  usdgBalance: bigint;
  ethBalance: bigint;
  /** USDG the vault may already take from the address. */
  allowance: bigint;
  /** True once the vault can swap USDG for PAYHOLE. Until then an unlock's USDG is held for a later burn. */
  routeSet: boolean;
}

export interface TierReadOptions {
  vault: Address;
  usdg: Address;
  address: Address;
  tiers?: readonly number[];
}

/** The slice of a viem public client this module needs, so tests can hand in a plain object. */
export interface TierPublicClient {
  readContract: (args: {
    address: Address;
    abi: readonly unknown[];
    functionName: string;
    args?: readonly unknown[];
    account?: Address;
  }) => Promise<unknown>;
  getBalance: (args: { address: Address }) => Promise<bigint>;
  waitForTransactionReceipt: (args: { hash: Hash }) => Promise<TransactionReceipt>;
}

/** The slice of a viem wallet client this module needs. */
export interface TierWalletClient {
  account: { address: Address };
  writeContract: (args: { address: Address; abi: readonly unknown[]; functionName: string; args: readonly unknown[] }) => Promise<Hash>;
}

export type TierErrorCode = "not_offered" | "already_unlocked" | "no_usdg" | "no_gas" | "reverted";

export class TierError extends Error {
  constructor(
    readonly code: TierErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "TierError";
  }
}

export async function readTierState(client: TierPublicClient, o: TierReadOptions): Promise<TierState> {
  const tiers = o.tiers ?? TIERS;
  const [tier, usdgBalance, ethBalance, allowance, routeKind] = await Promise.all([
    client.readContract({ address: o.vault, abi: burnVaultAbi, functionName: "tierOf", args: [o.address] }),
    client.readContract({ address: o.usdg, abi: erc20Abi, functionName: "balanceOf", args: [o.address] }),
    client.getBalance({ address: o.address }),
    client.readContract({ address: o.usdg, abi: erc20Abi, functionName: "allowance", args: [o.address, o.vault] }),
    client.readContract({ address: o.vault, abi: burnVaultAbi, functionName: "routeKind", args: [o.usdg] }),
  ]);
  const priceList = await Promise.all(
    tiers.map((t) => client.readContract({ address: o.vault, abi: burnVaultAbi, functionName: "tierPrice", args: [t] })),
  );
  const prices: Record<number, bigint> = {};
  tiers.forEach((t, i) => {
    prices[t] = BigInt(priceList[i] as bigint);
  });
  return {
    address: o.address,
    tier: Number(tier),
    prices,
    usdgBalance: BigInt(usdgBalance as bigint),
    ethBalance,
    allowance: BigInt(allowance as bigint),
    routeSet: Number(routeKind) !== 0,
  };
}

/** `expected` less the slippage allowance, in basis points. */
export function minTokensBurned(expected: bigint, slippageBps: number): bigint {
  if (!Number.isInteger(slippageBps) || slippageBps < 0 || slippageBps > 10_000) throw new RangeError("slippage must be 0 to 10000 basis points");
  return (expected * BigInt(10_000 - slippageBps)) / 10_000n;
}

export interface UnlockOptions {
  vault: Address;
  usdg: Address;
  tier: number;
  /** Tolerance on the PAYHOLE burned when a route exists; default 300 (3 percent). Ignored while held. */
  slippageBps?: number;
  /** Seconds the transaction stays valid; default 600. */
  deadlineSeconds?: number;
  log?: (line: string) => void;
  now?: () => number;
}

export interface UnlockResult {
  tier: number;
  price: bigint;
  approveHash: Hash | null;
  unlockHash: Hash;
  /** PAYHOLE sent to the burn address by this unlock; zero when the USDG was held for a later burn. */
  tokensBurned: bigint;
  held: boolean;
}

/**
 * Buys `tier` for the wallet: reads the price, approves the vault for exactly that amount when the
 * allowance is short, simulates the unlock to learn how much PAYHOLE it burns, and sends it with a
 * slippage floor. Before the pool exists the vault holds the USDG and the floor is zero.
 */
export async function unlockTier(publicClient: TierPublicClient, wallet: TierWalletClient, o: UnlockOptions): Promise<UnlockResult> {
  const log = o.log ?? (() => undefined);
  const address = wallet.account.address;
  const state = await readTierState(publicClient, { vault: o.vault, usdg: o.usdg, address, tiers: [o.tier] });
  const price = state.prices[o.tier] ?? 0n;
  if (price === 0n) throw new TierError("not_offered", `tier ${o.tier} is not offered by the vault`);
  if (o.tier <= state.tier) throw new TierError("already_unlocked", `${address} already holds tier ${state.tier}`);
  if (state.usdgBalance < price) {
    throw new TierError("no_usdg", `tier ${o.tier} costs ${formatUsdg6(price)} USDG and ${address} holds ${formatUsdg6(state.usdgBalance)} USDG`);
  }
  if (state.ethBalance === 0n) throw new TierError("no_gas", `${address} has no ETH on this chain to pay gas`);

  let approveHash: Hash | null = null;
  if (state.allowance < price) {
    log(`approving the vault for ${formatUsdg6(price)} USDG`);
    approveHash = await wallet.writeContract({ address: o.usdg, abi: erc20Abi, functionName: "approve", args: [o.vault, price] });
    const receipt = await publicClient.waitForTransactionReceipt({ hash: approveHash });
    if (receipt.status !== "success") throw new TierError("reverted", `the approval reverted in ${approveHash}`);
  }

  const deadline = BigInt(Math.floor((o.now ?? Date.now)() / 1000) + (o.deadlineSeconds ?? 600));
  let min = 0n;
  if (state.routeSet) {
    const expected = await publicClient.readContract({
      address: o.vault,
      abi: burnVaultAbi,
      functionName: "unlock",
      args: [o.tier, 0n, deadline],
      account: address,
    });
    min = minTokensBurned(BigInt(expected as bigint), o.slippageBps ?? 300);
    log(`the vault will burn about ${BigInt(expected as bigint)} PAYHOLE base units; floor ${min}`);
  } else {
    log("no swap route yet: the vault keeps the USDG until the pool exists, and the tier is granted now");
  }

  const unlockHash = await wallet.writeContract({ address: o.vault, abi: burnVaultAbi, functionName: "unlock", args: [o.tier, min, deadline] });
  const receipt = await publicClient.waitForTransactionReceipt({ hash: unlockHash });
  if (receipt.status !== "success") throw new TierError("reverted", `the unlock reverted in ${unlockHash}`);
  const tokensBurned = burnedFromReceipt(receipt.logs);
  return { tier: o.tier, price, approveHash, unlockHash, tokensBurned, held: tokensBurned === 0n };
}

/** PAYHOLE burned according to the vault's Unlocked event in `logs`, or zero when there is none. */
export function burnedFromReceipt(logs: readonly Log[]): bigint {
  const events = parseEventLogs({ abi: burnVaultAbi, eventName: "Unlocked", logs: logs as Log[] });
  const first = events[0];
  return first ? BigInt(first.args.tokensBurned) : 0n;
}

/** Builds the log the vault emits for an unlock, for tests and simulations. */
export function unlockedLog(vault: Address, user: Address, tier: number, usdgPaid: bigint, tokensBurned: bigint): Pick<Log, "address" | "topics" | "data"> {
  return {
    address: vault,
    topics: encodeEventTopics({ abi: burnVaultAbi, eventName: "Unlocked", args: { user } }) as [Hex, ...Hex[]],
    data: encodeAbiParameters([{ type: "uint8" }, { type: "uint256" }, { type: "uint256" }], [tier, usdgPaid, tokensBurned]),
  };
}

function formatUsdg6(value: bigint): string {
  const whole = value / 1_000_000n;
  const frac = (value % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "");
  return frac.length > 0 ? `${whole}.${frac}` : whole.toString();
}
