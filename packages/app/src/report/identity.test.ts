import { describe, expect, it } from "vitest";
import { buildDelegatedFlag, canonicalJson, checksumAddress, membershipText, parseProof, privateKeyToAddress, recoverMessageSigner, signMessage } from "./identity";

const phone = new Uint8Array(32).fill(0x33);
const holder = new Uint8Array(32).fill(0x11);

describe("reporter identity", () => {
  it("derives checksummed addresses and round-trips personal signatures", () => {
    expect(checksumAddress("0x52908400098527886e0f7030069857d2e4169ee7")).toBe("0x52908400098527886E0F7030069857D2E4169EE7");
    expect(checksumAddress("0xde709f2102306220921060314715629080e2fb77")).toBe("0xde709f2102306220921060314715629080e2fb77");
    const address = privateKeyToAddress(phone);
    expect(address).toMatch(/^0x[0-9a-fA-F]{40}$/);
    const signature = signMessage(phone, "hello payhole");
    expect(signature).toMatch(/^0x[0-9a-f]{128}(1b|1c)$/);
    expect(recoverMessageSigner("hello payhole", signature)).toBe(address);
    expect(recoverMessageSigner("other text", signature)).not.toBe(address);
    expect(recoverMessageSigner("hello payhole", "0x00")).toBeNull();
  });

  it("matches the node's canonical JSON", () => {
    expect(canonicalJson({ b: 1, a: [{ z: null, y: "x" }], skip: undefined })).toBe('{"a":[{"y":"x","z":null}],"b":1}');
  });

  it("accepts a proof the holder signed for this key and refuses every other", () => {
    const phoneAddress = privateKeyToAddress(phone);
    const holderAddress = privateKeyToAddress(holder);
    const issuedAt = "2026-09-07T00:00:00.000Z";
    const proof = { peerId: phoneAddress, address: holderAddress, issuedAt, signature: signMessage(holder, membershipText(phoneAddress, holderAddress, issuedAt)) };
    expect(parseProof(JSON.stringify(proof), phoneAddress)).toEqual({ ok: true, proof });
    expect(parseProof("nope", phoneAddress).ok).toBe(false);
    const wrongKey = parseProof(JSON.stringify({ ...proof, peerId: holderAddress }), phoneAddress);
    expect(wrongKey.ok).toBe(false);
    if (!wrongKey.ok) expect(wrongKey.error).toContain("not for this phone");
    const wrongWallet = parseProof(JSON.stringify({ ...proof, address: phoneAddress }), phoneAddress);
    expect(wrongWallet.ok).toBe(false);
    if (!wrongWallet.ok) expect(wrongWallet.error).toContain("not made by the wallet");
    expect(parseProof(JSON.stringify({ ...proof, issuedAt: "later" }), phoneAddress).ok).toBe(false);

    const flag = buildDelegatedFlag(phone, proof, { type: "flag", domain: "kit.example", reason: "drainer kit", ts: 1_800_000_000_000, category: "drainer" });
    expect(flag).toMatchObject({ kind: "flag", reporter: holderAddress, delegate: phoneAddress, body: { domain: "kit.example", category: "drainer" } });
    expect(recoverMessageSigner(canonicalJson(flag.body), flag.signature)).toBe(phoneAddress);
    expect(() => buildDelegatedFlag(holder, proof, flag.body)).toThrow(/this phone/);
  });
});
