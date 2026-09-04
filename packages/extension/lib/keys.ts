import { toHex, type Hex } from "viem";
import { english, generateMnemonic, mnemonicToAccount, privateKeyToAccount, type HDAccount, type PrivateKeyAccount } from "viem/accounts";
import { mnemonicToSeed, validateMnemonic } from "@scure/bip39";

/** Controls the BudgetAccount and pays gas. */
export const OWNER_PATH = "m/44'/60'/0'/0/0" as const;

/** Agent session key `i`. Deterministic, so a key can be recovered from the seed alone. */
export function agentPath(index: number): `m/44'/60'/${string}` {
  if (!Number.isInteger(index) || index < 0) throw new Error("agent index must be a non-negative integer");
  return `m/44'/60'/2'/0/${index}`;
}

export const ORIGIN_KEY_PREFIX = "payhole/origin/v1/";

const SECP256K1_N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;

export function newMnemonic(): string {
  return generateMnemonic(english);
}

export function isValidMnemonic(mnemonic: string): boolean {
  return validateMnemonic(normalizeMnemonic(mnemonic), english);
}

export function normalizeMnemonic(mnemonic: string): string {
  return mnemonic.trim().toLowerCase().split(/\s+/).join(" ");
}

export function ownerAccount(mnemonic: string): HDAccount {
  return mnemonicToAccount(mnemonic, { path: OWNER_PATH });
}

export function agentAccount(mnemonic: string, index: number): HDAccount {
  return mnemonicToAccount(mnemonic, { path: agentPath(index) });
}

/** BIP-39 seed bytes (64 bytes) used as the HMAC key for per-origin addresses. */
export function seedFromMnemonic(mnemonic: string): Promise<Uint8Array> {
  return mnemonicToSeed(mnemonic);
}

/** Lowercased origin (`scheme://host[:port]`) of a URL; the identity every per-site address is keyed by. */
export function normalizeOrigin(url: string): string {
  const origin = new URL(url).origin;
  if (origin === "null") throw new Error(`URL has an opaque origin: ${url}`);
  return origin.toLowerCase();
}

async function hmacSha256(key: Uint8Array, message: Uint8Array): Promise<Uint8Array> {
  const cryptoKey = await globalThis.crypto.subtle.importKey("raw", key as BufferSource, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await globalThis.crypto.subtle.sign("HMAC", cryptoKey, message as BufferSource);
  return new Uint8Array(signature);
}

/**
 * Private key for `origin`: HMAC-SHA-256 over "payhole/origin/v1/<origin>" keyed with the seed. Values outside the
 * secp256k1 scalar range are rejected by appending a counter byte and hashing again.
 */
export async function originPrivateKey(seed: Uint8Array, origin: string): Promise<Hex> {
  const base = new TextEncoder().encode(ORIGIN_KEY_PREFIX + origin);
  for (let counter = 0; counter < 256; counter++) {
    const message = counter === 0 ? base : new Uint8Array([...base, counter]);
    const digest = await hmacSha256(seed, message);
    const scalar = BigInt(toHex(digest));
    if (scalar !== 0n && scalar < SECP256K1_N) return toHex(digest);
  }
  throw new Error("could not derive a valid key for the origin");
}

export async function originAccount(seed: Uint8Array, origin: string): Promise<PrivateKeyAccount> {
  return privateKeyToAccount(await originPrivateKey(seed, origin));
}
