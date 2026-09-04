import { defineChain, type Address, type Chain } from "viem";
import { chainConfig } from "./generated/chain.js";
import { deployments } from "./generated/deployments.js";

export { chainConfig, deployments };

/** Robinhood Chain as a viem chain definition. */
export const robinhoodChain: Chain = defineChain({
  id: chainConfig.chainId,
  name: chainConfig.name,
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [chainConfig.rpc] } },
  blockExplorers: { default: { name: "Blockscout", url: chainConfig.explorer } },
});

export const USDG_ADDRESS: Address = chainConfig.usdg;
export const USDG_DECIMALS = chainConfig.x402.asset.decimals;

/** A viem chain for a custom chain id and RPC (local anvil, forks). */
export function customChain(id: number, rpcUrl: string): Chain {
  return defineChain({
    id,
    name: `chain-${id}`,
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] } },
  });
}

/** Deployed protocol address by contract name, if the deployment record has it. */
export function deployedAddress(name: keyof typeof deployments.contracts): Address | undefined {
  const entry = (deployments.contracts as Record<string, { address?: string } | undefined>)[name];
  return entry?.address as Address | undefined;
}
