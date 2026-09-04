import { keccak256, stringToBytes } from "viem";
import { describe, expect, it } from "vitest";
import { domainHash, normalizeHostname } from "../src/index.js";

describe("domainHash", () => {
  it("hashes the lowercase hostname without a trailing dot", () => {
    expect(normalizeHostname("https://Example.COM./path?x=1")).toBe("example.com");
    expect(normalizeHostname("Sub.Example.com")).toBe("sub.example.com");
    expect(domainHash("EXAMPLE.com")).toBe(keccak256(stringToBytes("example.com")));
  });

  it("punycodes internationalised names", () => {
    expect(normalizeHostname("bücher.example")).toBe("xn--bcher-kva.example");
  });
});
