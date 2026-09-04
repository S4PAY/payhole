import { describe, expect, it } from "vitest";
import { domainHash, keccak256, normalizeHostname } from "../src/lib/keccak";

describe("keccak256", () => {
  it("matches known vectors", () => {
    expect(keccak256("")).toBe("0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470");
    expect(keccak256("abc")).toBe("0x4e03657aea45a94fc7d47ba826c8d667c0d1e6e33a64a036ec44f58fa12d6c45");
    expect(keccak256("example.com")).toBe("0x02438d3405cadd648e08dbff51bdbeb415913e642189100dc4a012064c870883");
  });

  it("handles inputs longer than one block", () => {
    const long = "a".repeat(300);
    expect(keccak256(long)).toMatch(/^0x[0-9a-f]{64}$/);
    expect(keccak256(long)).not.toBe(keccak256("a".repeat(299)));
  });

  it("hashes the normalised hostname", () => {
    expect(normalizeHostname("https://Example.COM./x")).toBe("example.com");
    expect(domainHash("EXAMPLE.com")).toBe(keccak256("example.com"));
  });
});
