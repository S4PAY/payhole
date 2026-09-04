import { getAddress, toHex, type Address, type Hex, type TypedDataDefinition, type TypedDataDomain } from "viem";
import type { Eip3009Authorization, PaymentOffer } from "./types.js";

/** EIP-3009 TransferWithAuthorization typed-data definition, as the x402 reference client signs it. */
export const TRANSFER_WITH_AUTHORIZATION_TYPES = {
  TransferWithAuthorization: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce", type: "bytes32" },
  ],
} as const;

/** Anything that can sign EIP-712 typed data for one address: a viem local account or a custom signer. */
export interface TypedDataSigner {
  address: Address;
  signTypedData(definition: TypedDataDefinition): Promise<Hex>;
}

/** 32 fresh random bytes; nonce uniqueness is enforced on-chain per payer. */
export function createNonce(): Hex {
  const bytes = new Uint8Array(32);
  globalThis.crypto.getRandomValues(bytes);
  return toHex(bytes);
}

/** EIP-712 domain of the asset: name and version come from the offer, the contract is the asset itself. */
export function eip712Domain(offer: PaymentOffer): TypedDataDomain {
  return {
    name: offer.eip712.name,
    version: offer.eip712.version,
    chainId: offer.chainId,
    verifyingContract: offer.asset,
  };
}

/**
 * Authorization for exactly the offered amount, valid from the epoch (as the reference client does) until
 * `now + maxTimeoutSeconds`.
 */
export function buildAuthorization(offer: PaymentOffer, from: Address, nowSeconds = Math.floor(Date.now() / 1000)): Eip3009Authorization {
  return {
    from: getAddress(from),
    to: offer.payTo,
    value: offer.amount.toString(),
    validAfter: "0",
    validBefore: (nowSeconds + offer.maxTimeoutSeconds).toString(),
    nonce: createNonce(),
  };
}

/** The exact typed data a payer signs (and a facilitator verifies) for an authorization. */
export function authorizationTypedData(offer: PaymentOffer, authorization: Eip3009Authorization): TypedDataDefinition {
  return {
    domain: eip712Domain(offer),
    types: TRANSFER_WITH_AUTHORIZATION_TYPES,
    primaryType: "TransferWithAuthorization",
    message: {
      from: authorization.from,
      to: authorization.to,
      value: BigInt(authorization.value),
      validAfter: BigInt(authorization.validAfter),
      validBefore: BigInt(authorization.validBefore),
      nonce: authorization.nonce,
    },
  };
}

export async function signAuthorization(
  signer: TypedDataSigner,
  offer: PaymentOffer,
  authorization: Eip3009Authorization,
): Promise<Hex> {
  return signer.signTypedData(authorizationTypedData(offer, authorization));
}
