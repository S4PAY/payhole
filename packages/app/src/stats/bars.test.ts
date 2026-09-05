import { describe, expect, it } from "vitest";

import { describeHistory, scaleBars, summarizeHistory } from "./bars";

const bucket = (queries: number, blocked: number, start = 0) => ({ start, queries, blocked });

describe("scaleBars", () => {
  it("draws nothing when no slice has traffic", () => {
    expect(scaleBars([bucket(0, 0), bucket(0, 0)], 80)).toEqual([
      { total: 0, blocked: 0 },
      { total: 0, blocked: 0 },
    ]);
  });

  it("scales the busiest slice to the full height and keeps small ones visible", () => {
    const bars = scaleBars([bucket(200, 50), bucket(1, 1), bucket(100, 0)], 80);
    expect(bars[0]).toEqual({ total: 80, blocked: 20 });
    expect(bars[1]).toEqual({ total: 2, blocked: 2 });
    expect(bars[2]).toEqual({ total: 40, blocked: 0 });
  });

  it("never lets the blocked part outgrow the slice", () => {
    const [bar] = scaleBars([bucket(0, 3)], 60);
    expect(bar).toEqual({ total: 60, blocked: 60 });
  });
});

describe("summarizeHistory", () => {
  it("adds up totals and finds the peak", () => {
    const summary = summarizeHistory([bucket(12, 1), bucket(0, 0), bucket(30, 4)]);
    expect(summary).toEqual({ queries: 42, blocked: 5, peak: 30, activeSlices: 2 });
  });

  it("describes an empty and a busy day", () => {
    expect(describeHistory(summarizeHistory([]))).toMatch(/Nothing recorded yet/);
    expect(describeHistory(summarizeHistory([bucket(1204, 17)]))).toBe(
      "Busiest half hour: 1,204 lookups. 17 blocked in the last 24 hours.",
    );
    expect(describeHistory(summarizeHistory([bucket(5, 0)]))).toBe(
      "Busiest half hour: 5 lookups. Nothing blocked so far in the last 24 hours.",
    );
  });
});
