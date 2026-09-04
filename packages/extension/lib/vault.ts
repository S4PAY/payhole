import type { KeyValueStore } from "./storage";

export class WrongPasswordError extends Error {
  override name = "WrongPasswordError";
  constructor() {
    super("wrong password");
  }
}

/** What is stored in `browser.storage.local`; every field but the counters is base64. */
export interface EncryptedVault {
  version: 1;
  salt: string;
  iv: string;
  ciphertext: string;
  iterations: number;
}

export const PBKDF2_ITERATIONS = 600_000;
export const VAULT_KEY = "vault";
export const SESSION_MNEMONIC_KEY = "unlockedMnemonic";

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(text: string): Uint8Array {
  return Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
}

async function deriveKey(password: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
  const subtle = globalThis.crypto.subtle;
  const material = await subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveKey"]);
  return subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt: salt as BufferSource, iterations },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

/** AES-GCM-256 under a PBKDF2-SHA-256 key with a fresh 16-byte salt and 12-byte IV. */
export async function encryptSecret(secret: string, password: string, iterations = PBKDF2_ITERATIONS): Promise<EncryptedVault> {
  if (iterations < 1) throw new Error("iterations must be positive");
  const salt = globalThis.crypto.getRandomValues(new Uint8Array(16));
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt, iterations);
  const ciphertext = await globalThis.crypto.subtle.encrypt({ name: "AES-GCM", iv: iv as BufferSource }, key, new TextEncoder().encode(secret));
  return { version: 1, salt: toBase64(salt), iv: toBase64(iv), ciphertext: toBase64(new Uint8Array(ciphertext)), iterations };
}

/** Inverse of {@link encryptSecret}; a wrong password fails authentication and throws WrongPasswordError. */
export async function decryptSecret(vault: EncryptedVault, password: string): Promise<string> {
  const key = await deriveKey(password, fromBase64(vault.salt), vault.iterations);
  try {
    const plain = await globalThis.crypto.subtle.decrypt(
      { name: "AES-GCM", iv: fromBase64(vault.iv) as BufferSource },
      key,
      fromBase64(vault.ciphertext) as BufferSource,
    );
    return new TextDecoder().decode(plain);
  } catch {
    throw new WrongPasswordError();
  }
}

export function isEncryptedVault(value: unknown): value is EncryptedVault {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    v["version"] === 1 &&
    typeof v["salt"] === "string" &&
    typeof v["iv"] === "string" &&
    typeof v["ciphertext"] === "string" &&
    typeof v["iterations"] === "number"
  );
}

/**
 * Encrypted seed at rest in local storage; the unlocked mnemonic in session storage only. Callers keep their own
 * in-memory copy for the lifetime of the service worker and call {@link VaultStore.lock} to clear both.
 */
export class VaultStore {
  constructor(
    private readonly local: KeyValueStore,
    private readonly session: KeyValueStore,
  ) {}

  async exists(): Promise<boolean> {
    return isEncryptedVault(await this.local.get(VAULT_KEY));
  }

  async create(mnemonic: string, password: string, iterations = PBKDF2_ITERATIONS): Promise<void> {
    if (await this.exists()) throw new Error("a vault already exists; lock and remove it first");
    if (password.length < 8) throw new Error("password must be at least 8 characters");
    await this.local.set(VAULT_KEY, await encryptSecret(mnemonic, password, iterations));
    await this.session.set(SESSION_MNEMONIC_KEY, mnemonic);
  }

  async unlock(password: string): Promise<string> {
    const vault = await this.local.get(VAULT_KEY);
    if (!isEncryptedVault(vault)) throw new Error("no vault");
    const mnemonic = await decryptSecret(vault, password);
    await this.session.set(SESSION_MNEMONIC_KEY, mnemonic);
    return mnemonic;
  }

  /** The mnemonic left in session storage by an earlier unlock, if the worker restarted while unlocked. */
  async restore(): Promise<string | undefined> {
    const value = await this.session.get<unknown>(SESSION_MNEMONIC_KEY);
    return typeof value === "string" ? value : undefined;
  }

  async lock(): Promise<void> {
    await this.session.remove(SESSION_MNEMONIC_KEY);
  }

  /** Removes the encrypted seed. Only valid when locked; the caller confirms with the user first. */
  async destroy(): Promise<void> {
    await this.session.remove(SESSION_MNEMONIC_KEY);
    await this.local.remove(VAULT_KEY);
  }
}
