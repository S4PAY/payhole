import {
  createPublicClient,
  createWalletClient,
  http,
  type Account,
  type Chain,
  type PublicClient,
  type Transport,
  type WalletClient,
} from "viem";
import { chainConfig, customChain, robinhoodChain } from "@payhole/sdk";

export type OwnerWallet = WalletClient<Transport, Chain, Account>;

export interface ChainSettings {
  chainId: number;
  rpcUrl: string;
}

/** Robinhood Chain for the defaults, a custom chain object for anvil runs and forks. */
export function chainFor(settings: ChainSettings): Chain {
  if (settings.chainId === chainConfig.chainId && settings.rpcUrl === chainConfig.rpc) return robinhoodChain;
  return customChain(settings.chainId, settings.rpcUrl);
}

export function publicClientFor(settings: ChainSettings): PublicClient {
  return createPublicClient({ chain: chainFor(settings), transport: http(settings.rpcUrl) });
}

export function walletClientFor(settings: ChainSettings, account: Account): OwnerWallet {
  return createWalletClient({ account, chain: chainFor(settings), transport: http(settings.rpcUrl) });
}
