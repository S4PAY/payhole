import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { privateKeyToAccount } from "viem/accounts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Blocklist } from "../src/blocklist.js";
import { Hints } from "../src/hints.js";
import { buildLedger, buildRadar } from "../src/radar.js";
import { createReporter } from "../src/reports.js";
import { signDelegatedMessage, signProof, signSwarmMessage, verifySwarmMessage } from "../src/swarm/messages.js";

const HOUR = 3_600_000;
const NOW = 1_800_000_000_000;
const holder = privateKeyToAccount(`0x${"11".repeat(32)}`);
const phone = privateKeyToAccount(`0x${"33".repeat(32)}`);
const stranger = privateKeyToAccount(`0x${"22".repeat(32)}`);
const tierOf = (address: string): Promise<number> => Promise.resolve(address.toLowerCase() === holder.address.toLowerCase() ? 1 : 0);
const options = { tierOf, minTier: 1, clock: () => NOW };

describe("delegated signatures", () => {
  it("accepts a body signed by a key the holder delegated, whoever relays it", async () => {
    const proof = await signProof(holder, phone.address, "2026-09-01T00:00:00.000Z");
    const message = await signDelegatedMessage(phone, proof, { type: "flag", domain: "kit.example", reason: "drainer kit", ts: NOW, category: "drainer" });
    expect(message.delegate).toBe(phone.address);
    expect(message.reporter).toBe(holder.address);
    const result = await verifySwarmMessage(JSON.stringify(message), "12D3KooWRelayRelayRelayRelayRelayRelayRelayRelay", options);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.message).toMatchObject({ reporter: holder.address, delegate: phone.address, body: { domain: "kit.example" } });
  });

  it("refuses a delegate the holder never named, a stranger's proof, a holder without a tier, and delegates when told to", async () => {
    const proof = await signProof(holder, phone.address);
    const forged = await signDelegatedMessage(phone, proof, { type: "flag", domain: "kit.example", reason: "x", ts: NOW });
    const other = { ...forged, delegate: stranger.address };
    expect(await verifySwarmMessage(JSON.stringify(other), "peer", options)).toMatchObject({ ok: false, reason: "peer_mismatch" });
    const strangersProof = await signProof(stranger, phone.address);
    const strangersMessage = await signDelegatedMessage(phone, strangersProof, { type: "flag", domain: "kit.example", reason: "x", ts: NOW });
    expect(await verifySwarmMessage(JSON.stringify(strangersMessage), "peer", options)).toMatchObject({ ok: false, reason: "tier_too_low" });
    const signedByOther = { ...forged, signature: (await signSwarmMessage(holder, await signProof(holder, "12D3KooWDpJ7As7BWAwRMfu1VU2WCqNjvq387JEYKDBj4kx6nXTN"), forged.body)).signature };
    expect(await verifySwarmMessage(JSON.stringify(signedByOther), "peer", options)).toMatchObject({ ok: false, reason: "bad_signature" });
    expect(await verifySwarmMessage(JSON.stringify(forged), "peer", { ...options, allowDelegates: false })).toMatchObject({ ok: false, reason: "delegate_refused" });
  });
});

describe("hints", () => {
  let dir = "";
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "sinkhole-hints-"));
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("counts reports per name, keeps a few reasons and the leading category, evicts the oldest, and survives a restart", async () => {
    let now = NOW;
    const path = join(dir, "hints.json");
    const hints = new Hints({ path, limit: 2, clock: () => now });
    expect(hints.record("not a host")).toBeNull();
    expect(hints.record("Scam.Example", "drainer", "  fake airdrop  ")).toMatchObject({ domain: "scam.example", count: 1, reasons: ["fake airdrop"] });
    now += HOUR;
    expect(hints.record("scam.example", "phishing", "fake airdrop")?.count).toBe(2);
    expect(hints.record("scam.example", "drainer")?.categories).toEqual({ drainer: 2, phishing: 1 });
    expect(Hints.categoryOf(hints.get("scam.example")!)).toBe("drainer");
    hints.record("old.example", null, "", NOW - HOUR);
    hints.record("new.example");
    expect(hints.size).toBe(2);
    expect(hints.get("old.example")).toBeUndefined();
    expect(hints.recent(0).map((hint) => hint.domain)).toEqual(["scam.example", "new.example"]);
    expect(hints.recent(now + 1)).toEqual([]);
    expect(hints.remove("New.Example")).toBe(true);
    expect(hints.remove("new.example")).toBe(false);
    expect(hints.size).toBe(1);
    await hints.flush();
    const reloaded = await Hints.load({ path, clock: () => now });
    expect(reloaded.get("scam.example")).toMatchObject({ count: 3, firstAt: NOW, lastAt: now });
    expect(JSON.parse(await readFile(path, "utf8"))).toMatchObject({ version: 1 });
  });
});

describe("reports", () => {
  it("counts a plain report as a hint, answers for names already decided, and rejects nonsense", async () => {
    const blocklist = new Blocklist({ threshold: 2, ttlMs: 30 * 24 * HOUR, clock: () => NOW });
    blocklist.addManual("blocked.example", "manual", NOW, "phishing");
    blocklist.setAllowlist(new Set(["sites.google.com"]));
    const hints = new Hints({ clock: () => NOW });
    const report = createReporter({ blocklist, hints, acceptDelegates: false, clock: () => NOW });
    expect(await report({ name: "Fresh.Example", category: "drainer", reason: "asked for my seed" })).toEqual({ status: "hinted", domain: "fresh.example", hints: 1 });
    expect(await report({ name: "fresh.example" })).toEqual({ status: "hinted", domain: "fresh.example", hints: 2 });
    expect(await report({ name: "blocked.example" })).toEqual({ status: "already_blocked", domain: "blocked.example" });
    expect(await report({ name: "sites.google.com" })).toEqual({ status: "allowlisted", domain: "sites.google.com" });
    expect(await report({ name: "not a host" })).toMatchObject({ status: "invalid" });
    expect(await report({})).toMatchObject({ status: "invalid" });
    expect(await report({ message: { kind: "flag" } })).toMatchObject({ status: "rejected" });
    expect(blocklist.domains().has("fresh.example")).toBe(false);
  });

  it("turns a signed report into a flag, relays it, and confirms on the fast lane, then writes the ledger", async () => {
    let now = NOW;
    const blocklist = new Blocklist({ threshold: 5, ttlMs: 30 * 24 * HOUR, fastLane: { threshold: 2, categories: ["drainer", "infra"] }, clock: () => now });
    blocklist.setListCategoryResolver((domain) => (domain === "listed.example" ? "phishing" : null));
    blocklist.setLists(new Set(["listed.example"]));
    const hints = new Hints({ clock: () => now });
    const relayed: unknown[] = [];
    const report = createReporter({
      blocklist,
      hints,
      verify: (raw) => verifySwarmMessage(raw, "", { ...options, clock: () => now }),
      publish: (message) => {
        relayed.push(message);
        return Promise.resolve(1);
      },
      acceptDelegates: true,
      clock: () => now,
    });
    const proof = await signProof(holder, phone.address);
    const fresh = await signDelegatedMessage(phone, proof, { type: "flag", domain: "kit.example", reason: "drainer kit", ts: now, category: "drainer" });
    expect(await report({ message: fresh })).toEqual({ status: "flagged", domain: "kit.example", reporters: 1 });
    now += HOUR;
    const listed = await signDelegatedMessage(phone, proof, { type: "flag", domain: "listed.example", reason: "same kit", ts: now, category: "drainer" });
    expect(await report({ message: listed })).toEqual({ status: "confirmed", domain: "listed.example", reporters: 1 });
    expect(relayed).toHaveLength(2);
    expect(blocklist.curated().has("listed.example")).toBe(true);
    const local = createReporter({ blocklist, hints, verify: (raw) => verifySwarmMessage(raw, "", { ...options, clock: () => now }), publish: (message) => { relayed.push(message); return Promise.resolve(1); }, acceptDelegates: true, relayDelegates: false, clock: () => now });
    const kept = await signDelegatedMessage(phone, proof, { type: "flag", domain: "kept.example", reason: "local only", ts: now, category: "drainer" });
    expect(await local({ message: kept })).toEqual({ status: "flagged", domain: "kept.example", reporters: 1 });
    expect(relayed).toHaveLength(2);
    const strangers = await signDelegatedMessage(phone, await signProof(stranger, phone.address), { type: "flag", domain: "kit.example", reason: "x", ts: now });
    const refused = await report({ message: strangers });
    expect(refused.status).toBe("rejected");
    if (refused.status === "rejected") expect(refused.detail).toContain("tier_too_low");

    expect(buildLedger(blocklist, 0)).toEqual([{ reporter: holder.address.toLowerCase(), confirmed: 1, domains: [{ domain: "listed.example", category: "drainer", at: now }] }]);
    expect(buildLedger(blocklist, now + 1)).toEqual([]);

    hints.record("many.example", "phishing", "seen in a dm", now);
    hints.record("many.example", "phishing", "", now);
    const radar = buildRadar({ blocklist, hints, lists: { list: () => [], historyOf: () => [], domains: () => new Set() }, clock: () => now });
    expect(radar.hints).toEqual({ names: 1, reports: 2, top: [{ domain: "many.example", count: 2, category: "phishing", lastAt: now }] });
  });
});
