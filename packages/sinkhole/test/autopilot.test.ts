import { describe, expect, it } from "vitest";
import { decide, probeDue } from "../src/autopilot.js";
import type { Evidence } from "../src/evidence.js";
import { Hints } from "../src/hints.js";
import { Rewards, type RewardsFile } from "../src/rewards.js";

const NOW = 1_800_000_000_000;
const HOUR = 60 * 60 * 1000;
const OPTIONS = { confirmScore: 60, deadHours: 20 };

function evidence(score: number, resolves: boolean, marks: string[] = [], at = NOW): Evidence {
  return { checkedAt: at, score, marks, resolves, brands: [], freeHosting: null, ageDays: null, certDays: null, page: null };
}

describe("the node's own verdicts", () => {
  it("confirms strong evidence, closes a name dead on two checks a day apart, and waits on the rest", () => {
    expect(decide({ domain: "x.example" }, OPTIONS)).toEqual({ action: "wait", reason: "no evidence yet" });
    const strong = evidence(70, true, ["asks for a seed phrase or private key", "registered 2 days ago", "hosted on pages.dev, a free platform"]);
    expect(decide({ domain: "kit.example", evidence: strong, probes: [{ at: NOW, resolves: true, score: 70 }] }, OPTIONS)).toEqual({ action: "confirm", note: "evidence 70: asks for a seed phrase or private key; registered 2 days ago; hosted on pages.dev, a free platform" });
    expect(decide({ domain: "kit.example", evidence: strong }, { ...OPTIONS, confirmScore: 0 }).action).toBe("wait");
    expect(decide({ domain: "weak.example", evidence: evidence(35, true, ["asks for a seed phrase or private key"]) }, OPTIONS)).toMatchObject({ action: "wait", reason: "evidence 35, below 60" });
    const dead = evidence(0, false, ["does not resolve right now"], NOW + 24 * HOUR);
    expect(decide({ domain: "dead.example", evidence: dead, probes: [{ at: NOW, resolves: false, score: 0 }] }, OPTIONS)).toMatchObject({ action: "wait", reason: expect.stringContaining("checking again") as string });
    expect(decide({ domain: "dead.example", evidence: dead, probes: [{ at: NOW, resolves: false, score: 0 }, { at: NOW + 24 * HOUR, resolves: false, score: 0 }] }, OPTIONS)).toEqual({ action: "close", note: "did not resolve on two checks 24 hours apart" });
    expect(decide({ domain: "flap.example", evidence: dead, probes: [{ at: NOW, resolves: true, score: 10 }, { at: NOW + 24 * HOUR, resolves: false, score: 0 }] }, OPTIONS).action).toBe("wait");
    expect(decide({ domain: "soon.example", evidence: dead, probes: [{ at: NOW, resolves: false, score: 0 }, { at: NOW + 2 * HOUR, resolves: false, score: 0 }] }, OPTIONS).action).toBe("wait");
    expect(probeDue(undefined, NOW, OPTIONS)).toBe(true);
    expect(probeDue([{ at: NOW, resolves: false, score: 0 }], NOW + 19 * HOUR, OPTIONS)).toBe(false);
    expect(probeDue([{ at: NOW, resolves: false, score: 0 }], NOW + 20 * HOUR, OPTIONS)).toBe(true);
  });

  it("keeps the last probes on a hint across loads", () => {
    const hints = new Hints({ clock: () => NOW });
    hints.record("dead.example", "phishing", "", NOW);
    for (let index = 0; index < 12; index += 1) hints.setEvidence("dead.example", evidence(0, false, [], NOW + index * HOUR));
    expect(hints.get("dead.example")?.probes).toHaveLength(10);
    expect(hints.get("dead.example")?.probes?.[0]?.at).toBe(NOW + 2 * HOUR);
    const restored = new Hints({ clock: () => NOW }, JSON.parse(JSON.stringify({ version: 1, hints: hints.all() })) as ConstructorParameters<typeof Hints>[1]);
    expect(restored.get("dead.example")?.probes).toHaveLength(10);
  });

  it("marks who decided, so the ledger can say evidence instead of owner", async () => {
    const rewards = new Rewards(
      { confirmations: () => [], flags: () => [], hints: () => [{ domain: "kit.example", count: 1, firstAt: NOW, lastAt: NOW, categories: { drainer: 1 }, reasons: [], firstBy: { key: "0xKEY", payTo: "0x1111111111111111111111111111111111111111", at: NOW } }], listArrival: () => null, isBlocked: () => false, isAllowlisted: () => false, evidenceOf: () => null },
      { clock: () => NOW },
    );
    const confirmed = await rewards.review("kit.example", "confirm", "evidence 70: seed phrase", NOW, "evidence");
    expect(confirmed).toMatchObject({ status: "payable", corroboration: "evidence", review: { verdict: "confirm", by: "evidence" } });
    const state = JSON.parse(JSON.stringify(rewards.toJSON())) as RewardsFile;
    expect(state.reviews?.["kit.example"]?.by).toBe("evidence");
  });
});
