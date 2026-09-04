import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { Address, Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { PayholeError } from "../errors.js";
import { formatUsdg } from "../usdg.js";

/** A named session key with the spending cap the CLI enforces locally. Amounts are USDG base units. */
export interface StoredKey {
  name: string;
  privateKey: Hex;
  address: Address;
  cap: bigint;
  spent: bigint;
  createdAt: string;
}

interface StoredKeyJson {
  name: string;
  privateKey: string;
  address: string;
  cap: string;
  spent: string;
  createdAt: string;
}

interface StoreFile {
  version: 1;
  keys: StoredKeyJson[];
}

export class KeyStoreError extends PayholeError {
  override name = "KeyStoreError";
}

const NAME = /^[a-z0-9][a-z0-9_-]{0,31}$/i;

/** Where the key file lives: `$PAYHOLE_HOME/keys.json`, default `~/.payhole/keys.json`. */
export function defaultKeyStorePath(env: Record<string, string | undefined> = process.env): string {
  return join(env["PAYHOLE_HOME"] ?? join(homedir(), ".payhole"), "keys.json");
}

/** JSON file of named session keys, directory mode 700 and file mode 600. */
export class KeyStore {
  constructor(readonly path: string) {}

  list(): StoredKey[] {
    return this.read().keys.map(fromJson);
  }

  get(name: string): StoredKey | undefined {
    return this.list().find((k) => k.name === name);
  }

  /** Adds a key under `name`. Generates one when `privateKey` is omitted. */
  create(name: string, cap: bigint, privateKey: Hex = generatePrivateKey()): StoredKey {
    if (!NAME.test(name)) throw new KeyStoreError(`key name "${name}" must be 1 to 32 letters, digits, dashes, or underscores`);
    if (cap <= 0n) throw new KeyStoreError("cap must be more than zero");
    const store = this.read();
    if (store.keys.some((k) => k.name === name)) throw new KeyStoreError(`a key named "${name}" already exists in ${this.path}`);
    const key: StoredKey = {
      name,
      privateKey,
      address: privateKeyToAccount(privateKey).address,
      cap,
      spent: 0n,
      createdAt: new Date().toISOString(),
    };
    store.keys.push(toJson(key));
    this.write(store);
    return key;
  }

  /** Adds `amount` to what the key has spent; refuses to go past the cap. */
  recordSpend(name: string, amount: bigint): StoredKey {
    const store = this.read();
    const entry = store.keys.find((k) => k.name === name);
    if (!entry) throw new KeyStoreError(`no key named "${name}" in ${this.path}`);
    const key = fromJson(entry);
    if (key.spent + amount > key.cap) {
      throw new KeyStoreError(`key "${name}" can spend ${formatUsdg(key.cap - key.spent)} USDG more, not ${formatUsdg(amount)} USDG`);
    }
    key.spent += amount;
    Object.assign(entry, toJson(key));
    this.write(store);
    return key;
  }

  private read(): StoreFile {
    if (!existsSync(this.path)) return { version: 1, keys: [] };
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(this.path, "utf8"));
    } catch (error) {
      throw new KeyStoreError(`${this.path} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (!isStoreFile(parsed)) throw new KeyStoreError(`${this.path} is not a payhole key file`);
    return parsed;
  }

  private write(store: StoreFile): void {
    const dir = dirname(this.path);
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    chmodSync(dir, 0o700);
    const tmp = `${this.path}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(store, null, 2) + "\n", { mode: 0o600 });
    chmodSync(tmp, 0o600);
    renameSync(tmp, this.path);
  }
}

function isStoreFile(value: unknown): value is StoreFile {
  if (typeof value !== "object" || value === null) return false;
  const v = value as { version?: unknown; keys?: unknown };
  return v.version === 1 && Array.isArray(v.keys) && v.keys.every((k: unknown) => typeof k === "object" && k !== null && typeof (k as { name?: unknown }).name === "string");
}

function fromJson(k: StoredKeyJson): StoredKey {
  return { name: k.name, privateKey: k.privateKey as Hex, address: k.address as Address, cap: BigInt(k.cap), spent: BigInt(k.spent), createdAt: k.createdAt };
}

function toJson(k: StoredKey): StoredKeyJson {
  return { name: k.name, privateKey: k.privateKey, address: k.address, cap: k.cap.toString(), spent: k.spent.toString(), createdAt: k.createdAt };
}
