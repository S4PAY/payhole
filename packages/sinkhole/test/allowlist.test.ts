import { describe, expect, it } from "vitest";
import { Allowlist, parseAllowlistText, parseRule } from "../src/allowlist.js";

describe("parseAllowlistText", () => {
  it("reads exact names, suffix rules in both spellings, hosts lines, and comments", () => {
    const { domains, invalid } = parseAllowlistText(`
# protect these
sites.google.com
.nflxvideo.net   # the whole cdn
*.gravatar.com
0.0.0.0 pasted.example.org
.com
not a host
`);
    expect([...domains].sort()).toEqual([".gravatar.com", ".nflxvideo.net", "pasted.example.org", "sites.google.com"]);
    expect(invalid).toBe(4);
  });

  it("normalizes case and trailing dots and refuses a bare top-level domain as a suffix", () => {
    expect(parseRule("Sites.Google.COM.")).toBe("sites.google.com");
    expect(parseRule(".Example.COM")).toBe(".example.com");
    expect(parseRule(".com")).toBeNull();
    expect(parseRule("*.")).toBeNull();
  });
});

describe("Allowlist", () => {
  const allow = new Allowlist(["sites.google.com", ".nflxvideo.net"]);

  it("matches exact rules only on the exact name", () => {
    expect(allow.allows("sites.google.com")).toBe(true);
    expect(allow.allows("evil.sites.google.com")).toBe(false);
    expect(allow.allows("google.com")).toBe(false);
  });

  it("matches suffix rules on the name and everything under it, never on lookalikes", () => {
    expect(allow.allows("nflxvideo.net")).toBe(true);
    expect(allow.allows("ipv4-c001-lhr001-ix.1.oca.nflxvideo.net")).toBe(true);
    expect(allow.allows("evilnflxvideo.net")).toBe(false);
    expect(allow.allows("nflxvideo.net.evil.example")).toBe(false);
  });

  it("filters a set and hands the same set back when nothing is protected", () => {
    const clean = new Set(["phish.example", "drainer.example"]);
    expect(allow.filter(clean)).toBe(clean);
    const mixed = new Set(["phish.example", "sites.google.com", "cdn.nflxvideo.net"]);
    expect([...allow.filter(mixed)]).toEqual(["phish.example"]);
    expect(mixed.size).toBe(3);
    expect(new Allowlist([]).filter(mixed)).toBe(mixed);
  });

  it("counts rules of both kinds", () => {
    expect(allow.size).toBe(2);
    expect(new Allowlist([]).size).toBe(0);
  });
});
