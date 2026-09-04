import {
  BaseError,
  ContractFunctionRevertedError,
  erc20Abi,
  maxUint256,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import { budgetAccountAbi, budgetAccountFactoryAbi, readSessionKey, type SessionKeyState } from "@payhole/sdk";
import type { OwnerWallet } from "./chain";

export type BudgetErrorCode = "no-gas" | "no-usdg" | "site-cap" | "reverted" | "not-configured";

export class BudgetError extends Error {
  override name = "BudgetError";
  constructor(
    readonly code: BudgetErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export const ZERO_SALT: Hex = `0x${"0".repeat(64)}`;

export interface BudgetContext {
  publicClient: PublicClient;
  usdg: Address;
  budgetAccount: Address;
}

export interface OwnerContext extends BudgetContext {
  walletClient: OwnerWallet;
}

export interface AccountState {
  owner: Address;
  ownerEth: bigint;
  ownerUsdg: bigint;
  accountUsdg: bigint;
  globalCap: bigint;
  globalSpent: bigint;
  epoch: number;
}

export interface SiteState {
  cap: bigint;
  funded: bigint;
  remaining: bigint;
  balance: bigint;
}

/** Turns viem's revert and gas errors into BudgetError with a readable message. */
export function toBudgetError(error: unknown, fallback: BudgetErrorCode = "reverted"): BudgetError {
  if (error instanceof BudgetError) return error;
  if (error instanceof BaseError) {
    const reverted = error.walk((e) => e instanceof ContractFunctionRevertedError);
    if (reverted instanceof ContractFunctionRevertedError) {
      const name = reverted.data?.errorName ?? "revert";
      if (name === "SiteCapExceeded") return new BudgetError("site-cap", "the on-chain site cap is exhausted");
      return new BudgetError("reverted", `BudgetAccount reverted: ${name}`);
    }
    if (/insufficient funds/i.test(error.shortMessage)) return new BudgetError("no-gas", "the owner account needs ETH for gas");
    return new BudgetError(fallback, error.shortMessage);
  }
  return new BudgetError(fallback, error instanceof Error ? error.message : String(error));
}

async function confirm(client: PublicClient, hash: Hex): Promise<Hex> {
  const receipt = await client.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new BudgetError("reverted", `transaction ${hash} reverted`);
  return hash;
}

async function requireGas(ctx: Pick<OwnerContext, "publicClient" | "walletClient">): Promise<void> {
  const balance = await ctx.publicClient.getBalance({ address: ctx.walletClient.account.address });
  if (balance === 0n) throw new BudgetError("no-gas", "the owner account has no ETH for gas; send a little ETH to it first");
}

export function usdgBalance(client: PublicClient, usdg: Address, who: Address): Promise<bigint> {
  return client.readContract({ address: usdg, abi: erc20Abi, functionName: "balanceOf", args: [who] });
}

export function predictAccount(client: PublicClient, factory: Address, owner: Address, salt: Hex = ZERO_SALT): Promise<Address> {
  return client.readContract({ address: factory, abi: budgetAccountFactoryAbi, functionName: "predictAccount", args: [owner, salt] });
}

export function isAccount(client: PublicClient, factory: Address, account: Address): Promise<boolean> {
  return client.readContract({ address: factory, abi: budgetAccountFactoryAbi, functionName: "isAccount", args: [account] });
}

/** `createAccount(0)` from the owner; returns the address whether it was just created or already existed. */
export async function createAccount(
  ctx: Pick<OwnerContext, "publicClient" | "walletClient">,
  factory: Address,
): Promise<{ account: Address; txHash?: Hex }> {
  const owner = ctx.walletClient.account.address;
  const account = await predictAccount(ctx.publicClient, factory, owner);
  if (await isAccount(ctx.publicClient, factory, account)) return { account };
  await requireGas(ctx);
  try {
    const { request } = await ctx.publicClient.simulateContract({
      account: ctx.walletClient.account,
      address: factory,
      abi: budgetAccountFactoryAbi,
      functionName: "createAccount",
      args: [ZERO_SALT],
    });
    const txHash = await confirm(ctx.publicClient, await ctx.walletClient.writeContract(request));
    return { account, txHash };
  } catch (error) {
    throw toBudgetError(error);
  }
}

export async function readAccountState(ctx: BudgetContext, owner: Address): Promise<AccountState> {
  const { publicClient, usdg, budgetAccount } = ctx;
  const [ownerEth, ownerUsdg, accountUsdg, globalCap, globalSpent, epoch] = await Promise.all([
    publicClient.getBalance({ address: owner }),
    usdgBalance(publicClient, usdg, owner),
    usdgBalance(publicClient, usdg, budgetAccount),
    publicClient.readContract({ address: budgetAccount, abi: budgetAccountAbi, functionName: "globalCap" }),
    publicClient.readContract({ address: budgetAccount, abi: budgetAccountAbi, functionName: "globalSpent" }),
    publicClient.readContract({ address: budgetAccount, abi: budgetAccountAbi, functionName: "epoch" }),
  ]);
  return { owner, ownerEth, ownerUsdg, accountUsdg, globalCap, globalSpent, epoch };
}

export async function readSite(ctx: BudgetContext, site: Address): Promise<SiteState> {
  const [info, remaining, balance] = await Promise.all([
    ctx.publicClient.readContract({ address: ctx.budgetAccount, abi: budgetAccountAbi, functionName: "siteInfo", args: [site] }),
    ctx.publicClient.readContract({ address: ctx.budgetAccount, abi: budgetAccountAbi, functionName: "siteRemaining", args: [site] }),
    usdgBalance(ctx.publicClient, ctx.usdg, site),
  ]);
  return { cap: info.cap, funded: info.funded, remaining, balance };
}

export function readKey(ctx: BudgetContext, key: Address): Promise<SessionKeyState> {
  return readSessionKey(ctx.publicClient, ctx.budgetAccount, key);
}

type OwnerFunction = "withdraw" | "setGlobalCap" | "setSiteCap" | "fund" | "setSessionKey" | "revokeSessionKey" | "revokeAll" | "deposit";

async function ownerWrite(ctx: OwnerContext, functionName: OwnerFunction, args: readonly unknown[]): Promise<Hex> {
  await requireGas(ctx);
  try {
    const { request } = await ctx.publicClient.simulateContract({
      account: ctx.walletClient.account,
      address: ctx.budgetAccount,
      abi: budgetAccountAbi,
      functionName,
      args: args as never,
    } as never);
    return await confirm(ctx.publicClient, await ctx.walletClient.writeContract(request as never));
  } catch (error) {
    throw toBudgetError(error);
  }
}

/** Approves the account when the allowance is short, then `deposit(amount)` from the owner's USDG. */
export async function deposit(ctx: OwnerContext, amount: bigint): Promise<Hex[]> {
  if (amount <= 0n) throw new BudgetError("reverted", "amount must be positive");
  const owner = ctx.walletClient.account.address;
  const balance = await usdgBalance(ctx.publicClient, ctx.usdg, owner);
  if (balance < amount) throw new BudgetError("no-usdg", `the owner holds ${balance.toString()} USDG base units, needs ${amount.toString()}`);
  const hashes: Hex[] = [];
  const allowance = await ctx.publicClient.readContract({
    address: ctx.usdg,
    abi: erc20Abi,
    functionName: "allowance",
    args: [owner, ctx.budgetAccount],
  });
  if (allowance < amount) {
    await requireGas(ctx);
    try {
      const hash = await ctx.walletClient.writeContract({ address: ctx.usdg, abi: erc20Abi, functionName: "approve", args: [ctx.budgetAccount, maxUint256] });
      hashes.push(await confirm(ctx.publicClient, hash));
    } catch (error) {
      throw toBudgetError(error);
    }
  }
  hashes.push(await ownerWrite(ctx, "deposit", [amount]));
  return hashes;
}

export function withdraw(ctx: OwnerContext, to: Address, amount: bigint): Promise<Hex> {
  return ownerWrite(ctx, "withdraw", [to, amount]);
}

export function setGlobalCap(ctx: OwnerContext, cap: bigint): Promise<Hex> {
  return ownerWrite(ctx, "setGlobalCap", [cap]);
}

export function setSiteCap(ctx: OwnerContext, site: Address, cap: bigint): Promise<Hex> {
  return ownerWrite(ctx, "setSiteCap", [site, cap]);
}

export function fund(ctx: OwnerContext, site: Address, amount: bigint): Promise<Hex> {
  return ownerWrite(ctx, "fund", [site, amount]);
}

export function setSessionKey(ctx: OwnerContext, key: Address, cap: bigint, expiry: bigint): Promise<Hex> {
  return ownerWrite(ctx, "setSessionKey", [key, cap, expiry]);
}

export function revokeSessionKey(ctx: OwnerContext, key: Address): Promise<Hex> {
  return ownerWrite(ctx, "revokeSessionKey", [key]);
}

export function revokeAll(ctx: OwnerContext): Promise<Hex> {
  return ownerWrite(ctx, "revokeAll", []);
}

export interface FundingResult {
  /** USDG the site holds after the call. */
  balance: bigint;
  /** USDG pushed by this call, zero when the balance already covered the amount. */
  funded: bigint;
  txHashes: Hex[];
}

export interface SiteFunder {
  ensure(site: Address, amount: bigint, configuredCap: bigint): Promise<FundingResult>;
}

/**
 * Keeps a per-site address funded for a payment: raises the on-chain site cap to the configured cap when it is
 * lower, then pushes max(deficit, top-up chunk) bounded by the on-chain remaining. Fails with a BudgetError that
 * names the missing piece (gas, USDG in the account, an exhausted site cap).
 */
export function createSiteFunder(ctx: OwnerContext, options: { topUpChunk: bigint }): SiteFunder {
  return {
    async ensure(site, amount, configuredCap) {
      const txHashes: Hex[] = [];
      const balance = await usdgBalance(ctx.publicClient, ctx.usdg, site);
      if (balance >= amount) return { balance, funded: 0n, txHashes };
      const deficit = amount - balance;
      let site_ = await readSite(ctx, site);
      if (site_.cap < configuredCap) {
        txHashes.push(await setSiteCap(ctx, site, configuredCap));
        site_ = await readSite(ctx, site);
      }
      if (site_.remaining < deficit) {
        throw new BudgetError(
          "site-cap",
          `the site can still receive ${site_.remaining.toString()} USDG base units, the payment needs ${deficit.toString()} more; raise the site cap`,
        );
      }
      const chunk = options.topUpChunk > deficit ? options.topUpChunk : deficit;
      let topUp = chunk > site_.remaining ? site_.remaining : chunk;
      const accountUsdg = await usdgBalance(ctx.publicClient, ctx.usdg, ctx.budgetAccount);
      if (accountUsdg < deficit) {
        throw new BudgetError(
          "no-usdg",
          `the BudgetAccount holds ${accountUsdg.toString()} USDG base units, the payment needs ${deficit.toString()}; top it up`,
        );
      }
      if (accountUsdg < topUp) topUp = accountUsdg;
      txHashes.push(await fund(ctx, site, topUp));
      return { balance: balance + topUp, funded: topUp, txHashes };
    },
  };
}
