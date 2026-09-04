import { describe, expect, it } from "vitest";
import { cleanReason, isHostname, normalizeHostname } from "../src/hostname.js";

describe("normalizeHostname", () => {
  it("lowercases, trims, strips the trailing dot and converts IDN labels to punycode", () => {
    expect(normalizeHostname("Example.COM")).toBe("example.com");
    expect(normalizeHostname("  tracker.example. ")).toBe("tracker.example");
    expect(normalizeHostname("bücher.example")).toBe("xn--bcher-kva.example");
    expect(normalizeHostname("_dmarc.example.org")).toBe("_dmarc.example.org");
    expect(normalizeHostname("a.b.c.d.example")).toBe("a.b.c.d.example");
    expect(isHostname("wallet-drainer.example")).toBe(true);
  });

  it("rejects schemes, paths, ports, credentials, IP literals, single labels and bad labels", () => {
    const bad = [
      "https://example.com",
      "example.com/path",
      "example.com:53",
      "user@example.com",
      "192.168.0.1",
      "[::1]",
      "localhost",
      "com",
      "",
      "   ",
      "exa mple.com",
      "-bad.example",
      "bad-.example",
      `${"a".repeat(64)}.example`,
      "*.example.com",
      "example.com?x=1",
      "example.com#frag",
      "%41.example",
      "a..example",
    ];
    for (const input of bad) expect(normalizeHostname(input), input).toBeNull();
    expect(normalizeHostname(42)).toBeNull();
    expect(normalizeHostname(null)).toBeNull();
    expect(normalizeHostname(undefined)).toBeNull();
  });
});

describe("cleanReason", () => {
  it("collapses whitespace and control characters, caps length, and falls back", () => {
    expect(cleanReason(`  drainer${String.fromCharCode(10, 9)}seen   twice  `)).toBe("drainer seen twice");
    expect(cleanReason("x".repeat(500))).toHaveLength(200);
    expect(cleanReason("")).toBe("unspecified");
    expect(cleanReason(null, "manual")).toBe("manual");
  });
});
