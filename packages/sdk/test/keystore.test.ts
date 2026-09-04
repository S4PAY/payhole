import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { defaultKeyStorePath, KeyStore, KeyStoreError } from "../src/cli/keystore.js";

let dir: string;
let store: KeyStore;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "payhole-keystore-"));
  store = new KeyStore(join(dir, "home", "keys.json"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("KeyStore", () => {
  it("creates a key with a fresh address, zero spent, and the cap", () => {
    const key = store.create("research", 5_000_000n);
    expect(key.name).toBe("research");
    expect(key.address).toBe(privateKeyToAccount(key.privateKey).address);
    expect(key.cap).toBe(5_000_000n);
    expect(key.spent).toBe(0n);
    expect(store.get("research")).toEqual(key);
    expect(store.list()).toHaveLength(1);
    const raw = JSON.parse(readFileSync(store.path, "utf8")) as { version: number; keys: { cap: string; spent: string }[] };
    expect(raw.version).toBe(1);
    expect(raw.keys[0]?.cap).toBe("5000000");
  });

  it("stores an imported key under its own address", () => {
    const privateKey = generatePrivateKey();
    const key = store.create("agent", 1_000_000n, privateKey);
    expect(key.privateKey).toBe(privateKey);
    expect(key.address).toBe(privateKeyToAccount(privateKey).address);
  });

  it("refuses duplicate names, bad names, and empty caps", () => {
    store.create("research", 5_000_000n);
    expect(() => store.create("research", 1n)).toThrow(KeyStoreError);
    expect(() => store.create("bad name", 1n)).toThrow(KeyStoreError);
    expect(() => store.create("", 1n)).toThrow(KeyStoreError);
    expect(() => store.create("zero", 0n)).toThrow(KeyStoreError);
    expect(store.list()).toHaveLength(1);
  });

  it("accounts spend against the cap and persists it", () => {
    store.create("research", 1_000_000n);
    store.recordSpend("research", 250_000n);
    expect(store.recordSpend("research", 250_000n).spent).toBe(500_000n);
    expect(new KeyStore(store.path).get("research")?.spent).toBe(500_000n);
    expect(() => store.recordSpend("research", 500_001n)).toThrow(KeyStoreError);
    expect(() => store.recordSpend("missing", 1n)).toThrow(KeyStoreError);
    expect(store.get("research")?.spent).toBe(500_000n);
  });

  it("keeps the directory private and the file owner-only", () => {
    store.create("research", 5_000_000n);
    if (process.platform === "win32") return;
    expect(statSync(join(dir, "home")).mode & 0o777).toBe(0o700);
    expect(statSync(store.path).mode & 0o777).toBe(0o600);
    expect(existsSync(`${store.path}.${process.pid}.tmp`)).toBe(false);
  });

  it("reports an unreadable file instead of wiping it", () => {
    const broken = new KeyStore(join(dir, "broken.json"));
    writeFileSync(broken.path, "{not json");
    expect(() => broken.list()).toThrow(KeyStoreError);
    expect(readFileSync(broken.path, "utf8")).toBe("{not json");
  });

  it("defaults to $PAYHOLE_HOME/keys.json", () => {
    expect(defaultKeyStorePath({ PAYHOLE_HOME: "/tmp/ph" })).toBe(join("/tmp/ph", "keys.json"));
    expect(defaultKeyStorePath({})).toMatch(/\.payhole[\\/]keys\.json$/);
  });
});
