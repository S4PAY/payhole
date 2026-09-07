import { recoverMessageAddress } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { describe, expect, it } from "vitest";
import { ReporterStore, buildDelegatedFlag, canonicalJson, hintText, membershipText, parseProof, signHint } from "../lib/reporter";
import { memoryStore } from "../lib/storage";

const phone = privateKeyToAccount(generatePrivateKey());
const holder = privateKeyToAccount(generatePrivateKey());
const stranger = privateKeyToAccount(generatePrivateKey());

async function proofFor(peer: string, signer = holder): Promise<string> {
  const issuedAt = "2026-09-07T00:00:00.000Z";
  const signature = await signer.signMessage({ message: membershipText(peer, holder.address, issuedAt) });
  return JSON.stringify({ peerId: peer, address: holder.address, issuedAt, signature });
}

describe("the reporter identity", () => {
  it("signs hints the node can recover, for names and for addresses", async () => {
    expect(hintText("x.example", "phishing", "", 1, null)).toBe('{"category":"phishing","domain":"x.example","payTo":null,"reason":"","ts":1,"type":"hint"}');
    expect(canonicalJson({ b: [1, { z: 1, a: undefined }], a: "x" })).toBe('{"a":"x","b":[1,{"z":1}]}');
    const hint = await signHint(phone, "scam.example", "drainer", "seen in a dm", holder.address.toLowerCase(), 1_800_000_000_000);
    expect(hint).toMatchObject({ name: "scam.example", category: "drainer", reason: "seen in a dm", key: phone.address, payTo: holder.address, ts: 1_800_000_000_000 });
    expect(await recoverMessageAddress({ message: hintText("scam.example", "drainer", "seen in a dm", 1_800_000_000_000, holder.address), signature: hint.signature as `0x${string}` })).toBe(phone.address);
    const address = await signHint(phone, "0x101ce0cedd142f199c9ef61739ae59b6611a0fc0", "drainer", "", null);
    expect(address).toMatchObject({ address: "0x101ce0cedd142f199c9ef61739ae59b6611a0fc0", key: phone.address, payTo: null });
    expect(address.name).toBeUndefined();
  });

  it("accepts a proof signed by the wallet it names for this key, and refuses the rest", async () => {
    const good = await parseProof(await proofFor(phone.address), phone.address);
    expect(good.ok).toBe(true);
    if (good.ok) expect(good.proof.address).toBe(holder.address);
    const other = await parseProof(await proofFor(stranger.address), phone.address);
    expect(other).toMatchObject({ ok: false, error: expect.stringContaining("not for this browser's key") as string });
    const forged = await parseProof(await proofFor(phone.address, stranger), phone.address);
    expect(forged).toMatchObject({ ok: false, error: expect.stringContaining("not made by the wallet") as string });
    expect(await parseProof("nope", phone.address)).toMatchObject({ ok: false });
  });

  it("builds a delegated flag in the node's shape, signed by the key the proof names", async () => {
    const parsed = await parseProof(await proofFor(phone.address), phone.address);
    if (!parsed.ok) throw new Error(parsed.error);
    const flag = await buildDelegatedFlag(phone, parsed.proof, { type: "flag", domain: "kit.example", reason: "drainer kit", ts: 5, category: "drainer" });
    expect(flag).toMatchObject({ kind: "flag", reporter: holder.address, delegate: phone.address, body: { type: "flag", domain: "kit.example", reason: "drainer kit", ts: 5, category: "drainer" } });
    expect(await recoverMessageAddress({ message: canonicalJson(flag.body), signature: flag.signature as `0x${string}` })).toBe(phone.address);
    await expect(buildDelegatedFlag(stranger, parsed.proof, { type: "flag", domain: "kit.example", reason: "", ts: 5 })).rejects.toThrow(/does not name/);
  });

  it("keeps the key, the proof, the wallet, and the reports across loads", async () => {
    const store = memoryStore();
    const first = new ReporterStore(store);
    await first.load();
    const address = first.address;
    expect(address).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(first.payTo).toBeNull();
    await first.setWallet(holder.address.toLowerCase());
    expect(first.payTo).toBe(holder.address);
    expect(first.walletIsOwn).toBe(true);
    await expect(first.setWallet("0x12")).rejects.toThrow(/not a wallet address/);
    await first.link(await proofFor(address!));
    expect(first.holder).toBe(holder.address);
    await first.remember("scam.example", "phishing", 10);
    await first.remember("other.example", null, 11);
    await first.remember("scam.example", "drainer", 12);
    expect(first.list().map((entry) => entry.domain)).toEqual(["scam.example", "other.example"]);

    const second = new ReporterStore(store);
    await second.load();
    expect(second.address).toBe(address);
    expect(second.holder).toBe(holder.address);
    expect(second.payTo).toBe(holder.address);
    expect(second.list()).toHaveLength(2);
    await second.setWallet("");
    expect(second.payTo).toBe(holder.address);
    expect(second.walletIsOwn).toBe(false);
    await second.unlink();
    expect(second.payTo).toBeNull();
  });
});
