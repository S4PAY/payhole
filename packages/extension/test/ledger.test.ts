import { describe, expect, it } from "vitest";
import { Ledger, MAX_ENTRIES } from "../lib/ledger";
import { memoryStore } from "../lib/storage";

async function ledgerAt(now: () => number) {
  const store = memoryStore();
  const ledger = new Ledger(store, now);
  await ledger.load();
  return { ledger, store };
}

const entry = (origin: string, amount: bigint, status: "signed" | "settled" | "refused" | "tip" = "signed") => ({
  origin,
  url: `${origin}/x`,
  amount: amount.toString(),
  payTo: "0x90F79bf6EB2c4f870365E785982E1f101E93b906",
  status,
});

describe("Ledger", () => {
  it("sums per origin, per day, and in total; refusals do not count", async () => {
    let now = Date.UTC(2026, 8, 4, 10);
    const { ledger, store } = await ledgerAt(() => now);
    await ledger.record(entry("https://a.example", 100n));
    await ledger.record(entry("https://a.example", 50n, "settled"));
    await ledger.record(entry("https://b.example", 7n));
    await ledger.record(entry("https://b.example", 999n, "refused"));
    expect(ledger.spentFor("https://a.example")).toBe(150n);
    expect(ledger.spentFor("https://b.example")).toBe(7n);
    expect(ledger.spentFor("https://c.example")).toBe(0n);
    expect(ledger.totalSpent()).toBe(157n);
    expect(ledger.dailyTotal("2026-09-04")).toBe(157n);
    now += 24 * 3_600_000;
    await ledger.record(entry("https://a.example", 1n));
    expect(ledger.dailyTotal("2026-09-05")).toBe(1n);
    expect(ledger.dailyTotal("2026-09-04")).toBe(157n);
    expect(ledger.totalSpent()).toBe(158n);

    const reloaded = new Ledger(store, () => now);
    await reloaded.load();
    expect(reloaded.totalSpent()).toBe(158n);
    expect(reloaded.origins().map((o) => o.origin)).toEqual(["https://a.example", "https://b.example"]);
  });

  it("subtracts failed settlements and keeps tips separate", async () => {
    const { ledger } = await ledgerAt(() => Date.UTC(2026, 8, 4));
    const signed = await ledger.record(entry("https://a.example", 100n));
    await ledger.settle(signed.id, { success: false, note: "insufficient_funds" });
    expect(ledger.spentFor("https://a.example")).toBe(0n);
    expect(ledger.totalSpent()).toBe(0n);
    expect(ledger.recent(1)[0]).toMatchObject({ status: "failed", note: "insufficient_funds" });
    await ledger.record(entry("https://creator.example", 10_000n, "tip"));
    expect(ledger.tipsTotal()).toBe(10_000n);
    expect(ledger.totalSpent()).toBe(0n);
    expect(ledger.origins()).toHaveLength(1);
    expect(await ledger.settle("missing", { success: true })).toBeUndefined();
  });

  it("keeps only the last 500 entries but every total", async () => {
    const { ledger } = await ledgerAt(() => Date.UTC(2026, 8, 4));
    for (let i = 0; i < MAX_ENTRIES + 20; i++) await ledger.record(entry("https://a.example", 1n));
    expect(ledger.snapshot().entries).toHaveLength(MAX_ENTRIES);
    expect(ledger.spentFor("https://a.example")).toBe(BigInt(MAX_ENTRIES + 20));
    expect(ledger.recent(3)).toHaveLength(3);
    expect(ledger.entriesFor("https://a.example", 5)).toHaveLength(5);
  });
});
