import type { Address, Hex, PublicClient, TypedDataDefinition } from "viem";
import { creatorRegistryAbi } from "../generated/abi.js";
import type { TypedDataSigner } from "../x402/eip3009.js";

export { creatorRegistryAbi };

/** EIP-712 type the verifier signs; must match CreatorRegistry.CLAIM_TYPEHASH. */
export const CLAIM_TYPES = {
  Claim: [
    { name: "domainHash", type: "bytes32" },
    { name: "wallet", type: "address" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
} as const;

export const REGISTRY_EIP712_NAME = "PayHoleCreatorRegistry";
export const REGISTRY_EIP712_VERSION = "1";

export interface ClaimAttestation {
  domainHash: Hex;
  wallet: Address;
  nonce: bigint;
  deadline: bigint;
}

/** Typed data for a claim attestation on the registry at `registry` on `chainId`. */
export function claimTypedData(chainId: number, registry: Address, claim: ClaimAttestation): TypedDataDefinition {
  return {
    domain: { name: REGISTRY_EIP712_NAME, version: REGISTRY_EIP712_VERSION, chainId, verifyingContract: registry },
    types: CLAIM_TYPES,
    primaryType: "Claim",
    message: { domainHash: claim.domainHash, wallet: claim.wallet, nonce: claim.nonce, deadline: claim.deadline },
  };
}

/** Signs a claim attestation with the verifier key. */
export function signClaim(signer: TypedDataSigner, chainId: number, registry: Address, claim: ClaimAttestation): Promise<Hex> {
  return signer.signTypedData(claimTypedData(chainId, registry, claim));
}

/** Nonce the next attestation for `domainHash` must carry. */
export function readClaimNonce(client: PublicClient, registry: Address, domainHash: Hex): Promise<bigint> {
  return client.readContract({ address: registry, abi: creatorRegistryAbi, functionName: "nonceOf", args: [domainHash] });
}

/** Wallet registered for `domainHash`, or the zero address when unclaimed. */
export function readCreatorWallet(client: PublicClient, registry: Address, domainHash: Hex): Promise<Address> {
  return client.readContract({ address: registry, abi: creatorRegistryAbi, functionName: "walletOf", args: [domainHash] });
}
