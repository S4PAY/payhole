import { erc20Abi, maxUint256, type Address, type Hex, type PublicClient } from "viem";
import { burnVaultAbi, chainConfig } from "@payhole/sdk";
import { deposit, toBudgetError, usdgBalance, BudgetError, type OwnerContext } from "./budget";
import { ZERO_ADDRESS } from "./tiers";

/** Uniswap V4 Quoter, single-hop exact input. */
export const v4QuoterAbi = [
  {
    type: "function",
    name: "quoteExactInputSingle",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "params",
        type: "tuple",
        components: [
          {
            name: "poolKey",
            type: "tuple",
            components: [
              { name: "currency0", type: "address" },
              { name: "currency1", type: "address" },
              { name: "fee", type: "uint24" },
              { name: "tickSpacing", type: "int24" },
              { name: "hooks", type: "address" },
            ],
          },
          { name: "zeroForOne", type: "bool" },
          { name: "exactAmount", type: "uint128" },
          { name: "hookData", type: "bytes" },
        ],
      },
    ],
    outputs: [
      { name: "amountOut", type: "uint256" },
      { name: "gasEstimate", type: "uint256" },
    ],
  },
] as const;

/** Uniswap V3 QuoterV2, multi-hop exact input along a packed path. */
export const quoterV2Abi = [
  {
    type: "function",
    name: "quoteExactInput",
    stateMutability: "nonpayable",
    inputs: [
      { name: "path", type: "bytes" },
      { name: "amountIn", type: "uint256" },
    ],
    outputs: [
      { name: "amountOut", type: "uint256" },
      { name: "sqrtPriceX96AfterList", type: "uint160[]" },
      { name: "initializedTicksCrossedList", type: "uint32[]" },
      { name: "gasEstimate", type: "uint256" },
    ],
  },
] as const;

export const ROUTE_KIND_V4 = 1;
export const ROUTE_KIND_V3 = 2;
export const QUOTER_V2: Address = chainConfig.uniswapV3.quoterV2;

export const QUOTE_TOLERANCE_BPS = 200n;
export const BURN_DEADLINE_SECONDS = 300;

/** Fee in base units for a top-up; `feePercent` may carry two decimals. */
export function feeFor(amount: bigint, feePercent: number): bigint {
  const bps = BigInt(Math.max(0, Math.round(feePercent * 100)));
  return (amount * bps) / 10_000n;
}

export type BurnQuote = { ok: true; minAmountOut: bigint; amountOut: bigint } | { ok: false; reason: string };

function withTolerance(amountOut: bigint): BurnQuote {
  if (amountOut === 0n) return { ok: false, reason: "the quoter returned zero output" };
  return { ok: true, amountOut, minAmountOut: (amountOut * (10_000n - QUOTE_TOLERANCE_BPS)) / 10_000n };
}

function shortMessage(error: unknown): string {
  return error instanceof Error ? error.message.split("\n")[0] ?? error.message : String(error);
}

/**
 * Quotes the vault's USDG route: a single V4 hop through the V4 Quoter, or a V3 packed path through QuoterV2.
 * Anything else (no token, no route, a two-hop V4 route) is a skip, never a burn without a minimum.
 */
export async function quoteBurn(client: PublicClient, vault: Address, quoter: Address, usdg: Address, amountIn: bigint): Promise<BurnQuote> {
  const token = await client.readContract({ address: vault, abi: burnVaultAbi, functionName: "token" });
  if (token === ZERO_ADDRESS) return { ok: false, reason: "the $PayHole token is not set on the vault" };
  let kind: number;
  try {
    kind = await client.readContract({ address: vault, abi: burnVaultAbi, functionName: "routeKind", args: [usdg] });
  } catch (error) {
    return { ok: false, reason: `route lookup failed: ${shortMessage(error)}` };
  }
  if (kind === ROUTE_KIND_V3) {
    const path = await client.readContract({ address: vault, abi: burnVaultAbi, functionName: "routeV3", args: [usdg] });
    if (path === "0x") return { ok: false, reason: "the vault has no USDG route" };
    try {
      const { result } = await client.simulateContract({ address: QUOTER_V2, abi: quoterV2Abi, functionName: "quoteExactInput", args: [path, amountIn] });
      return withTolerance(result[0]);
    } catch (error) {
      return { ok: false, reason: `quote failed: ${shortMessage(error)}` };
    }
  }
  if (kind !== ROUTE_KIND_V4) return { ok: false, reason: "the vault has no USDG route" };
  const route = await client.readContract({ address: vault, abi: burnVaultAbi, functionName: "route", args: [usdg] });
  if (route.length === 0) return { ok: false, reason: "the vault has no USDG route" };
  if (route.length !== 1) return { ok: false, reason: "the vault's USDG route has two hops; only single-hop quotes are supported" };
  const hop = route[0]!;
  const zeroForOne = hop.currency0.toLowerCase() === usdg.toLowerCase();
  if (!zeroForOne && hop.currency1.toLowerCase() !== usdg.toLowerCase()) return { ok: false, reason: "the route does not start at USDG" };
  try {
    const { result } = await client.simulateContract({
      address: quoter,
      abi: v4QuoterAbi,
      functionName: "quoteExactInputSingle",
      args: [{ poolKey: hop, zeroForOne, exactAmount: amountIn, hookData: "0x" }],
    });
    return withTolerance(result[0]);
  } catch (error) {
    return { ok: false, reason: `quote failed: ${shortMessage(error)}` };
  }
}

export interface TopUpParams extends OwnerContext {
  burnVault: string;
  quoter: Address;
  amount: bigint;
  feePercent: number;
  now?: () => number;
}

export interface TopUpResult {
  deposited: bigint;
  fee: bigint;
  feeSkipped?: string;
  txHashes: Hex[];
}

/**
 * Moves `amount` USDG from the owner into the BudgetAccount. The fee share is burned through the vault first when
 * the vault is configured and a single-hop quote succeeds; otherwise the whole amount is deposited and the result
 * says why the fee was skipped.
 */
export async function topUp(params: TopUpParams): Promise<TopUpResult> {
  const { publicClient, walletClient, usdg, amount } = params;
  if (amount <= 0n) throw new BudgetError("reverted", "amount must be positive");
  const owner = walletClient.account.address;
  const balance = await usdgBalance(publicClient, usdg, owner);
  if (balance < amount) throw new BudgetError("no-usdg", `the owner holds ${balance.toString()} USDG base units, needs ${amount.toString()}`);
  const now = params.now ?? (() => Date.now());
  const txHashes: Hex[] = [];
  let fee = feeFor(amount, params.feePercent);
  let feeSkipped: string | undefined;

  if (fee > 0n && params.burnVault === "") {
    feeSkipped = "the BurnVault address is not set";
    fee = 0n;
  }
  if (fee > 0n) {
    const vault = params.burnVault as Address;
    const quote = await quoteBurn(publicClient, vault, params.quoter, usdg, fee);
    if (!quote.ok) {
      feeSkipped = quote.reason;
      fee = 0n;
    } else {
      try {
        const allowance = await publicClient.readContract({ address: usdg, abi: erc20Abi, functionName: "allowance", args: [owner, vault] });
        if (allowance < fee) {
          const approve = await walletClient.writeContract({ address: usdg, abi: erc20Abi, functionName: "approve", args: [vault, maxUint256] });
          await publicClient.waitForTransactionReceipt({ hash: approve });
          txHashes.push(approve);
        }
        const deadline = BigInt(Math.floor(now() / 1000) + BURN_DEADLINE_SECONDS);
        const { request } = await publicClient.simulateContract({
          account: walletClient.account,
          address: vault,
          abi: burnVaultAbi,
          functionName: "burnWith",
          args: [usdg, fee, quote.minAmountOut, deadline],
        });
        const hash = await walletClient.writeContract(request);
        const receipt = await publicClient.waitForTransactionReceipt({ hash });
        if (receipt.status !== "success") throw new Error("burnWith reverted");
        txHashes.push(hash);
      } catch (error) {
        feeSkipped = `burn failed: ${toBudgetError(error).message}`;
        fee = 0n;
      }
    }
  }

  const depositAmount = amount - fee;
  txHashes.push(...(await deposit(params, depositAmount)));
  return { deposited: depositAmount, fee, ...(feeSkipped !== undefined ? { feeSkipped } : {}), txHashes };
}
