import { createPublicClient, createWalletClient, http, type Address, type Chain, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { ensureKeyFunds } from "./budget/index.js";
import { chainConfig, customChain, robinhoodChain, USDG_ADDRESS } from "./chain.js";
import { createX402Fetch, type PaymentReceipt } from "./x402/index.js";

export interface PayholeFetchOptions {
  /** Session key issued by the BudgetAccount owner. Signs authorizations and pays gas for pulls. */
  sessionKey: Hex;
  budgetAccount: Address;
  rpcUrl?: string;
  chainId?: number;
  usdg?: Address;
  /** Refuse offers above this many USDG base units, before touching the chain. */
  maxAmount?: bigint;
  fetch?: typeof globalThis.fetch;
  onPaid?: (receipt: PaymentReceipt) => Promise<void> | void;
  /** Called when USDG is pulled from the account to cover a payment. */
  onPull?: (pulled: bigint, txHash: Hex | undefined) => void;
}

export interface PayholeFetch {
  (input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
  /** Address of the session key, the payer on every authorization. */
  readonly payer: Address;
  readonly chain: Chain;
}

/**
 * `fetch` that pays x402 402s from a BudgetAccount through a session key. Under the key's cap the payment
 * is silent; over it, the call throws PaymentRefusedError without signing anything.
 */
export function payholeFetch(options: PayholeFetchOptions): PayholeFetch {
  const chainId = options.chainId ?? chainConfig.chainId;
  const rpcUrl = options.rpcUrl ?? chainConfig.rpc;
  const chain = chainId === chainConfig.chainId && !options.rpcUrl ? robinhoodChain : customChain(chainId, rpcUrl);
  const usdg = options.usdg ?? USDG_ADDRESS;
  const account = privateKeyToAccount(options.sessionKey);
  const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });
  const walletClient = createWalletClient({ account, chain, transport: http(rpcUrl) });

  const wrapped = createX402Fetch({
    signer: account,
    chainId,
    asset: usdg,
    ...(options.fetch ? { fetch: options.fetch } : {}),
    ...(options.onPaid ? { onPaid: options.onPaid } : {}),
    authorize: async (offer) => {
      if (options.maxAmount !== undefined && offer.amount > options.maxAmount) {
        return { allow: false, reason: `amount ${offer.amount.toString()} exceeds the configured maximum` };
      }
      const result = await ensureKeyFunds({
        publicClient,
        walletClient,
        budgetAccount: options.budgetAccount,
        usdg,
        amount: offer.amount,
      });
      if (result.pulled > 0n) options.onPull?.(result.pulled, result.txHash);
      return { allow: true };
    },
  });

  const fn = ((input: RequestInfo | URL, init?: RequestInit) => wrapped(input, init)) as PayholeFetch;
  Object.defineProperty(fn, "payer", { value: account.address, enumerable: true });
  Object.defineProperty(fn, "chain", { value: chain, enumerable: true });
  return fn;
}
