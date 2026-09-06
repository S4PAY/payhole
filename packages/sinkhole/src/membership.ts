import { createPublicClient, createWalletClient, http, type Address } from "viem";
import type { PrivateKeyAccount } from "viem/accounts";
import { customChain, readTierState, robinhoodChain, TIERS, unlockTier, USDG_ADDRESS, type UnlockResult } from "@payhole/sdk";

/** What the admin API reports about the operator wallet's standing in the BurnVault. */
export interface MembershipView {
  address: Address;
  tier: number;
  /** USDG base units per tier, as decimal strings; "0" when the tier is not offered. */
  prices: Record<string, string>;
  usdgBalance: string;
  ethBalance: string;
  allowance: string;
  routeSet: boolean;
  /** True when the operator key is on this node, so the dashboard may unlock from here. */
  canUnlock: boolean;
}

export interface UnlockView {
  tier: number;
  price: string;
  approveHash: string | null;
  unlockHash: string;
  tokensBurned: string;
  held: boolean;
}

export interface MembershipOptions {
  rpcUrl: string;
  chainId: number;
  vault: Address | undefined;
  usdg?: Address;
  /** The operator key when it lives on this node; null for proof-only nodes. */
  account: PrivateKeyAccount | null;
  /** The operator address, from the key or the proof; null when no identity is configured. */
  address: Address | null;
  log?: (line: string) => void;
}

export type MembershipErrorCode = "no_key" | "busy";

export class MembershipError extends Error {
  constructor(
    readonly code: MembershipErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "MembershipError";
  }
}

export interface Membership {
  /** Null when the node has no vault or no operator address to look at. */
  read(): Promise<MembershipView | null>;
  /** Buys `tier` with the operator key. One unlock runs at a time. */
  unlock(tier: number): Promise<UnlockView>;
}

export function createMembership(o: MembershipOptions): Membership {
  const usdg = o.usdg ?? USDG_ADDRESS;
  const chain = o.chainId === robinhoodChain.id ? robinhoodChain : customChain(o.chainId, o.rpcUrl);
  const publicClient = createPublicClient({ chain, transport: http(o.rpcUrl) });
  const log = o.log ?? (() => undefined);
  let inFlight: Promise<UnlockView> | null = null;

  return {
    async read() {
      const vault = o.vault;
      const address = o.address;
      if (!vault || !address) return null;
      const state = await readTierState(publicClient, { vault, usdg, address });
      const prices: Record<string, string> = {};
      for (const tier of TIERS) prices[String(tier)] = (state.prices[tier] ?? 0n).toString();
      return {
        address,
        tier: state.tier,
        prices,
        usdgBalance: state.usdgBalance.toString(),
        ethBalance: state.ethBalance.toString(),
        allowance: state.allowance.toString(),
        routeSet: state.routeSet,
        canUnlock: o.account !== null,
      };
    },
    unlock(tier) {
      const vault = o.vault;
      if (!vault) throw new MembershipError("no_key", "BURN_VAULT_ADDRESS is not configured on this node");
      const account = o.account;
      if (!account) throw new MembershipError("no_key", "the operator key is not on this node (NODE_OPERATOR_KEY); unlock from the CLI instead");
      if (inFlight) throw new MembershipError("busy", "an unlock is already running");
      const wallet = createWalletClient({ account, chain, transport: http(o.rpcUrl) });
      const run = unlockTier(publicClient, wallet, { vault, usdg, tier, log })
        .then((result: UnlockResult): UnlockView => {
          log(`unlocked tier ${result.tier} for ${account.address} in ${result.unlockHash}${result.held ? " (USDG held until the pool exists)" : ""}`);
          return {
            tier: result.tier,
            price: result.price.toString(),
            approveHash: result.approveHash,
            unlockHash: result.unlockHash,
            tokensBurned: result.tokensBurned.toString(),
            held: result.held,
          };
        })
        .finally(() => {
          inFlight = null;
        });
      inFlight = run;
      return run;
    },
  };
}
