import { describe, expect, it } from "vitest";
import { agentAccount, agentPath, isValidMnemonic, newMnemonic, normalizeMnemonic, normalizeOrigin, originAccount, originPrivateKey, ownerAccount, seedFromMnemonic } from "../lib/keys";

const MNEMONIC = "test test test test test test test test test test test junk";

describe("owner and agent keys", () => {
  it("derives the owner at m/44'/60'/0'/0/0", () => {
    expect(ownerAccount(MNEMONIC).address).toBe("0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266");
  });

  it("derives agent keys on their own branch, deterministically", () => {
    expect(agentPath(0)).toBe("m/44'/60'/2'/0/0");
    expect(agentPath(7)).toBe("m/44'/60'/2'/0/7");
    expect(() => agentPath(-1)).toThrow();
    const a0 = agentAccount(MNEMONIC, 0);
    const a1 = agentAccount(MNEMONIC, 1);
    expect(a0.address).toBe(agentAccount(MNEMONIC, 0).address);
    expect(a0.address).not.toBe(a1.address);
    expect(a0.address).not.toBe(ownerAccount(MNEMONIC).address);
    expect(a0.getHdKey().privateKey).toHaveLength(32);
  });

  it("generates and validates mnemonics", () => {
    const m = newMnemonic();
    expect(m.split(" ")).toHaveLength(12);
    expect(isValidMnemonic(m)).toBe(true);
    expect(isValidMnemonic("  Test TEST test test test test test test test test test junk ")).toBe(true);
    expect(isValidMnemonic("test test test test test test test test test test test test")).toBe(false);
    expect(normalizeMnemonic("  A  b\nc ")).toBe("a b c");
  });
});

describe("per-origin keys", () => {
  it("normalises origins", () => {
    expect(normalizeOrigin("https://Example.COM/path?q=1")).toBe("https://example.com");
    expect(normalizeOrigin("http://example.com:8080/x")).toBe("http://example.com:8080");
    expect(normalizeOrigin("https://example.com:443/")).toBe("https://example.com");
    expect(() => normalizeOrigin("data:text/plain,hi")).toThrow();
  });

  it("is deterministic for an origin and distinct across origins", async () => {
    const seed = await seedFromMnemonic(MNEMONIC);
    expect(seed).toHaveLength(64);
    const a = await originAccount(seed, "https://a.example");
    const again = await originAccount(seed, "https://a.example");
    const b = await originAccount(seed, "https://b.example");
    const httpA = await originAccount(seed, "http://a.example");
    expect(a.address).toBe(again.address);
    expect(a.address).not.toBe(b.address);
    expect(a.address).not.toBe(httpA.address);
    expect(a.address).not.toBe(ownerAccount(MNEMONIC).address);
    const key = await originPrivateKey(seed, "https://a.example");
    expect(key).toMatch(/^0x[0-9a-f]{64}$/);
    const otherSeed = await seedFromMnemonic(newMnemonic());
    expect((await originAccount(otherSeed, "https://a.example")).address).not.toBe(a.address);
  });

  it("signs typed data for the origin's address", async () => {
    const seed = await seedFromMnemonic(MNEMONIC);
    const account = await originAccount(seed, "https://a.example");
    const signature = await account.signTypedData({
      domain: { name: "Global Dollar", version: "1", chainId: 4663, verifyingContract: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168" },
      types: { Ping: [{ name: "n", type: "uint256" }] },
      primaryType: "Ping",
      message: { n: 1n },
    });
    expect(signature).toMatch(/^0x[0-9a-f]{130}$/);
  });
});
