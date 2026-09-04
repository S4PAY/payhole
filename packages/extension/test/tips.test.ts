import { describe, expect, it, vi } from "vitest";
import type { Address } from "viem";
import { Ledger } from "../lib/ledger";
import { memoryStore } from "../lib/storage";
import { shouldTip, TipScheduler, TIPS_LAST_KEY } from "../lib/tips";

const WALLET: Address = "0x90F79bf6EB2c4f870365E785982E1f101E93b906";
const ZERO: Address = "0x0000000000000000000000000000000000000000";
const HOUR = 3_600_000;

describe("shouldTip", () => {
  it("tips when never tipped or after the interval", () => {
    expect(shouldTip(undefined, HOUR, 0)).toBe(true);
    expect(shouldTip(0, HOUR, HOUR - 1)).toBe(false);
    expect(shouldTip(0, HOUR, HOUR)).toBe(true);
  });
});

async function scheduler(options: { enabled?: boolean; registered?: boolean } = {}) {
  let now = Date.UTC(2026, 8, 4);
  const store = memoryStore();
  const ledger = new Ledger(store, () => now);
  await ledger.load();
  const lookup = vi.fn((hostname: string) => Promise.resolve(hostname === "creator.example" && (options.registered ?? true) ? WALLET : ZERO));
  const send = vi.fn(() => Promise.resolve(`0x${"a".repeat(64)}` as const));
  const tips = new TipScheduler({
    lookup,
    send,
    ledger,
    store,
    policy: () => ({ enabled: options.enabled ?? true, amount: 10_000n, intervalMs: 24 * HOUR }),
    now: () => now,
  });
  await tips.load();
  return { tips, lookup, send, ledger, store, advance: (ms: number) => (now += ms) };
}

describe("TipScheduler", () => {
  it("tips a registered domain once per interval and records it", async () => {
    const { tips, send, ledger, store, advance } = await scheduler();
    const first = await tips.onNavigation("https://creator.example/post/1");
    expect(first.kind).toBe("tipped");
    expect(send).toHaveBeenCalledWith("creator.example", expect.stringMatching(/^0x[0-9a-f]{64}$/), 10_000n, WALLET);
    expect(ledger.tipsTotal()).toBe(10_000n);
    expect(ledger.recent(1)[0]).toMatchObject({ status: "tip", origin: "https://creator.example", payTo: WALLET });
    expect(await store.get(TIPS_LAST_KEY)).toEqual({ "creator.example": Date.UTC(2026, 8, 4) });

    advance(HOUR);
    expect(await tips.onNavigation("https://creator.example/post/2")).toEqual({ kind: "skipped", hostname: "creator.example", reason: "recent" });
    expect(send).toHaveBeenCalledTimes(1);

    advance(24 * HOUR);
    expect((await tips.onNavigation("https://creator.example/")).kind).toBe("tipped");
    expect(send).toHaveBeenCalledTimes(2);
    expect(tips.history()).toHaveLength(2);
  });

  it("skips unregistered domains, disabled tips, and caches lookups for an hour", async () => {
    const { tips, lookup, send, advance } = await scheduler();
    expect(await tips.onNavigation("https://other.example/")).toEqual({ kind: "skipped", hostname: "other.example", reason: "unregistered" });
    await tips.onNavigation("https://other.example/again");
    expect(lookup).toHaveBeenCalledTimes(1);
    advance(HOUR);
    await tips.onNavigation("https://other.example/later");
    expect(lookup).toHaveBeenCalledTimes(2);
    expect(send).not.toHaveBeenCalled();

    const off = await scheduler({ enabled: false });
    expect(await off.tips.onNavigation("https://creator.example/")).toEqual({ kind: "skipped", hostname: "creator.example", reason: "disabled" });
    expect(off.lookup).not.toHaveBeenCalled();
  });

  it("survives a restart without double tipping and reports failures", async () => {
    const base = await scheduler();
    await base.tips.onNavigation("https://creator.example/");
    const again = new TipScheduler({
      lookup: base.lookup,
      send: base.send,
      ledger: base.ledger,
      store: base.store,
      policy: () => ({ enabled: true, amount: 10_000n, intervalMs: 24 * HOUR }),
      now: () => Date.UTC(2026, 8, 4) + HOUR,
    });
    await again.load();
    expect((await again.onNavigation("https://creator.example/")).kind).toBe("skipped");
    base.send.mockRejectedValueOnce(new Error("no gas"));
    const failing = await scheduler();
    failing.send.mockRejectedValueOnce(new Error("no gas"));
    expect(await failing.tips.onNavigation("https://creator.example/")).toEqual({ kind: "failed", hostname: "creator.example", error: "no gas" });
    expect(failing.ledger.tipsTotal()).toBe(0n);
  });
});
