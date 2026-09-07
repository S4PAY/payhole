import { createPublicClient, erc20Abi, http, type Address } from "viem";
import { burnVaultAbi, customChain, robinhoodChain } from "@payhole/sdk";
import type { Confirmation } from "./blocklist.js";
import type { Category } from "./category.js";
import type { Hint } from "./hints.js";
import { tokensFor, type PriceQuote } from "./price.js";
import { readJson, writeJsonAtomic } from "./store.js";
import type { TierReader } from "./swarm/membership.js";

/**
 * The bounty ledger. A report earns when the name was unknown to the network at the time, the reporter
 * was first, and the network later agreed: two tier holders other than the reporter confirmed it, or a
 * public list caught up within two weeks. Amounts are USDG, paid by the owner on request once a wallet is
 * owed the minimum and holds the token or a tier. Nothing here moves money; it is the record money moves by.
 */

export const BOUNTY_USDG: Record<Category, number> = { infra: 0.5, drainer: 0.5, phishing: 0.3, counterfeit: 0.3, tracker: 0, ad: 0, other: 0 };
export const DAILY_CAP = 10;
export const MIN_PAYOUT_USDG = 10;
export const CORROBORATION_DAYS = 14;
/** Confirmers other than the reporter needed when no public list corroborates. */
export const OTHER_CONFIRMERS = 2;

export type RewardStatus = "payable" | "pending" | "capped" | "paid" | "void";

export interface RewardEntry {
  domain: string;
  category: Category;
  amount: number;
  /** The wallet the bounty goes to: the tier holder for a flag, the rewards wallet for a hint. */
  wallet: string | null;
  /** The phone's reporter key for a hint; null for a flag from a node. */
  key: string | null;
  source: "flag" | "hint";
  reportedAt: number;
  confirmedAt: number | null;
  corroboration: string | null;
  status: RewardStatus;
  paidTx: string | null;
}

export interface Claim {
  wallet: string;
  requestedAt: number;
  amount: number;
  paidAt: number | null;
  tx: string | null;
}

interface RewardsFile {
  version: 1;
  paid: { domain: string; wallet: string; tx: string; at: number }[];
  claims: Claim[];
  /** Hints reassigned to a wallet after the fact, keyed by reporter key. */
  walletsByKey: Record<string, string>;
}

export interface ListArrival {
  at: number;
  label: string;
}

export interface RewardsSource {
  confirmations: (since: number) => Confirmation[];
  hints: () => Hint[];
  /** When a public list first brought a name in, if it did. */
  listArrival: (domain: string) => ListArrival | null;
  isBlocked: (domain: string) => boolean;
  isAllowlisted: (domain: string) => boolean;
}

export interface RewardsOptions {
  path?: string | undefined;
  clock?: (() => number) | undefined;
  log?: ((line: string) => void) | undefined;
}

const DAY = 24 * 60 * 60 * 1000;

function dayOf(at: number): string {
  return new Date(at).toISOString().slice(0, 10);
}

export class Rewards {
  private paid = new Map<string, { wallet: string; tx: string; at: number }>();
  private claims: Claim[] = [];
  private walletsByKey = new Map<string, string>();
  private readonly clock: () => number;
  private readonly path: string | undefined;

  constructor(
    private readonly source: RewardsSource,
    options: RewardsOptions = {},
    state?: RewardsFile | null,
  ) {
    this.clock = options.clock ?? Date.now;
    this.path = options.path;
    if (state?.version === 1) {
      for (const entry of state.paid ?? []) this.paid.set(entry.domain, { wallet: entry.wallet, tx: entry.tx, at: entry.at });
      this.claims = (state.claims ?? []).map((claim) => ({ ...claim }));
      for (const [key, wallet] of Object.entries(state.walletsByKey ?? {})) this.walletsByKey.set(key.toLowerCase(), wallet);
    }
  }

  static async load(source: RewardsSource, options: RewardsOptions & { path: string }): Promise<Rewards> {
    return new Rewards(source, options, await readJson<RewardsFile>(options.path));
  }

  /** Every reward-bearing report the node knows about, newest first, with its status. */
  entries(now = this.clock()): RewardEntry[] {
    const out = new Map<string, RewardEntry>();
    const since = now - 365 * DAY;
    for (const confirmation of this.source.confirmations(since)) {
      if (!confirmation.firstReporter || BOUNTY_USDG[confirmation.category] === 0) continue;
      const others = confirmation.reporterSet.filter((address) => address !== confirmation.firstReporter).length;
      const arrival = this.source.listArrival(confirmation.domain);
      const corroborated = others >= OTHER_CONFIRMERS || (arrival !== null && arrival.at >= confirmation.at - CORROBORATION_DAYS * DAY);
      out.set(confirmation.domain, {
        domain: confirmation.domain,
        category: confirmation.category,
        amount: BOUNTY_USDG[confirmation.category],
        wallet: confirmation.firstReporter,
        key: null,
        source: "flag",
        reportedAt: confirmation.at,
        confirmedAt: confirmation.at,
        corroboration: others >= OTHER_CONFIRMERS ? `swarm:${others + 1}` : arrival ? `list:${arrival.label}` : null,
        status: corroborated ? "payable" : now - confirmation.at > CORROBORATION_DAYS * DAY ? "void" : "pending",
        paidTx: null,
      });
    }
    for (const hint of this.source.hints()) {
      if (!hint.firstBy || out.has(hint.domain)) continue;
      const category = leadingCategory(hint);
      if (!category || BOUNTY_USDG[category] === 0) continue;
      const arrival = this.source.listArrival(hint.domain);
      const confirmation = this.source.confirmations(hint.firstBy.at).find((entry) => entry.domain === hint.domain);
      const confirmedAt = confirmation?.at ?? (arrival && arrival.at > hint.firstBy.at ? arrival.at : null);
      const window = confirmedAt !== null && confirmedAt - hint.firstBy.at <= CORROBORATION_DAYS * DAY;
      const wallet = hint.firstBy.payTo ?? this.walletsByKey.get(hint.firstBy.key.toLowerCase()) ?? null;
      out.set(hint.domain, {
        domain: hint.domain,
        category: confirmation?.category ?? category,
        amount: BOUNTY_USDG[confirmation?.category ?? category],
        wallet,
        key: hint.firstBy.key,
        source: "hint",
        reportedAt: hint.firstBy.at,
        confirmedAt,
        corroboration: confirmation ? `swarm:${confirmation.reporters}` : arrival && arrival.at > hint.firstBy.at ? `list:${arrival.label}` : null,
        status: confirmedAt !== null && window ? "payable" : now - hint.firstBy.at > CORROBORATION_DAYS * DAY ? "void" : "pending",
        paidTx: null,
      });
    }
    const entries = [...out.values()];
    for (const entry of entries) {
      if (this.source.isAllowlisted(entry.domain)) entry.status = "void";
      const payment = this.paid.get(entry.domain);
      if (payment) {
        entry.status = "paid";
        entry.paidTx = payment.tx;
      }
    }
    // Ten paid reports per wallet per day; the rest wait as capped and never pay.
    const perDay = new Map<string, number>();
    for (const entry of entries.sort((a, b) => a.reportedAt - b.reportedAt)) {
      if (entry.status !== "payable" || !entry.wallet) continue;
      const bucket = `${entry.wallet.toLowerCase()}:${dayOf(entry.reportedAt)}`;
      const count = (perDay.get(bucket) ?? 0) + 1;
      perDay.set(bucket, count);
      if (count > DAILY_CAP) entry.status = "capped";
    }
    return entries.sort((a, b) => b.reportedAt - a.reportedAt);
  }

  /** What a wallet is owed, and what it has been paid. */
  balance(wallet: string, now = this.clock()): { owed: number; paid: number; payable: RewardEntry[]; pending: number } {
    const mine = this.entries(now).filter((entry) => entry.wallet?.toLowerCase() === wallet.toLowerCase());
    const payable = mine.filter((entry) => entry.status === "payable");
    const owed = payable.reduce((sum, entry) => sum + entry.amount, 0);
    const paid = mine.filter((entry) => entry.status === "paid").reduce((sum, entry) => sum + entry.amount, 0);
    const pending = mine.filter((entry) => entry.status === "pending").length;
    return { owed: Math.round(owed * 100) / 100, paid: Math.round(paid * 100) / 100, payable, pending };
  }

  /** A payout request; refused below the minimum or while one is open. */
  async claim(wallet: string, now = this.clock()): Promise<{ ok: true; claim: Claim } | { ok: false; reason: "below_minimum" | "already_open"; owed: number }> {
    const { owed } = this.balance(wallet, now);
    const open = this.openClaim(wallet);
    if (open) return { ok: false, reason: "already_open", owed };
    if (owed < MIN_PAYOUT_USDG) return { ok: false, reason: "below_minimum", owed };
    const claim: Claim = { wallet, requestedAt: now, amount: owed, paidAt: null, tx: null };
    this.claims.push(claim);
    await this.persist();
    return { ok: true, claim };
  }

  openClaim(wallet: string): Claim | null {
    return this.claims.find((claim) => claim.wallet.toLowerCase() === wallet.toLowerCase() && claim.paidAt === null) ?? null;
  }

  allClaims(): Claim[] {
    return this.claims.map((claim) => ({ ...claim }));
  }

  /** The owner paid a wallet: every payable entry it holds is marked with the transaction and its claim closes. */
  async markPaid(wallet: string, tx: string, now = this.clock()): Promise<RewardEntry[]> {
    const paid = this.balance(wallet, now).payable;
    for (const entry of paid) this.paid.set(entry.domain, { wallet, tx, at: now });
    const open = this.openClaim(wallet);
    if (open) {
      open.paidAt = now;
      open.tx = tx;
    }
    await this.persist();
    return paid;
  }

  /** A phone that reported before it had a rewards wallet names one later. */
  async assignWallet(key: string, wallet: string): Promise<void> {
    this.walletsByKey.set(key.toLowerCase(), wallet);
    await this.persist();
  }

  toJSON(): RewardsFile {
    return {
      version: 1,
      paid: [...this.paid.entries()].map(([domain, entry]) => ({ domain, ...entry })),
      claims: this.claims,
      walletsByKey: Object.fromEntries(this.walletsByKey),
    };
  }

  private async persist(): Promise<void> {
    if (this.path) await writeJsonAtomic(this.path, this.toJSON());
  }
}

function leadingCategory(hint: Hint): Category | null {
  let best: Category | null = null;
  let bestCount = 0;
  for (const [key, count] of Object.entries(hint.categories)) {
    if (typeof count === "number" && count > bestCount) {
      best = key as Category;
      bestCount = count;
    }
  }
  return best;
}

export interface HoldingCheckOptions {
  rpcUrl: string;
  chainId: number;
  vault: Address;
  /** Dollars of the token a wallet must hold to be paid, priced at check time. */
  minHoldUsd: number;
  price: () => Promise<PriceQuote>;
  tierOf: TierReader;
}

export interface Eligibility {
  ok: boolean;
  tier: number;
  tokens: number;
  required: number;
  requiredUsd: number;
  priceUsd: number | null;
  priceSource: string | null;
  detail: string;
}

/**
 * Whether a wallet may be paid: it holds a tier, or at least `minHoldUsd` dollars of the token at the
 * current price. When the price cannot be read and no tier is held, nobody is paid until it can.
 */
export function createHoldingCheck(options: HoldingCheckOptions): (wallet: Address) => Promise<Eligibility> {
  const chain = options.chainId === robinhoodChain.id ? robinhoodChain : customChain(options.chainId, options.rpcUrl);
  const client = createPublicClient({ chain, transport: http(options.rpcUrl) });
  let token: Promise<Address> | null = null;
  return async (wallet) => {
    const tier = await options.tierOf(wallet);
    if (tier > 0) return { ok: true, tier, tokens: 0, required: 0, requiredUsd: options.minHoldUsd, priceUsd: null, priceSource: null, detail: `holds tier ${tier}` };
    if (options.minHoldUsd <= 0) return { ok: true, tier, tokens: 0, required: 0, requiredUsd: 0, priceUsd: null, priceSource: null, detail: "no holding required" };
    let quote: PriceQuote;
    try {
      quote = await options.price();
    } catch (error) {
      return { ok: false, tier, tokens: 0, required: 0, requiredUsd: options.minHoldUsd, priceUsd: null, priceSource: null, detail: error instanceof Error ? error.message : String(error) };
    }
    token ??= client.readContract({ address: options.vault, abi: burnVaultAbi, functionName: "token" });
    const [balance, decimals] = await Promise.all([
      client.readContract({ address: await token, abi: erc20Abi, functionName: "balanceOf", args: [wallet] }),
      client.readContract({ address: await token, abi: erc20Abi, functionName: "decimals" }),
    ]);
    const tokens = Number(balance / 10n ** BigInt(decimals));
    const required = tokensFor(options.minHoldUsd, quote);
    return {
      ok: tokens >= required,
      tier,
      tokens,
      required,
      requiredUsd: options.minHoldUsd,
      priceUsd: quote.usd,
      priceSource: quote.source,
      detail: `${options.minHoldUsd} USD of PAYHOLE is ${required.toLocaleString("en-US")} tokens at ${quote.detail}`,
    };
  };
}
