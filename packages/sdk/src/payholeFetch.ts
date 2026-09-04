import { createPublicClient, createWalletClient, http, isAddress, type Address, type Chain, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { ensureKeyFunds } from "./budget/index.js";
import { chainConfig, customChain, robinhoodChain, USDG_ADDRESS } from "./chain.js";
import { PayholeError, PaymentRefusedError } from "./errors.js";
import { formatUsdg, parseUsdg } from "./usdg.js";
import { createX402Fetch, type PaymentOffer, type PaymentReceipt, type SpendDecision } from "./x402/index.js";

export interface PayholeFetchOptions {
  /** Session key issued by the BudgetAccount owner. Signs authorizations and pays gas for pulls. */
  sessionKey: Hex;
  /** Account the key was issued on. Omit to pay from the key's own USDG balance instead. */
  budgetAccount?: Address;
  rpcUrl?: string;
  chainId?: number;
  usdg?: Address;
  /** Most USDG one call may cost, as a decimal ("0.50" or 0.5). Refused before touching the chain. */
  cap?: string | number;
  /** Same ceiling in USDG base units. When both are given the lower one applies. */
  maxAmount?: bigint;
  /** Extra policy consulted after the cap check and before any funds move. Throw PaymentRefusedError to refuse with a reason code. */
  authorize?: (offer: PaymentOffer, url: URL) => Promise<SpendDecision> | SpendDecision;
  fetch?: typeof globalThis.fetch;
  onPaid?: (receipt: PaymentReceipt) => Promise<void> | void;
  /** Called when USDG is pulled from the account to cover a payment. */
  onPull?: (pulled: bigint, txHash: Hex | undefined) => void;
}

/** `fetch` init with the one extra option the direct form takes. */
export interface PayholeRequestInit extends RequestInit {
  /** Most USDG this call may cost, as a decimal ("0.50" or 0.5). */
  cap?: string | number;
  /** Same ceiling in USDG base units. */
  maxAmount?: bigint;
}

export interface PayholeFetch {
  (input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
  /** Address of the session key, the payer on every authorization. */
  readonly payer: Address;
  readonly chain: Chain;
}

function ceiling(options: { cap?: string | number; maxAmount?: bigint }): bigint | undefined {
  const fromCap = options.cap !== undefined ? parseUsdg(options.cap) : undefined;
  if (fromCap === undefined) return options.maxAmount;
  if (options.maxAmount === undefined) return fromCap;
  return fromCap < options.maxAmount ? fromCap : options.maxAmount;
}

function buildFetch(options: PayholeFetchOptions): PayholeFetch {
  const chainId = options.chainId ?? chainConfig.chainId;
  const rpcUrl = options.rpcUrl ?? chainConfig.rpc;
  const chain = chainId === chainConfig.chainId && !options.rpcUrl ? robinhoodChain : customChain(chainId, rpcUrl);
  const usdg = options.usdg ?? USDG_ADDRESS;
  const account = privateKeyToAccount(options.sessionKey);
  const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });
  const walletClient = createWalletClient({ account, chain, transport: http(rpcUrl) });
  const max = ceiling(options);
  const budgetAccount = options.budgetAccount;

  const wrapped = createX402Fetch({
    signer: account,
    chainId,
    asset: usdg,
    ...(options.fetch ? { fetch: options.fetch } : {}),
    ...(options.onPaid ? { onPaid: options.onPaid } : {}),
    authorize: async (offer, url) => {
      if (max !== undefined && offer.amount > max) {
        throw new PaymentRefusedError(`offer of ${formatUsdg(offer.amount)} USDG exceeds the cap of ${formatUsdg(max)} USDG`, "max-exceeded", offer.amount);
      }
      if (options.authorize) {
        const decision = await options.authorize(offer, url);
        if (!decision.allow) return decision;
      }
      if (budgetAccount) {
        const result = await ensureKeyFunds({ publicClient, walletClient, budgetAccount, usdg, amount: offer.amount });
        if (result.pulled > 0n) options.onPull?.(result.pulled, result.txHash);
      }
      return { allow: true };
    },
  });

  const fn = ((input: RequestInfo | URL, init?: RequestInit) => wrapped(input, init)) as PayholeFetch;
  Object.defineProperty(fn, "payer", { value: account.address, enumerable: true });
  Object.defineProperty(fn, "chain", { value: chain, enumerable: true });
  return fn;
}

/** Settings for the direct form, read from the same environment the CLI uses. */
export function optionsFromEnv(env: Record<string, string | undefined> = process.env): PayholeFetchOptions {
  const key = env["PAYHOLE_SESSION_KEY"];
  if (!key) throw new PayholeError("PAYHOLE_SESSION_KEY is not set: the direct form of payholeFetch needs a session key in the environment");
  const normalized = key.startsWith("0x") ? key : `0x${key}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(normalized)) throw new PayholeError("PAYHOLE_SESSION_KEY must be 32 bytes of hex");
  const budgetAccount = env["PAYHOLE_BUDGET_ACCOUNT"] ?? env["PAYHOLE_ACCOUNT"];
  if (budgetAccount !== undefined && !isAddress(budgetAccount)) throw new PayholeError("PAYHOLE_BUDGET_ACCOUNT is not an address");
  const usdg = env["PAYHOLE_USDG"];
  if (usdg !== undefined && !isAddress(usdg)) throw new PayholeError("PAYHOLE_USDG is not an address");
  const rpcUrl = env["PAYHOLE_RPC_URL"];
  const chainId = env["PAYHOLE_CHAIN_ID"];
  return {
    sessionKey: normalized as Hex,
    ...(budgetAccount !== undefined ? { budgetAccount } : {}),
    ...(rpcUrl !== undefined ? { rpcUrl } : {}),
    ...(chainId !== undefined ? { chainId: Number(chainId) } : {}),
    ...(usdg !== undefined ? { usdg } : {}),
  };
}

/**
 * `fetch` that pays x402 402s from a BudgetAccount through a session key. Under the cap the payment
 * is silent; over it, the call throws PaymentRefusedError without signing anything.
 *
 * Two forms. Configured: `payholeFetch({ sessionKey, budgetAccount, cap: "0.50" })` returns a `fetch`.
 * Direct: `payholeFetch(url, { cap: "0.50" })` behaves like `fetch` and takes the key, account, and RPC
 * from `PAYHOLE_SESSION_KEY`, `PAYHOLE_BUDGET_ACCOUNT`, and `PAYHOLE_RPC_URL`.
 */
export function payholeFetch(options: PayholeFetchOptions): PayholeFetch;
export function payholeFetch(input: RequestInfo | URL, init?: PayholeRequestInit): Promise<Response>;
export function payholeFetch(first: PayholeFetchOptions | RequestInfo | URL, init?: PayholeRequestInit): PayholeFetch | Promise<Response> {
  if (typeof first === "string" || first instanceof URL || first instanceof Request) {
    const { cap, maxAmount, ...rest } = init ?? {};
    // Like fetch, the direct form reports every problem through the returned promise.
    return Promise.resolve().then(() => {
      const options = { ...optionsFromEnv(), ...(cap !== undefined ? { cap } : {}), ...(maxAmount !== undefined ? { maxAmount } : {}) };
      return buildFetch(options)(first, rest);
    });
  }
  return buildFetch(first);
}
