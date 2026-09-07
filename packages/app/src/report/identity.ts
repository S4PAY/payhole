// The phone's reporter identity: a secp256k1 key that signs reports. Money never touches it. A tier
// holder links it by signing a membership proof that names this key's address in the peer slot, the
// same proof a Sinkhole node uses, and from then on the phone's reports count as that wallet's flags.

import { hmac } from "@noble/hashes/hmac.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { keccak_256 } from "@noble/hashes/sha3.js";
import { bytesToHex, concatBytes, hexToBytes, utf8ToBytes } from "@noble/hashes/utils.js";
import * as secp from "@noble/secp256k1";

import type { Category } from "../dns/verdict";

secp.etc.hmacSha256Sync = (key, ...messages) => hmac(sha256, key, concatBytes(...messages));

export const MEMBERSHIP_HEADER = "PayHole Sinkhole membership";

export interface Proof {
  peerId: string;
  address: string;
  issuedAt: string;
  signature: string;
}

export interface FlagBody {
  type: "flag";
  domain: string;
  reason: string;
  ts: number;
  category?: Category;
}

export interface DelegatedFlag {
  kind: "flag";
  body: FlagBody;
  reporter: string;
  proof: Proof;
  signature: string;
  delegate: string;
}

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const SIGNATURE = /^0x[0-9a-fA-F]{130}$/;
/** The byte EIP-191 puts in front of a personal message. */
const PERSONAL_PREFIX = new Uint8Array([0x19]);

export function isAddress(value: unknown): value is string {
  return typeof value === "string" && ADDRESS.test(value);
}

/** EIP-55 mixed-case form of an address. */
export function checksumAddress(address: string): string {
  const lower = address.toLowerCase().replace(/^0x/, "");
  const hash = bytesToHex(keccak_256(utf8ToBytes(lower)));
  let out = "0x";
  for (let index = 0; index < lower.length; index += 1) {
    const char = lower[index] ?? "";
    out += parseInt(hash[index] ?? "0", 16) >= 8 ? char.toUpperCase() : char;
  }
  return out;
}

export function sameAddress(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

function publicKeyToAddress(publicKey: Uint8Array): string {
  return checksumAddress(`0x${bytesToHex(keccak_256(publicKey.slice(1)).slice(12))}`);
}

export function privateKeyToAddress(privateKey: Uint8Array): string {
  return publicKeyToAddress(secp.getPublicKey(privateKey, false));
}

export function isPrivateKey(value: Uint8Array): boolean {
  return value.length === 32 && secp.utils.isValidPrivateKey(value);
}

/** The hash an EIP-191 personal signature covers. */
export function personalHash(message: string): Uint8Array {
  const bytes = utf8ToBytes(message);
  return keccak_256(concatBytes(PERSONAL_PREFIX, utf8ToBytes(`Ethereum Signed Message:\n${bytes.length}`), bytes));
}

function recoverFromHash(hash: Uint8Array, compactHex: string, recovery: number): string | null {
  try {
    return publicKeyToAddress(secp.Signature.fromCompact(compactHex).addRecoveryBit(recovery).recoverPublicKey(hash).toRawBytes(false));
  } catch {
    return null;
  }
}

/** An EIP-191 personal signature, 65 bytes as hex with v of 27 or 28, the form wallets and the nodes use. */
export function signMessage(privateKey: Uint8Array, message: string): string {
  const hash = personalHash(message);
  const signature = secp.sign(hash, privateKey, { lowS: true });
  const compact = bytesToHex(signature.toCompactRawBytes());
  let recovery = signature.recovery;
  if (recovery === undefined) {
    const signer = privateKeyToAddress(privateKey);
    recovery = [0, 1].find((bit) => sameAddress(recoverFromHash(hash, compact, bit) ?? "", signer)) ?? 0;
  }
  return `0x${compact}${(27 + recovery).toString(16)}`;
}

/** The address that produced a personal signature over `message`, or null when the signature is not one. */
export function recoverMessageSigner(message: string, signature: string): string | null {
  if (!SIGNATURE.test(signature)) return null;
  const v = parseInt(signature.slice(-2), 16);
  const recovery = v >= 27 ? v - 27 : v;
  if (recovery !== 0 && recovery !== 1) return null;
  return recoverFromHash(personalHash(message), signature.slice(2, 130), recovery);
}

/** The exact text a tier holder signs to bind a key to their wallet; identical to the node's. */
export function membershipText(peerId: string, address: string, issuedAt: string): string {
  return `${MEMBERSHIP_HEADER}\npeer: ${peerId}\naddress: ${address}\nissued: ${issuedAt}`;
}

/** JSON with keys sorted at every level; what the body signature covers. Identical to the node's. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  const record = value as Record<string, unknown>;
  const parts: string[] = [];
  for (const key of Object.keys(record).sort()) {
    const item = record[key];
    if (item === undefined) continue;
    parts.push(`${JSON.stringify(key)}:${canonicalJson(item)}`);
  }
  return `{${parts.join(",")}}`;
}

/** Reads a proof pasted from payhole.org/link and checks that it names this phone and was signed by the wallet it claims. */
export function parseProof(text: string, delegateAddress: string): { ok: true; proof: Proof } | { ok: false; error: string } {
  let value: unknown;
  try {
    value = JSON.parse(text.trim());
  } catch {
    return { ok: false, error: "That is not the proof JSON. Copy the whole block from the link page." };
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) return { ok: false, error: "The proof must be a JSON object." };
  const record = value as Record<string, unknown>;
  const { peerId, address, issuedAt, signature } = record;
  if (!isAddress(peerId)) return { ok: false, error: "The proof does not name a reporter key." };
  if (!sameAddress(peerId, delegateAddress)) return { ok: false, error: `This proof is for ${peerId.slice(0, 10)}, not for this phone's key.` };
  if (!isAddress(address)) return { ok: false, error: "The proof does not name a wallet." };
  if (typeof issuedAt !== "string" || Number.isNaN(Date.parse(issuedAt))) return { ok: false, error: "The proof has no valid issue time." };
  if (typeof signature !== "string" || !SIGNATURE.test(signature)) return { ok: false, error: "The proof's signature is malformed." };
  const signer = recoverMessageSigner(membershipText(peerId, address, issuedAt), signature);
  if (!signer || !sameAddress(signer, address)) return { ok: false, error: "The signature was not made by the wallet the proof names." };
  return { ok: true, proof: { peerId, address, issuedAt, signature } };
}

/** The text a phone signs for a hint; identical to the node's, keys sorted. */
export function hintText(domain: string, category: Category | null, reason: string, ts: number, payTo: string | null): string {
  return canonicalJson({ type: "hint", domain, category, reason, ts, payTo });
}

export interface SignedHint {
  name: string;
  category?: Category;
  reason?: string;
  key: string;
  payTo: string | null;
  ts: number;
  signature: string;
}

/** A hint signed by this phone's key, naming the wallet rewards go to; the node records the first such report of a name. */
export function signHint(privateKey: Uint8Array, domain: string, category: Category | null, reason: string, payTo: string | null, ts = Date.now()): SignedHint {
  const key = privateKeyToAddress(privateKey);
  const cleanPayTo = payTo ? checksumAddress(payTo) : null;
  return {
    name: domain,
    ...(category ? { category } : {}),
    ...(reason ? { reason } : {}),
    key,
    payTo: cleanPayTo,
    ts,
    signature: signMessage(privateKey, hintText(domain, category, reason, ts, cleanPayTo)),
  };
}

/** A swarm flag signed by this phone on behalf of the wallet in the proof, in the node's message format. */
export function buildDelegatedFlag(privateKey: Uint8Array, proof: Proof, body: FlagBody): DelegatedFlag {
  const delegate = privateKeyToAddress(privateKey);
  if (!sameAddress(proof.peerId, delegate)) throw new Error("the proof does not name this phone's key");
  const clean: FlagBody = { type: "flag", domain: body.domain, reason: body.reason, ts: body.ts, ...(body.category ? { category: body.category } : {}) };
  return { kind: "flag", body: clean, reporter: proof.address, proof, signature: signMessage(privateKey, canonicalJson(clean)), delegate };
}

export const bytesToHexString = bytesToHex;
export const hexToBytesArray = hexToBytes;
