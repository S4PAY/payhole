import {
  BaseError,
  ContractFunctionRevertedError,
  erc20Abi,
  type Account,
  type Address,
  type Chain,
  type Hex,
  type PublicClient,
  type Transport,
  type WalletClient,
} from "viem";
import { PaymentRefusedError } from "../errors.js";
import { budgetAccountAbi } from "../generated/abi.js";

export { budgetAccountAbi };

export interface SessionKeyState {
  live: boolean;
  cap: bigint;
  spent: bigint;
  /** Unix seconds; zero when the key was never set. */
  expiry: number;
  epoch: number;
  /** What the key can still spend right now: the smaller of its own and the global headroom. */
  remaining: bigint;
}

/** Reads a session key's permission and live headroom from a BudgetAccount. */
export async function readSessionKey(client: PublicClient, budgetAccount: Address, key: Address): Promise<SessionKeyState> {
  const [record, live, remaining] = await Promise.all([
    client.readContract({ address: budgetAccount, abi: budgetAccountAbi, functionName: "sessionKey", args: [key] }),
    client.readContract({ address: budgetAccount, abi: budgetAccountAbi, functionName: "isSessionKeyLive", args: [key] }),
    client.readContract({ address: budgetAccount, abi: budgetAccountAbi, functionName: "remainingForKey", args: [key] }),
  ]);
  return { live, cap: record.cap, spent: record.spent, expiry: record.expiry, epoch: record.epoch, remaining };
}

export interface EnsureFundsParams {
  publicClient: PublicClient;
  /** Wallet of the session key; it pays gas for the pull. */
  walletClient: WalletClient<Transport, Chain, Account>;
  budgetAccount: Address;
  usdg: Address;
  /** USDG base units the key is about to authorize. */
  amount: bigint;
}

export interface EnsureFundsResult {
  /** USDG pulled from the account into the key's own balance; zero when the balance already covered it. */
  pulled: bigint;
  txHash?: Hex;
}

/**
 * Makes sure the session key's own USDG balance covers `amount`, pulling the difference from the
 * BudgetAccount through `pay(key, deficit)`. The account enforces the key's cap, expiry, and the global
 * cap on-chain; a revert becomes a {@link PaymentRefusedError} and nothing is signed.
 */
export async function ensureKeyFunds(params: EnsureFundsParams): Promise<EnsureFundsResult> {
  const key = params.walletClient.account.address;
  const balance = await params.publicClient.readContract({
    address: params.usdg,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [key],
  });
  if (balance >= params.amount) return { pulled: 0n };
  const deficit = params.amount - balance;

  const state = await readSessionKey(params.publicClient, params.budgetAccount, key);
  if (!state.live) throw new PaymentRefusedError("session key is revoked, expired, or unknown", "key-not-live", params.amount);
  if (state.remaining < deficit) {
    throw new PaymentRefusedError(
      `session key can spend ${state.remaining.toString()} more, needs ${deficit.toString()}`,
      "cap-exceeded",
      params.amount,
    );
  }

  try {
    const { request } = await params.publicClient.simulateContract({
      account: params.walletClient.account,
      address: params.budgetAccount,
      abi: budgetAccountAbi,
      functionName: "pay",
      args: [key, deficit],
    });
    const txHash = await params.walletClient.writeContract(request);
    const receipt = await params.publicClient.waitForTransactionReceipt({ hash: txHash });
    if (receipt.status !== "success") throw new PaymentRefusedError("pull from BudgetAccount reverted", "pull-reverted", params.amount);
    return { pulled: deficit, txHash };
  } catch (error) {
    if (error instanceof PaymentRefusedError) throw error;
    const reverted = error instanceof BaseError ? error.walk((e) => e instanceof ContractFunctionRevertedError) : null;
    if (reverted instanceof ContractFunctionRevertedError) {
      const name = reverted.data?.errorName ?? "revert";
      throw new PaymentRefusedError(`BudgetAccount refused the pull: ${name}`, name, params.amount);
    }
    throw error;
  }
}
