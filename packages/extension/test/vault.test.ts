import { beforeEach, describe, expect, it } from "vitest";
import { fakeBrowser } from "wxt/testing/fake-browser";
import { localStore, memoryStore, sessionStore } from "../lib/storage";
import { decryptSecret, encryptSecret, isEncryptedVault, PBKDF2_ITERATIONS, SESSION_MNEMONIC_KEY, VAULT_KEY, VaultStore, WrongPasswordError } from "../lib/vault";

const MNEMONIC = "test test test test test test test test test test test junk";

describe("vault encryption", () => {
  it("round-trips a secret with the production iteration count", async () => {
    const vault = await encryptSecret(MNEMONIC, "correct horse battery");
    expect(vault.version).toBe(1);
    expect(vault.iterations).toBe(PBKDF2_ITERATIONS);
    expect(vault.iterations).toBeGreaterThanOrEqual(600_000);
    expect(atob(vault.salt)).toHaveLength(16);
    expect(atob(vault.iv)).toHaveLength(12);
    expect(vault.ciphertext).not.toContain("test");
    expect(await decryptSecret(vault, "correct horse battery")).toBe(MNEMONIC);
  });

  it("rejects a wrong password", async () => {
    const vault = await encryptSecret(MNEMONIC, "right", 2_000);
    await expect(decryptSecret(vault, "wrong")).rejects.toBeInstanceOf(WrongPasswordError);
    await expect(decryptSecret({ ...vault, ciphertext: vault.ciphertext.replace(/.$/, "A") }, "right")).rejects.toBeInstanceOf(WrongPasswordError);
  });

  it("uses a fresh salt and iv every time", async () => {
    const a = await encryptSecret(MNEMONIC, "pw", 1_000);
    const b = await encryptSecret(MNEMONIC, "pw", 1_000);
    expect(a.salt).not.toBe(b.salt);
    expect(a.iv).not.toBe(b.iv);
    expect(a.ciphertext).not.toBe(b.ciphertext);
  });

  it("recognises stored vaults", () => {
    expect(isEncryptedVault({ version: 1, salt: "a", iv: "b", ciphertext: "c", iterations: 1 })).toBe(true);
    expect(isEncryptedVault({ version: 2, salt: "a", iv: "b", ciphertext: "c", iterations: 1 })).toBe(false);
    expect(isEncryptedVault(null)).toBe(false);
  });
});

describe("VaultStore", () => {
  beforeEach(() => fakeBrowser.reset());

  it("keeps the encrypted seed in local storage and the mnemonic in session storage only", async () => {
    const store = new VaultStore(localStore, sessionStore);
    expect(await store.exists()).toBe(false);
    await store.create(MNEMONIC, "password123", 1_000);
    expect(await store.exists()).toBe(true);
    const local = await fakeBrowser.storage.local.get(VAULT_KEY);
    expect(isEncryptedVault(local[VAULT_KEY])).toBe(true);
    expect(JSON.stringify(local)).not.toContain("junk");
    const session = await fakeBrowser.storage.session.get(SESSION_MNEMONIC_KEY);
    expect(session[SESSION_MNEMONIC_KEY]).toBe(MNEMONIC);

    await store.lock();
    expect((await fakeBrowser.storage.session.get(SESSION_MNEMONIC_KEY))[SESSION_MNEMONIC_KEY]).toBeUndefined();
    expect(await store.restore()).toBeUndefined();

    await expect(store.unlock("nope")).rejects.toBeInstanceOf(WrongPasswordError);
    expect(await store.unlock("password123")).toBe(MNEMONIC);
    expect(await store.restore()).toBe(MNEMONIC);
  });

  it("refuses to overwrite an existing vault and short passwords", async () => {
    const store = new VaultStore(memoryStore(), memoryStore());
    await expect(store.create(MNEMONIC, "short", 1_000)).rejects.toThrow(/8 characters/);
    await store.create(MNEMONIC, "password123", 1_000);
    await expect(store.create(MNEMONIC, "password123", 1_000)).rejects.toThrow(/already exists/);
    await store.lock();
    await store.destroy();
    expect(await store.exists()).toBe(false);
  });
});
