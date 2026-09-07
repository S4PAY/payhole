import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { privateKeyToAccount } from "viem/accounts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Blocklist, type Confirmation } from "../src/blocklist.js";
import { scoreEvidence } from "../src/evidence.js";
import { Hints, type Hint } from "../src/hints.js";
import { createReporter, hintText } from "../src/reports.js";
import { BOUNTY_USDG, DAILY_CAP, MIN_PAYOUT_USDG, Rewards, type ListArrival } from "../src/rewards.js";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const NOW = 1_800_000_000_000;
const A = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const B = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const C = "0xcccccccccccccccccccccccccccccccccccccccc";
const WALLET = "0x1111111111111111111111111111111111111111";

function confirmation(domain: string, at: number, reporters: string[], category: Confirmation["category"] = "drainer"): Confirmation {
  return { domain, category, reporters: reporters.length, at, firstReporter: reporters[0] ?? null, reporterSet: reporters };
}

function hint(domain: string, at: number, category: Hint["categories"], firstBy?: Hint["firstBy"]): Hint {
  return { domain, count: 1, firstAt: at, lastAt: at, categories: category, reasons: [], ...(firstBy ? { firstBy } : {}) };
}

function rewardsWith(confirmations: Confirmation[], hints: Hint[], arrivals: Record<string, ListArrival> = {}, allow: string[] = [], now = NOW): Rewards {
  return new Rewards(
    {
      confirmations: (since) => confirmations.filter((entry) => entry.at >= since),
      hints: () => hints,
      listArrival: (domain) => arrivals[domain] ?? null,
      isBlocked: () => true,
      isAllowlisted: (domain) => allow.includes(domain),
    },
    { clock: () => now },
  );
}

describe("bounty ledger", () => {
  it("pays a first reporter confirmed by two others, holds one confirmed by one, and voids after two weeks", () => {
    const confirmed = confirmation("kit.example", NOW - HOUR, [A, B, C]);
    const thin = confirmation("thin.example", NOW - HOUR, [A, B], "phishing");
    const old = confirmation("old.example", NOW - 20 * DAY, [A, B]);
    const rewards = rewardsWith([confirmed, thin, old], []);
    const entries = rewards.entries();
    expect(entries.find((entry) => entry.domain === "kit.example")).toMatchObject({ status: "payable", amount: 0.5, wallet: A, corroboration: "swarm:3", source: "flag" });
    expect(entries.find((entry) => entry.domain === "thin.example")).toMatchObject({ status: "pending", amount: 0.3 });
    expect(entries.find((entry) => entry.domain === "old.example")).toMatchObject({ status: "void" });
    expect(rewards.balance(A)).toMatchObject({ owed: 0.5, paid: 0, pending: 1 });
  });

  it("lets a public list corroborate a lone confirmation and a phone's hint, honours first-only, and voids allowlisted names", () => {
    const lone = confirmation("lone.example", NOW - HOUR, [A, B]);
    const listed = hint("early.example", NOW - 3 * DAY, { phishing: 2 }, { key: "0xKEY", payTo: WALLET, at: NOW - 3 * DAY });
    const late = hint("late.example", NOW - HOUR, { drainer: 1 }, { key: "0xKEY", payTo: WALLET, at: NOW - HOUR });
    const arrivals = { "lone.example": { at: NOW - HOUR / 2, label: "list-a" }, "early.example": { at: NOW - DAY, label: "list-b" }, "late.example": { at: NOW - 2 * DAY, label: "list-b" } };
    const rewards = rewardsWith([lone], [listed, late], arrivals, ["lone.example"]);
    const entries = rewards.entries();
    expect(entries.find((entry) => entry.domain === "lone.example")?.status).toBe("void");
    expect(entries.find((entry) => entry.domain === "early.example")).toMatchObject({ status: "payable", amount: 0.3, wallet: WALLET, key: "0xKEY", source: "hint", corroboration: "list:list-b" });
    expect(entries.find((entry) => entry.domain === "late.example")?.status).toBe("pending");
  });

  it("caps paid reports per wallet per day, assigns a wallet to an old key, takes claims, and marks payments", async () => {
    const hints: Hint[] = [];
    for (let index = 0; index < DAILY_CAP + 2; index += 1) {
      const at = NOW - 5 * DAY + index * 60_000;
      hints.push(hint(`n${index}.example`, at, { drainer: 1 }, { key: "0xKEY", payTo: null, at }));
    }
    const arrivals = Object.fromEntries(hints.map((entry) => [entry.domain, { at: entry.firstAt + HOUR, label: "list" }]));
    const rewards = rewardsWith([], hints, arrivals);
    expect(rewards.entries().every((entry) => entry.wallet === null)).toBe(true);
    expect(rewards.balance(WALLET).owed).toBe(0);
    await rewards.assignWallet("0xkey", WALLET);
    const entries = rewards.entries();
    expect(entries.filter((entry) => entry.status === "payable")).toHaveLength(DAILY_CAP);
    expect(entries.filter((entry) => entry.status === "capped")).toHaveLength(2);
    const balance = rewards.balance(WALLET);
    expect(balance.owed).toBe(Math.round(DAILY_CAP * BOUNTY_USDG.drainer * 100) / 100);
    expect(balance.owed).toBeGreaterThanOrEqual(MIN_PAYOUT_USDG - 5);

    const first = await rewards.claim(WALLET);
    expect(first.ok).toBe(balance.owed >= MIN_PAYOUT_USDG);
    if (first.ok) {
      expect(await rewards.claim(WALLET)).toMatchObject({ ok: false, reason: "already_open" });
      const paid = await rewards.markPaid(WALLET, `0x${"ab".repeat(32)}`);
      expect(paid).toHaveLength(DAILY_CAP);
      expect(rewards.balance(WALLET)).toMatchObject({ owed: 0, paid: balance.owed });
      expect(rewards.openClaim(WALLET)).toBeNull();
      expect(rewards.allClaims()[0]).toMatchObject({ wallet: WALLET, tx: `0x${"ab".repeat(32)}` });
    } else {
      expect(first).toMatchObject({ ok: false, reason: "below_minimum" });
    }
  });
});

describe("signed hints", () => {
  let dir = "";
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "sinkhole-rewards-"));
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("attaches the phone's key and rewards wallet to the first report only when the signature is the key's", async () => {
    const phone = privateKeyToAccount(`0x${"33".repeat(32)}`);
    const other = privateKeyToAccount(`0x${"44".repeat(32)}`);
    let now = NOW;
    const blocklist = new Blocklist({ threshold: 2, ttlMs: 30 * DAY, clock: () => now });
    const hints = new Hints({ clock: () => now });
    const seen: string[] = [];
    const report = createReporter({ blocklist, hints, acceptDelegates: false, clock: () => now, onHint: (domain) => seen.push(domain) });
    const sign = async (account: typeof phone, domain: string, ts: number, payTo: string | null) => account.signMessage({ message: hintText(domain, "drainer", "seed form", ts, payTo) });

    const forged = await report({ name: "scam.example", category: "drainer", reason: "seed form", key: phone.address, payTo: WALLET, ts: now, signature: await sign(other, "scam.example", now, WALLET) });
    expect(forged).toMatchObject({ status: "invalid", detail: "signature was not made by key" });
    const stale = await report({ name: "scam.example", category: "drainer", reason: "seed form", key: phone.address, payTo: WALLET, ts: now - HOUR, signature: await sign(phone, "scam.example", now - HOUR, WALLET) });
    expect(stale).toMatchObject({ status: "invalid" });

    const good = await report({ name: "Scam.Example", category: "drainer", reason: "seed form", key: phone.address, payTo: WALLET, ts: now, signature: await sign(phone, "scam.example", now, WALLET) });
    expect(good).toEqual({ status: "hinted", domain: "scam.example", hints: 1 });
    expect(hints.get("scam.example")?.firstBy).toEqual({ key: phone.address, payTo: WALLET, at: now });
    expect(seen).toEqual(["scam.example"]);

    now += HOUR;
    const second = await report({ name: "scam.example", category: "drainer", reason: "seed form", key: other.address, payTo: other.address, ts: now, signature: await sign(other, "scam.example", now, other.address) });
    expect(second).toEqual({ status: "hinted", domain: "scam.example", hints: 2 });
    expect(hints.get("scam.example")?.firstBy?.key).toBe(phone.address);
    expect(seen).toHaveLength(1);
    expect(await report({ name: "plain.example" })).toEqual({ status: "hinted", domain: "plain.example", hints: 1 });
    expect(hints.get("plain.example")?.firstBy).toBeUndefined();
  });
});

describe("evidence scoring", () => {
  it("adds up the marks a person would look for and never leaves the 0 to 100 range", () => {
    const html = `<html><head><title>MetaMask Wallet Verification</title></head><body>Connect wallet to claim your airdrop. Enter your secret recovery phrase. <script>window.ethereum.request({method:'eth_requestAccounts'}); setApprovalForAll(); eval(atob('x')); eval(atob('y')); eval(atob('z'))</script></body></html>`;
    const scored = scoreEvidence({ domain: "metamask-verify.pages.dev", resolves: true, html, status: 200, ageDays: 2, certDays: 1, now: NOW });
    expect(scored.score).toBe(100);
    expect(scored.brands).toEqual(["MetaMask"]);
    expect(scored.freeHosting).toBe("pages.dev");
    expect(scored.page).toEqual({ status: 200, title: "MetaMask Wallet Verification" });
    expect(scored.marks).toEqual(expect.arrayContaining(["asks for a seed phrase or private key", "wallet connection tied to a claim, airdrop, or mint", "registered 2 days ago"]));
    const dead = scoreEvidence({ domain: "gone.example", resolves: false, html: null, status: null, ageDays: null, certDays: null, now: NOW });
    expect(dead).toMatchObject({ score: 0, marks: ["does not resolve right now"], page: null });
  });
});
