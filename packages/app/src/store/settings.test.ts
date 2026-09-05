import { describe, expect, it } from "vitest";

import {
  DEFAULT_SETTINGS,
  loadSettings,
  normalizeDohUrl,
  normalizeDotHost,
  parseSettings,
  PUBLIC_RESOLVER,
  saveSettings,
  serializeSettings,
  SETTINGS_KEY,
  validateSettings,
  type KeyValueStorage,
} from "./settings";

function memoryStorage(initial: Record<string, string> = {}): KeyValueStorage & { data: Map<string, string> } {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key) => Promise.resolve(data.get(key) ?? null),
    setItem: (key, value) => {
      data.set(key, value);
      return Promise.resolve();
    },
  };
}

describe("normalizeDohUrl", () => {
  it("accepts https URLs and keeps their path", () => {
    expect(normalizeDohUrl("  https://dns.payhole.org/dns-query ")).toBe("https://dns.payhole.org/dns-query");
    expect(normalizeDohUrl("https://example.org/custom/path")).toBe("https://example.org/custom/path");
  });

  it("rejects plain http, credentials, bare hosts, and junk", () => {
    expect(normalizeDohUrl("http://dns.payhole.org/dns-query")).toBeNull();
    expect(normalizeDohUrl("https://user:pw@dns.payhole.org/dns-query")).toBeNull();
    expect(normalizeDohUrl("dns.payhole.org")).toBeNull();
    expect(normalizeDohUrl("https://localhost/dns-query")).toBeNull();
    expect(normalizeDohUrl("")).toBeNull();
  });
});

describe("normalizeDotHost", () => {
  it("lower-cases a host name and strips a trailing dot", () => {
    expect(normalizeDotHost(" DNS.PayHole.org. ")).toBe("dns.payhole.org");
  });

  it("rejects schemes, ports, paths, and single labels", () => {
    expect(normalizeDotHost("tls://dns.payhole.org")).toBeNull();
    expect(normalizeDotHost("dns.payhole.org:853")).toBeNull();
    expect(normalizeDotHost("dns.payhole.org/x")).toBeNull();
    expect(normalizeDotHost("localhost")).toBeNull();
    expect(normalizeDotHost("bad_host.example")).toBeNull();
  });
});

describe("validateSettings", () => {
  it("returns the public resolver for the default settings", () => {
    expect(validateSettings(DEFAULT_SETTINGS)).toEqual({ ok: true, active: PUBLIC_RESOLVER });
  });

  it("requires at least one transport for a custom resolver", () => {
    const result = validateSettings({ kind: "custom", customDohUrl: "", customDotHost: "" });
    expect(result.ok).toBe(false);
  });

  it("accepts DoT only, DoH only, or both, and labels with the host", () => {
    expect(validateSettings({ kind: "custom", customDohUrl: "", customDotHost: "dns.example.org" })).toEqual({
      ok: true,
      active: { label: "dns.example.org", dohUrl: null, dotHost: "dns.example.org" },
    });
    expect(validateSettings({ kind: "custom", customDohUrl: "https://doh.example.org/q", customDotHost: "" })).toEqual({
      ok: true,
      active: { label: "doh.example.org", dohUrl: "https://doh.example.org/q", dotHost: null },
    });
    const both = validateSettings({ kind: "custom", customDohUrl: "https://doh.example.org/q", customDotHost: "dot.example.org" });
    expect(both.ok && both.active.label).toBe("dot.example.org");
  });

  it("explains an invalid URL or host", () => {
    const badUrl = validateSettings({ kind: "custom", customDohUrl: "ftp://x.example", customDotHost: "" });
    expect(!badUrl.ok && badUrl.error).toMatch(/https:\/\//);
    const badHost = validateSettings({ kind: "custom", customDohUrl: "", customDotHost: "not a host" });
    expect(!badHost.ok && badHost.error).toMatch(/host name/);
  });
});

describe("parseSettings and serializeSettings", () => {
  it("falls back to defaults for missing, empty, or broken storage", () => {
    expect(parseSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings("")).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings("{not json")).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings("[1,2]")).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings('{"kind":"weird","customDohUrl":5}')).toEqual(DEFAULT_SETTINGS);
  });

  it("round-trips custom settings", () => {
    const settings = { kind: "custom" as const, customDohUrl: "https://doh.example.org/q", customDotHost: "dot.example.org" };
    expect(parseSettings(serializeSettings(settings))).toEqual(settings);
  });
});

describe("loadSettings and saveSettings", () => {
  it("reads and writes through the storage under a versioned key", async () => {
    const storage = memoryStorage();
    expect(await loadSettings(storage)).toEqual(DEFAULT_SETTINGS);
    const custom = { kind: "custom" as const, customDohUrl: "", customDotHost: "dot.example.org" };
    await saveSettings(storage, custom);
    expect(storage.data.has(SETTINGS_KEY)).toBe(true);
    expect(await loadSettings(storage)).toEqual(custom);
  });

  it("survives a storage that throws", async () => {
    const broken: KeyValueStorage = {
      getItem: () => Promise.reject(new Error("disk")),
      setItem: () => Promise.reject(new Error("disk")),
    };
    expect(await loadSettings(broken)).toEqual(DEFAULT_SETTINGS);
  });
});
