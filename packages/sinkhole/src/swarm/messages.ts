import { getAddress, isAddress, verifyMessage, type Address, type Hex } from "viem";
import type { PrivateKeyAccount } from "viem/accounts";
import { cleanReason, normalizeHostname } from "../hostname.js";
import type { TierReader } from "./membership.js";

export const TOPIC_FLAGS = "payhole/flags/v1";
export const TOPIC_DIRECTORY = "payhole/directory/v1";
export const MEMBERSHIP_HEADER = "PayHole Sinkhole membership";
/** Upper bound on a gossip message; anything larger is dropped unparsed. */
export const MAX_MESSAGE_BYTES = 16_384;

/** Binds a libp2p PeerId to an operator wallet: an EIP-191 signature over {@link membershipText}. */
export interface MembershipProof {
  peerId: string;
  address: Address;
  issuedAt: string;
  signature: Hex;
}

export interface FlagBody {
  type: "flag";
  domain: string;
  reason: string;
  /** Announcement time, milliseconds since the epoch. */
  ts: number;
}

export interface EndpointBody {
  type: "endpoint";
  url: string;
  network: string;
  asset: string;
  payTo: Address;
  ts: number;
}

export type MessageBody = FlagBody | EndpointBody;
export type MessageKind = MessageBody["type"];

export interface SwarmMessage<B extends MessageBody = MessageBody> {
  kind: B["type"];
  body: B;
  reporter: Address;
  proof: MembershipProof;
  /** EIP-191 signature by `reporter` over the canonical JSON of `body`. */
  signature: Hex;
}

/** A message narrowed by `kind`. */
export type AnySwarmMessage = SwarmMessage<FlagBody> | SwarmMessage<EndpointBody>;

export type DropReason =
  | "malformed"
  | "unknown_kind"
  | "invalid_body"
  | "stale"
  | "peer_mismatch"
  | "reporter_mismatch"
  | "bad_proof"
  | "tier_too_low"
  | "tier_unavailable"
  | "bad_signature";

export type VerifyResult = { ok: true; message: AnySwarmMessage } | { ok: false; reason: DropReason; detail: string };

export interface VerifierOptions {
  tierOf: TierReader;
  /** Minimum BurnVault tier; zero skips the on-chain check entirely. */
  minTier: number;
  clock?: () => number;
  /** How far into the future a timestamp may lie. */
  maxSkewMs?: number;
  /** How old an announcement may be. */
  maxAgeMs?: number;
}

/** The exact text an operator signs to bind a peer to a wallet. */
export function membershipText(peerId: string, address: string, issuedAt: string): string {
  return `${MEMBERSHIP_HEADER}\npeer: ${peerId}\naddress: ${address}\nissued: ${issuedAt}`;
}

/** JSON with object keys sorted at every level; the form the body signature covers. */
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSignature(value: unknown): value is Hex {
  return typeof value === "string" && /^0x[0-9a-fA-F]{130}$/.test(value);
}

function isIsoDate(value: unknown): value is string {
  return typeof value === "string" && value.length <= 64 && !Number.isNaN(Date.parse(value));
}

const PEER_ID = /^[A-Za-z0-9]{16,128}$/;

/** Structural check of a proof; no cryptography. */
export function parseProof(value: unknown): MembershipProof | null {
  if (!isRecord(value)) return null;
  const peerId = value["peerId"];
  const address = value["address"];
  const issuedAt = value["issuedAt"];
  const signature = value["signature"];
  if (typeof peerId !== "string" || !PEER_ID.test(peerId)) return null;
  if (typeof address !== "string" || !isAddress(address)) return null;
  if (!isIsoDate(issuedAt) || !isSignature(signature)) return null;
  return { peerId, address, issuedAt, signature };
}

export async function signProof(account: PrivateKeyAccount, peerId: string, issuedAt = new Date().toISOString()): Promise<MembershipProof> {
  const address = getAddress(account.address);
  const signature = await account.signMessage({ message: membershipText(peerId, address, issuedAt) });
  return { peerId, address, issuedAt, signature };
}

/** Checks a proof against the libp2p peer that published the message. */
export async function verifyProof(
  proof: MembershipProof,
  senderPeerId: string,
  now = Date.now(),
  maxSkewMs = 5 * 60_000,
): Promise<{ ok: true } | { ok: false; reason: "peer_mismatch" | "bad_proof"; detail: string }> {
  if (proof.peerId !== senderPeerId) return { ok: false, reason: "peer_mismatch", detail: `proof is for ${proof.peerId}, message from ${senderPeerId}` };
  const issued = Date.parse(proof.issuedAt);
  if (Number.isNaN(issued) || issued > now + maxSkewMs) return { ok: false, reason: "bad_proof", detail: "issuedAt is in the future" };
  let valid: boolean;
  try {
    valid = await verifyMessage({ address: proof.address, message: membershipText(proof.peerId, proof.address, proof.issuedAt), signature: proof.signature });
  } catch {
    valid = false;
  }
  return valid ? { ok: true } : { ok: false, reason: "bad_proof", detail: "signature does not match address" };
}

/** Signs a body with the operator wallet. The proof must belong to the same wallet. */
export async function signSwarmMessage<B extends MessageBody>(account: PrivateKeyAccount, proof: MembershipProof, body: B): Promise<SwarmMessage<B>> {
  const reporter = getAddress(account.address);
  if (getAddress(proof.address) !== reporter) throw new Error("membership proof belongs to a different wallet than the signing key");
  const signature = await account.signMessage({ message: canonicalJson(body) });
  return { kind: body.type, body, reporter, proof, signature };
}

export function encodeSwarmMessage(message: AnySwarmMessage): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(message));
}

function parseTs(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function parseFlagBody(body: Record<string, unknown>): FlagBody | null {
  const domain = normalizeHostname(body["domain"]);
  const ts = parseTs(body["ts"]);
  if (domain === null || ts === null) return null;
  return { type: "flag", domain, reason: cleanReason(body["reason"]), ts };
}

const NETWORK = /^[a-z0-9][a-z0-9:_-]{0,63}$/i;

function parseEndpointBody(body: Record<string, unknown>): EndpointBody | null {
  const url = body["url"];
  const network = body["network"];
  const asset = body["asset"];
  const payTo = body["payTo"];
  const ts = parseTs(body["ts"]);
  if (typeof url !== "string" || url.length > 2048 || ts === null) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  } catch {
    return null;
  }
  if (typeof network !== "string" || !NETWORK.test(network)) return null;
  if (typeof asset !== "string" || !isAddress(asset) || typeof payTo !== "string" || !isAddress(payTo)) return null;
  return { type: "endpoint", url, network, asset: getAddress(asset), payTo: getAddress(payTo), ts };
}

function drop(reason: DropReason, detail: string): VerifyResult {
  return { ok: false, reason, detail };
}

/**
 * Full verification of a gossip message: shape, the proof's binding to the libp2p publisher, the
 * reporter's body signature, timestamp window, and the operator's BurnVault tier. Cheap checks run
 * before cryptography, cryptography before the (cached) RPC call.
 */
export async function verifySwarmMessage(raw: Uint8Array | string, senderPeerId: string, options: VerifierOptions): Promise<VerifyResult> {
  const now = (options.clock ?? Date.now)();
  const maxSkew = options.maxSkewMs ?? 5 * 60_000;
  const maxAge = options.maxAgeMs ?? 15 * 60_000;
  if (raw.length > MAX_MESSAGE_BYTES) return drop("malformed", `message exceeds ${MAX_MESSAGE_BYTES} bytes`);
  let parsed: unknown;
  try {
    parsed = JSON.parse(typeof raw === "string" ? raw : new TextDecoder().decode(raw));
  } catch {
    return drop("malformed", "not JSON");
  }
  if (!isRecord(parsed)) return drop("malformed", "not an object");
  const kind = parsed["kind"];
  if (kind !== "flag" && kind !== "endpoint") return drop("unknown_kind", typeof kind === "string" ? kind.slice(0, 32) : typeof kind);
  const reporterRaw = parsed["reporter"];
  if (typeof reporterRaw !== "string" || !isAddress(reporterRaw)) return drop("malformed", "reporter is not an address");
  const reporter = getAddress(reporterRaw);
  const signature = parsed["signature"];
  if (!isSignature(signature)) return drop("malformed", "signature is not a 65-byte hex string");
  const proof = parseProof(parsed["proof"]);
  if (!proof) return drop("malformed", "proof is malformed");
  const bodyRaw = parsed["body"];
  if (!isRecord(bodyRaw) || bodyRaw["type"] !== kind) return drop("invalid_body", "body.type must equal kind");
  if (proof.peerId !== senderPeerId) return drop("peer_mismatch", `proof is for ${proof.peerId}, message from ${senderPeerId}`);
  if (getAddress(proof.address) !== reporter) return drop("reporter_mismatch", "proof address differs from reporter");
  const body = kind === "flag" ? parseFlagBody(bodyRaw) : parseEndpointBody(bodyRaw);
  if (!body) return drop("invalid_body", `${kind} body failed validation`);
  if (body.ts > now + maxSkew) return drop("stale", "timestamp in the future");
  if (body.ts < now - maxAge) return drop("stale", "timestamp too old");
  const proofCheck = await verifyProof(proof, senderPeerId, now, maxSkew);
  if (!proofCheck.ok) return drop(proofCheck.reason, proofCheck.detail);
  let valid: boolean;
  try {
    valid = await verifyMessage({ address: reporter, message: canonicalJson(bodyRaw), signature });
  } catch {
    valid = false;
  }
  if (!valid) return drop("bad_signature", "body signature does not match reporter");
  if (options.minTier > 0) {
    let tier: number;
    try {
      tier = await options.tierOf(reporter);
    } catch (error) {
      return drop("tier_unavailable", error instanceof Error ? error.message : String(error));
    }
    if (tier < options.minTier) return drop("tier_too_low", `tier ${tier} is below ${options.minTier}`);
  }
  const message: AnySwarmMessage =
    body.type === "flag" ? { kind: "flag", body, reporter, proof, signature } : { kind: "endpoint", body, reporter, proof, signature };
  return { ok: true, message };
}
