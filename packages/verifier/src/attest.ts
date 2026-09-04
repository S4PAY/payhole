import { getAddress, isAddress, type Address, type Hex } from "viem";
import { domainHash, normalizeHostname, signClaim, type TypedDataSigner } from "@payhole/sdk";
import { findWalletInTxt, txtRecordName, type TxtResolver } from "./dns.js";

export class AttestError extends Error {
  override name = "AttestError";
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

export interface AttestDeps {
  resolveTxt: TxtResolver;
  readNonce: (hash: Hex) => Promise<bigint>;
  signer: TypedDataSigner;
  chainId: number;
  registry: Address;
  ttlSeconds: number;
  now?: () => number;
}

export interface AttestInput {
  domain: unknown;
  wallet: unknown;
}

export interface Attestation {
  domain: string;
  domainHash: Hex;
  wallet: Address;
  nonce: string;
  deadline: string;
  signature: Hex;
  chainId: number;
  registry: Address;
  verifier: Address;
}

/**
 * Verifies that `_payhole.<domain>` names `wallet` and signs the registry claim for the domain's current
 * nonce. Anyone can submit the returned signature to `CreatorRegistry.claim`.
 */
export async function attest(deps: AttestDeps, input: AttestInput): Promise<Attestation> {
  if (typeof input.wallet !== "string" || !isAddress(input.wallet)) {
    throw new AttestError(400, "invalid_wallet", "wallet must be a 20-byte hex address");
  }
  if (typeof input.domain !== "string" || input.domain.length === 0 || input.domain.length > 253) {
    throw new AttestError(400, "invalid_domain", "domain must be a hostname");
  }
  let hostname: string;
  try {
    hostname = normalizeHostname(input.domain);
  } catch {
    throw new AttestError(400, "invalid_domain", "domain must be a hostname");
  }
  if (!hostname.includes(".") || hostname.startsWith("_payhole.")) {
    throw new AttestError(400, "invalid_domain", "domain must be a public hostname");
  }
  const wallet = getAddress(input.wallet);

  const name = txtRecordName(hostname);
  const records = await deps.resolveTxt(name);
  const match = findWalletInTxt(records, wallet);
  if (!match.found) {
    throw new AttestError(
      422,
      "txt_record_missing",
      `no TXT record at ${name} names ${wallet}; publish "payhole=${wallet}" there`,
      { name, seen: match.seen, wallets: match.wallets },
    );
  }

  const hash = domainHash(hostname);
  const nonce = await deps.readNonce(hash);
  const now = deps.now ? deps.now() : Math.floor(Date.now() / 1000);
  const deadline = BigInt(now + deps.ttlSeconds);
  const signature = await signClaim(deps.signer, deps.chainId, deps.registry, { domainHash: hash, wallet, nonce, deadline });
  return {
    domain: hostname,
    domainHash: hash,
    wallet,
    nonce: nonce.toString(),
    deadline: deadline.toString(),
    signature,
    chainId: deps.chainId,
    registry: deps.registry,
    verifier: deps.signer.address,
  };
}
