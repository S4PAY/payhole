import { describe, expect, it } from "vitest";
import { formatUsdg, parseUsdg, PayholeError } from "../src/index.js";

describe("parseUsdg", () => {
  it("reads decimals and whole numbers into 6-decimal base units", () => {
    expect(parseUsdg("0.50")).toBe(500_000n);
    expect(parseUsdg("5")).toBe(5_000_000n);
    expect(parseUsdg(5)).toBe(5_000_000n);
    expect(parseUsdg(0.5)).toBe(500_000n);
    expect(parseUsdg("0.000001")).toBe(1n);
    expect(parseUsdg(" 24.88 ")).toBe(24_880_000n);
  });

  it("rejects anything that is not a plain positive decimal with at most 6 places", () => {
    for (const bad of ["", "-1", "abc", "1e3", "1.1234567", "0x10", ".5", "5.", NaN, Infinity]) {
      expect(() => parseUsdg(bad as string)).toThrow(PayholeError);
    }
  });
});

describe("formatUsdg", () => {
  it("prints money with two places and keeps smaller amounts exact", () => {
    expect(formatUsdg(5_000_000n)).toBe("5.00");
    expect(formatUsdg(500_000n)).toBe("0.50");
    expect(formatUsdg(120_000n)).toBe("0.12");
    expect(formatUsdg(24_880_000n)).toBe("24.88");
    expect(formatUsdg(0n)).toBe("0.00");
    expect(formatUsdg(100n)).toBe("0.0001");
    expect(formatUsdg(1_234_567n)).toBe("1.234567");
    expect(formatUsdg(5_000_000n, 0)).toBe("5");
  });
});
