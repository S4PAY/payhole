import { describe, expect, it } from "vitest";
import { Blocklist, parseExtensionPush, type BlocklistState } from "../src/blocklist.js";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const A = "0xAAAAaaaaAAAAaaaaAAAAaaaaAAAAaaaaAAAAaaaa";
const B = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const C = "0xcccccccccccccccccccccccccccccccccccccccc";

function make(threshold = 3, ttlMs = 30 * DAY) {
  let now = 1_700_000_000_000;
  const blocklist = new Blocklist({ threshold, ttlMs, clock: () => now });
  const changes: number[] = [];
  blocklist.onChange(() => changes.push(now));
  return { blocklist, changes, advance: (ms: number) => (now += ms), now: () => now };
}

describe("Blocklist swarm threshold", () => {
  it("does not confirm on a single reporter, and the same reporter never counts twice", () => {
    const { blocklist, changes } = make(3);
    expect(blocklist.recordFlag("Drainer.Example", A, "drainer", 1)).toMatchObject({ domain: "drainer.example", reporters: 1, confirmed: false, changed: false });
    expect(blocklist.recordFlag("drainer.example", A, "again", 2)).toMatchObject({ reporters: 1, confirmed: false });
    expect(blocklist.recordFlag("drainer.example", A.toLowerCase(), "case", 3)).toMatchObject({ reporters: 1 });
    expect(blocklist.isConfirmed("drainer.example")).toBe(false);
    expect(blocklist.domains().size).toBe(0);
    expect(changes).toHaveLength(0);
    expect(blocklist.flagSummaries()).toEqual([expect.objectContaining({ domain: "drainer.example", reporters: 1, confirmed: false })]);
  });

  it("confirms once the threshold of distinct reporters is reached", () => {
    const { blocklist, changes } = make(3);
    blocklist.recordFlag("drainer.example", A, "r", 1);
    blocklist.recordFlag("drainer.example", B, "r", 1);
    expect(blocklist.isConfirmed("drainer.example")).toBe(false);
    const third = blocklist.recordFlag("drainer.example", C, "r", 1);
    expect(third).toMatchObject({ reporters: 3, confirmed: true, changed: true });
    expect(blocklist.swarmConfirmed()).toEqual(["drainer.example"]);
    expect(blocklist.merged()).toEqual([{ domain: "drainer.example", sources: ["swarm"], reason: "flagged by 3 reporters", category: "phishing" }]);
    expect(changes).toHaveLength(1);
    expect(blocklist.recordFlag("drainer.example", A, "r", 2)?.changed).toBe(false);
    expect(changes).toHaveLength(1);
  });

  it("expires stale flags by the local clock", () => {
    const { blocklist, changes, advance } = make(2, 30 * DAY);
    blocklist.recordFlag("old.example", A, "r", 1);
    advance(20 * DAY);
    blocklist.recordFlag("old.example", B, "r", 1);
    expect(blocklist.isConfirmed("old.example")).toBe(true);
    advance(11 * DAY);
    expect(blocklist.isConfirmed("old.example")).toBe(false);
    expect(blocklist.domains().has("old.example")).toBe(false);
    expect(blocklist.flagSummaries()).toEqual([expect.objectContaining({ reporters: 1 })]);
    expect(blocklist.prune()).toBe(true);
    expect(changes).toHaveLength(2);
    advance(20 * DAY);
    expect(blocklist.prune()).toBe(true);
    expect(blocklist.flagSummaries()).toEqual([]);
    expect(blocklist.toJSON().swarm).toEqual({});
  });

  it("rejects invalid hostnames and a threshold below one", () => {
    const { blocklist } = make(2);
    expect(blocklist.recordFlag("https://bad.example/x", A, "r", 1)).toBeNull();
    expect(blocklist.addManual("not a host")).toBeNull();
    expect(() => new Blocklist({ threshold: 0, ttlMs: 1 })).toThrow();
  });
});

describe("Blocklist local and manual sources", () => {
  it("always blocks local and manual entries and reports every source", () => {
    const { blocklist, changes } = make(5);
    const result = blocklist.setLocal({
      version: 1,
      updatedAt: "2026-09-04T00:00:00.000Z",
      entries: [
        { domain: "Tracker.Example", reason: "tracker", flaggedAt: "2026-09-04T00:00:00.000Z" },
        { domain: "shared.example", reason: "phish", flaggedAt: "2026-09-04T00:00:00.000Z" },
      ],
    });
    expect(result.added.map((e) => e.domain)).toEqual(["tracker.example", "shared.example"]);
    expect(changes).toHaveLength(1);
    expect(blocklist.addManual("shared.example", "operator")).toEqual({ domain: "shared.example", added: true });
    expect(changes).toHaveLength(1);
    expect(blocklist.addManual("Manual.Example")).toEqual({ domain: "manual.example", added: true });
    expect(blocklist.addManual("manual.example")).toEqual({ domain: "manual.example", added: false });
    blocklist.recordFlag("shared.example", A, "r", 1);
    expect(blocklist.merged()).toEqual([
      { domain: "manual.example", sources: ["manual"], reason: "manual", category: "other" },
      { domain: "shared.example", sources: ["local", "manual"], reason: "phish", category: "drainer" },
      { domain: "tracker.example", sources: ["local"], reason: "tracker", category: "drainer" },
    ]);
    expect(blocklist.counts()).toEqual({ local: 2, manual: 2, swarmConfirmed: 0, swarmFlagged: 1, list: 0, merged: 3 });

    const second = blocklist.setLocal({ version: 1, updatedAt: "2026-09-05T00:00:00.000Z", entries: [{ domain: "shared.example", reason: "phish", flaggedAt: "x" }] });
    expect(second.removed).toEqual(["tracker.example"]);
    expect(second.added).toEqual([]);
    expect(blocklist.domains()).toEqual(new Set(["manual.example", "shared.example"]));
    expect(blocklist.removeManual("shared.example")).toBe(true);
    expect(blocklist.domains().has("shared.example")).toBe(true);
    expect(blocklist.removeManual("shared.example")).toBe(false);
    expect(blocklist.localMeta().updatedAt).toBe("2026-09-05T00:00:00.000Z");
  });

  it("round-trips through the persisted state", () => {
    const { blocklist } = make(2);
    blocklist.setLocal({ version: 1, updatedAt: "2026-09-04T00:00:00.000Z", entries: [{ domain: "local.example", reason: "r", flaggedAt: "2026-09-04T00:00:00.000Z" }] });
    blocklist.addManual("manual.example");
    blocklist.recordFlag("swarm.example", A, "r", 1);
    blocklist.recordFlag("swarm.example", B, "r", 1);
    const restored = new Blocklist({ threshold: 2, ttlMs: 30 * DAY, clock: () => 1_700_000_000_000 }, JSON.parse(JSON.stringify(blocklist.toJSON())) as BlocklistState);
    expect(restored.merged()).toEqual(blocklist.merged());
    expect(restored.flagSummaries()).toEqual(blocklist.flagSummaries());
  });
});

describe("parseExtensionPush", () => {
  it("accepts a valid push, dropping invalid hostnames and duplicates", () => {
    const parsed = parseExtensionPush({
      version: 1,
      updatedAt: "2026-09-04T10:00:00.000Z",
      entries: [
        { domain: "A.example", reason: "one", flaggedAt: "2026-09-04T09:00:00.000Z" },
        { domain: "a.example", reason: "dup", flaggedAt: "bad date" },
        { domain: "http://b.example", reason: "scheme" },
        "not-an-object",
        { domain: "c.example" },
      ],
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.push.entries).toEqual([
      { domain: "a.example", reason: "dup", flaggedAt: "2026-09-04T10:00:00.000Z" },
      { domain: "c.example", reason: "flagged by extension", flaggedAt: "2026-09-04T10:00:00.000Z" },
    ]);
    expect(parsed.rejected).toEqual(["http://b.example", "not-an-object"]);
  });

  it("rejects malformed pushes", () => {
    expect(parseExtensionPush(null)).toMatchObject({ ok: false });
    expect(parseExtensionPush({ version: 2, updatedAt: "2026-09-04T10:00:00.000Z", entries: [] })).toMatchObject({ ok: false, error: "version must be 1" });
    expect(parseExtensionPush({ version: 1, updatedAt: "yesterday", entries: [] })).toMatchObject({ ok: false });
    expect(parseExtensionPush({ version: 1, updatedAt: "2026-09-04T10:00:00.000Z", entries: {} })).toMatchObject({ ok: false });
  });
});

describe("Blocklist allowlist", () => {
  it("removes protected names from lists and curated sources, and re-filters when the allowlist changes", () => {
    const { blocklist } = make(1);
    blocklist.addManual("sites.google.com", "test");
    blocklist.addManual("evil.example", "test");
    blocklist.setLists(new Set(["cdn1.nflxvideo.net", "phish.example"]));
    expect(blocklist.domains()).toEqual(new Set(["sites.google.com", "evil.example", "cdn1.nflxvideo.net", "phish.example"]));

    blocklist.setAllowlist(new Set(["sites.google.com", ".nflxvideo.net"]));
    expect(blocklist.domains()).toEqual(new Set(["evil.example", "phish.example"]));
    expect(blocklist.counts().list).toBe(1);
    expect(blocklist.curatedEntries().map((e) => e.domain)).toEqual(["evil.example"]);
    expect(blocklist.allowlistSize()).toBe(2);

    blocklist.setLists(new Set(["cdn2.nflxvideo.net", "drainer.example"]));
    expect(blocklist.listDomains()).toEqual(new Set(["drainer.example"]));

    blocklist.setAllowlist(new Set());
    expect(blocklist.domains()).toEqual(new Set(["sites.google.com", "evil.example", "cdn2.nflxvideo.net", "drainer.example"]));
    expect(blocklist.allowlistSize()).toBe(0);
  });
});

describe("Blocklist categories and the fast lane", () => {
  it("carries a category on every source and reports the strongest one", () => {
    const { blocklist } = make(3);
    blocklist.setLocal({ version: 1, updatedAt: "2026-09-06T00:00:00Z", entries: [{ domain: "kit.example", reason: "drainer", flaggedAt: "2026-09-06T00:00:00Z" }] });
    blocklist.addManual("ads.example", "ads", undefined, "ad");
    blocklist.addManual("kit.example", "also manual");
    expect(blocklist.categoryOf("kit.example")).toBe("drainer");
    expect(blocklist.categoryOf("ads.example")).toBe("ad");
    expect(blocklist.categoryOf("unknown.example")).toBeNull();
    const merged = blocklist.merged();
    expect(merged.find((e) => e.domain === "kit.example")?.category).toBe("drainer");
    expect(merged.find((e) => e.domain === "ads.example")?.category).toBe("ad");
    blocklist.setListCategoryResolver((domain) => (domain === "listed.example" ? "phishing" : null));
    blocklist.setLists(new Set(["listed.example"]));
    expect(blocklist.categoryOf("listed.example")).toBe("phishing");
    expect(blocklist.search("listed", 10).entries[0]?.category).toBe("phishing");
  });

  it("confirms fast-lane categories with fewer reporters, and with one when the name is on a list", () => {
    let now = 1_700_000_000_000;
    const blocklist = new Blocklist({ threshold: 5, ttlMs: DAY, fastLane: { threshold: 2, categories: ["infra", "drainer"] }, clock: () => now });
    blocklist.setListCategoryResolver((domain) => (domain === "listed.example" ? "phishing" : null));
    blocklist.setLists(new Set(["listed.example"]));

    expect(blocklist.recordFlag("c2.example", A, "kit backend", 1, now, "infra")).toMatchObject({ reporters: 1, confirmed: false });
    expect(blocklist.recordFlag("c2.example", B, "kit backend", 1, now, "infra")).toMatchObject({ reporters: 2, confirmed: true, changed: true });
    expect(blocklist.isConfirmed("c2.example")).toBe(true);
    expect(blocklist.categoryOf("c2.example")).toBe("infra");

    expect(blocklist.recordFlag("listed.example", A, "seen draining", 1, now, "drainer")).toMatchObject({ reporters: 1, confirmed: true });
    expect(blocklist.curated().has("listed.example")).toBe(true);

    expect(blocklist.recordFlag("page.example", A, "phishing page", 1, now, "phishing")).toMatchObject({ reporters: 1, confirmed: false });
    blocklist.recordFlag("page.example", B, "phishing page", 1, now, "phishing");
    expect(blocklist.isConfirmed("page.example")).toBe(false);
    expect(blocklist.flagSummaries().find((f) => f.domain === "page.example")).toMatchObject({ category: "phishing", reporters: 2, confirmed: false });

    now += 2 * DAY;
    expect(blocklist.isConfirmed("c2.example")).toBe(false);
  });

  it("inspects a name for the verdict endpoint", () => {
    const { blocklist } = make(2);
    blocklist.setListCategoryResolver((domain) => (domain === "listed.example" ? "ad" : null));
    blocklist.setLists(new Set(["listed.example", "shielded.example"]));
    blocklist.setAllowlist(new Set(["shielded.example"]));
    blocklist.addManual("manual.example", "operator", undefined, "counterfeit");
    blocklist.recordFlag("flagged.example", A, "phish", 1);

    expect(blocklist.inspect("not a host")).toBeNull();
    expect(blocklist.inspect("clean.example")).toMatchObject({ blocked: false, allowlisted: false, category: null, sources: [], reporters: 0 });
    expect(blocklist.inspect("listed.example")).toMatchObject({ blocked: true, category: "ad", sources: ["list"] });
    expect(blocklist.inspect("shielded.example")).toMatchObject({ blocked: false, allowlisted: true, sources: ["list"] });
    expect(blocklist.inspect("manual.example")).toMatchObject({ blocked: true, category: "counterfeit", sources: ["manual"], reasons: ["operator"] });
    expect(blocklist.inspect("flagged.example")).toMatchObject({ blocked: false, confirmed: false, reporters: 1, sources: [] });
    blocklist.recordFlag("flagged.example", B, "phish", 1);
    expect(blocklist.inspect("FLAGGED.example")).toMatchObject({ blocked: true, confirmed: true, reporters: 2, category: "phishing", sources: ["swarm"] });
  });
});
