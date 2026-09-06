import { describe, expect, it } from "vitest";
import type { Address, Hash, Log, TransactionReceipt } from "viem";
import { burnedFromReceipt, minTokensBurned, readTierState, TierError, unlockedLog, unlockTier, type TierPublicClient, type TierWalletClient } from "./tier.js";

const VAULT = "0x80d9BC2412853030f259eA7056654888b2B0D768" as Address;
const USDG = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168" as Address;
const USER = "0x9Ad1b7A35FC8e215fF014c1682a11afd2Fd2b9D2" as Address;

interface World {
  tier: number;
  usdg: bigint;
  eth: bigint;
  allowance: bigint;
  route: number;
  prices: Record<number, bigint>;
  burnPer: bigint;
}

function fakeClients(world: World) {
  const writes: { functionName: string; args: readonly unknown[] }[] = [];
  const receipts = new Map<Hash, TransactionReceipt>();
  let n = 0;
  const publicClient: TierPublicClient = {
    readContract: ({ functionName, args }) => {
      switch (functionName) {
        case "tierOf":
          return Promise.resolve(world.tier);
        case "balanceOf":
          return Promise.resolve(world.usdg);
        case "allowance":
          return Promise.resolve(world.allowance);
        case "routeKind":
          return Promise.resolve(world.route);
        case "tierPrice":
          return Promise.resolve(world.prices[Number(args?.[0])] ?? 0n);
        case "unlock":
          return Promise.resolve(world.burnPer * (world.prices[Number(args?.[0])] ?? 0n));
        default:
          return Promise.reject(new Error(`unexpected read ${functionName}`));
      }
    },
    getBalance: () => Promise.resolve(world.eth),
    waitForTransactionReceipt: ({ hash }) => Promise.resolve(receipts.get(hash)!),
  };
  const wallet: TierWalletClient = {
    account: { address: USER },
    writeContract: ({ functionName, args }) => {
      writes.push({ functionName, args });
      const hash: Hash = `0x${(++n).toString(16).padStart(64, "0")}`;
      const logs: Log[] = [];
      if (functionName === "approve") world.allowance = args[1] as bigint;
      if (functionName === "unlock") {
        const tier = Number(args[0]);
        const price = world.prices[tier] ?? 0n;
        const burned = world.route === 0 ? 0n : world.burnPer * price;
        world.tier = tier;
        world.usdg -= price;
        logs.push(unlockedLog(VAULT, USER, tier, price, burned) as Log);
      }
      receipts.set(hash, { status: "success", logs } as unknown as TransactionReceipt);
      return Promise.resolve(hash);
    },
  };
  return { publicClient, wallet, writes };
}

const base = (): World => ({ tier: 0, usdg: 100_000_000n, eth: 10n ** 15n, allowance: 0n, route: 0, prices: { 1: 10_000_000n, 2: 50_000_000n, 3: 250_000_000n }, burnPer: 1000n });

describe("readTierState", () => {
  it("reads the tier, prices, balances, allowance, and whether a route exists", async () => {
    const { publicClient } = fakeClients({ ...base(), tier: 2, route: 1 });
    const state = await readTierState(publicClient, { vault: VAULT, usdg: USDG, address: USER });
    expect(state.tier).toBe(2);
    expect(state.prices).toEqual({ 1: 10_000_000n, 2: 50_000_000n, 3: 250_000_000n });
    expect(state.usdgBalance).toBe(100_000_000n);
    expect(state.routeSet).toBe(true);
  });
});

describe("minTokensBurned", () => {
  it("applies the tolerance in basis points and refuses nonsense", () => {
    expect(minTokensBurned(10_000n, 300)).toBe(9_700n);
    expect(minTokensBurned(10_000n, 0)).toBe(10_000n);
    expect(() => minTokensBurned(1n, 10_001)).toThrow(RangeError);
    expect(() => minTokensBurned(1n, 1.5)).toThrow(RangeError);
  });
});

describe("unlockTier", () => {
  it("approves exactly the price, holds the USDG when there is no route, and grants the tier", async () => {
    const world = base();
    const { publicClient, wallet, writes } = fakeClients(world);
    const lines: string[] = [];
    const result = await unlockTier(publicClient, wallet, { vault: VAULT, usdg: USDG, tier: 1, log: (l) => lines.push(l) });
    expect(writes.map((w) => w.functionName)).toEqual(["approve", "unlock"]);
    expect(writes[0]?.args).toEqual([VAULT, 10_000_000n]);
    expect(writes[1]?.args[1]).toBe(0n);
    expect(result.held).toBe(true);
    expect(result.tokensBurned).toBe(0n);
    expect(result.price).toBe(10_000_000n);
    expect(result.approveHash).not.toBeNull();
    expect(world.tier).toBe(1);
    expect(lines.some((l) => l.includes("keeps the USDG"))).toBe(true);
  });

  it("skips the approval when the allowance covers the price and sets a slippage floor when a route exists", async () => {
    const world = { ...base(), allowance: 50_000_000n, route: 1 };
    const { publicClient, wallet, writes } = fakeClients(world);
    const result = await unlockTier(publicClient, wallet, { vault: VAULT, usdg: USDG, tier: 2, slippageBps: 500, now: () => 1_700_000_000_000 });
    expect(writes.map((w) => w.functionName)).toEqual(["unlock"]);
    const [tier, min, deadline] = writes[0]?.args ?? [];
    expect(tier).toBe(2);
    expect(min).toBe((1000n * 50_000_000n * 9_500n) / 10_000n);
    expect(deadline).toBe(1_700_000_600n);
    expect(result.approveHash).toBeNull();
    expect(result.held).toBe(false);
    expect(result.tokensBurned).toBe(1000n * 50_000_000n);
  });

  it("refuses an unpriced tier, a tier already held, an empty USDG balance, and a wallet without gas", async () => {
    const attempt = (world: World, tier: number) => {
      const { publicClient, wallet } = fakeClients(world);
      return unlockTier(publicClient, wallet, { vault: VAULT, usdg: USDG, tier });
    };
    await expect(attempt(base(), 4)).rejects.toMatchObject({ code: "not_offered" });
    await expect(attempt({ ...base(), tier: 2 }, 1)).rejects.toMatchObject({ code: "already_unlocked" });
    await expect(attempt({ ...base(), usdg: 5_000_000n }, 1)).rejects.toMatchObject({ code: "no_usdg" });
    await expect(attempt({ ...base(), eth: 0n }, 1)).rejects.toMatchObject({ code: "no_gas" });
    await expect(attempt(base(), 4)).rejects.toBeInstanceOf(TierError);
  });
});

describe("burnedFromReceipt", () => {
  it("reads the burned amount from the Unlocked event and returns zero without one", () => {
    expect(burnedFromReceipt([unlockedLog(VAULT, USER, 1, 10_000_000n, 123n) as Log])).toBe(123n);
    expect(burnedFromReceipt([])).toBe(0n);
  });
});
