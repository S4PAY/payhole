import { erc20Abi, maxUint256, type Address, type Hex } from "viem";
import { creatorRegistryAbi, domainHash, normalizeHostname } from "@payhole/sdk";
import { toBudgetError, usdgBalance, withdraw, type OwnerContext } from "./budget";
import type { Ledger, LedgerEntry } from "./ledger";
import type { KeyValueStore } from "./storage";
import { ZERO_ADDRESS } from "./tiers";

export const TIPS_LAST_KEY = "tipsLastTipped";
export const REGISTRY_CACHE_TTL_MS = 60 * 60 * 1000;

export interface TipPolicy {
  enabled: boolean;
  amount: bigint;
  intervalMs: number;
}

export type TipResult =
  | { kind: "tipped"; hostname: string; wallet: Address; txHash: Hex; amount: bigint }
  | { kind: "skipped"; hostname: string; reason: "disabled" | "unregistered" | "recent" | "in-progress" | "zero-amount" | "invalid-host" }
  | { kind: "failed"; hostname: string; error: string };

export interface TipDeps {
  /** Wallet registered for the hostname, zero when unclaimed. */
  lookup(hostname: string): Promise<Address>;
  /** Moves the tip and returns the transaction hash. */
  send(hostname: string, hash: Hex, amount: bigint, wallet: Address): Promise<Hex>;
  ledger: Ledger;
  store: KeyValueStore;
  policy(): Promise<TipPolicy> | TipPolicy;
  now?: () => number;
  cacheTtlMs?: number;
}

/** True when the domain was never tipped or the interval has passed. */
export function shouldTip(lastTippedAt: number | undefined, intervalMs: number, now: number): boolean {
  if (lastTippedAt === undefined) return true;
  return now - lastTippedAt >= intervalMs;
}

/**
 * Tips registered creators once per domain per interval on top-level navigations. Registry lookups are cached for
 * an hour; the last tip time per domain is persisted so restarts do not double-tip.
 */
export class TipScheduler {
  private readonly cache = new Map<string, { wallet: Address; at: number }>();
  private lastTipped: Record<string, number> = {};
  private readonly inProgress = new Set<string>();
  private readonly now: () => number;
  private readonly cacheTtlMs: number;

  constructor(private readonly deps: TipDeps) {
    this.now = deps.now ?? (() => Date.now());
    this.cacheTtlMs = deps.cacheTtlMs ?? REGISTRY_CACHE_TTL_MS;
  }

  async load(): Promise<void> {
    this.lastTipped = (await this.deps.store.get<Record<string, number>>(TIPS_LAST_KEY)) ?? {};
  }

  async walletFor(hostname: string): Promise<Address> {
    const cached = this.cache.get(hostname);
    if (cached && this.now() - cached.at < this.cacheTtlMs) return cached.wallet;
    const wallet = await this.deps.lookup(hostname);
    this.cache.set(hostname, { wallet, at: this.now() });
    return wallet;
  }

  lastTipAt(hostname: string): number | undefined {
    return this.lastTipped[hostname];
  }

  async onNavigation(url: string): Promise<TipResult> {
    let hostname: string;
    try {
      hostname = normalizeHostname(url);
    } catch {
      return { kind: "skipped", hostname: url, reason: "invalid-host" };
    }
    const policy = await this.deps.policy();
    if (!policy.enabled) return { kind: "skipped", hostname, reason: "disabled" };
    if (policy.amount <= 0n) return { kind: "skipped", hostname, reason: "zero-amount" };
    if (!shouldTip(this.lastTipped[hostname], policy.intervalMs, this.now())) return { kind: "skipped", hostname, reason: "recent" };
    if (this.inProgress.has(hostname)) return { kind: "skipped", hostname, reason: "in-progress" };
    this.inProgress.add(hostname);
    try {
      const wallet = await this.walletFor(hostname);
      if (wallet === ZERO_ADDRESS) return { kind: "skipped", hostname, reason: "unregistered" };
      const hash = domainHash(hostname);
      const txHash = await this.deps.send(hostname, hash, policy.amount, wallet);
      this.lastTipped[hostname] = this.now();
      await this.deps.store.set(TIPS_LAST_KEY, this.lastTipped);
      await this.deps.ledger.record({
        origin: `https://${hostname}`,
        url,
        amount: policy.amount.toString(),
        payTo: wallet,
        txHash,
        status: "tip",
      });
      return { kind: "tipped", hostname, wallet, txHash, amount: policy.amount };
    } catch (error) {
      return { kind: "failed", hostname, error: error instanceof Error ? error.message : String(error) };
    } finally {
      this.inProgress.delete(hostname);
    }
  }

  history(limit = 50): LedgerEntry[] {
    return this.deps.ledger.recent(limit, (e) => e.status === "tip");
  }
}

export interface TipSenderOptions {
  registry: Address;
  /** USDG withdrawn from the BudgetAccount to the owner when the owner cannot cover a tip. */
  float: bigint;
}

/**
 * The owner pays tips from its own USDG: withdraws a float from the BudgetAccount when short, approves the registry
 * once, then calls `tip(domainHash, amount)`.
 */
export function createTipSender(ctx: OwnerContext, options: TipSenderOptions): TipDeps["send"] {
  return async (_hostname, hash, amount, _wallet) => {
    const owner = ctx.walletClient.account.address;
    const balance = await usdgBalance(ctx.publicClient, ctx.usdg, owner);
    if (balance < amount) {
      const pull = options.float > amount ? options.float : amount;
      await withdraw(ctx, owner, pull);
    }
    const allowance = await ctx.publicClient.readContract({
      address: ctx.usdg,
      abi: erc20Abi,
      functionName: "allowance",
      args: [owner, options.registry],
    });
    try {
      if (allowance < amount) {
        const approve = await ctx.walletClient.writeContract({
          address: ctx.usdg,
          abi: erc20Abi,
          functionName: "approve",
          args: [options.registry, maxUint256],
        });
        await ctx.publicClient.waitForTransactionReceipt({ hash: approve });
      }
      const { request } = await ctx.publicClient.simulateContract({
        account: ctx.walletClient.account,
        address: options.registry,
        abi: creatorRegistryAbi,
        functionName: "tip",
        args: [hash, amount],
      });
      const txHash = await ctx.walletClient.writeContract(request);
      const receipt = await ctx.publicClient.waitForTransactionReceipt({ hash: txHash });
      if (receipt.status !== "success") throw new Error("tip reverted");
      return txHash;
    } catch (error) {
      throw toBudgetError(error);
    }
  };
}
