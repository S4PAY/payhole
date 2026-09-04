import type { Address, Hex, PublicClient } from "viem";
import { creatorRegistryAbi, domainHash, normalizeHostname } from "@payhole/sdk";
import { ZERO_ADDRESS } from "./tiers";

export interface CreatorLookup {
  hostname: string;
  domainHash: Hex;
  wallet: Address;
  registered: boolean;
}

/** `walletOf(keccak256(hostname))` for a hostname or URL. */
export async function lookupCreator(client: PublicClient, registry: Address, hostnameOrUrl: string): Promise<CreatorLookup> {
  const hostname = normalizeHostname(hostnameOrUrl);
  const hash = domainHash(hostname);
  const wallet = await client.readContract({ address: registry, abi: creatorRegistryAbi, functionName: "walletOf", args: [hash] });
  return { hostname, domainHash: hash, wallet, registered: wallet !== ZERO_ADDRESS };
}
