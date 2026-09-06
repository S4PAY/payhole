import { describe, expect, it } from "vitest";
import { describeList, describeRadar, fetchRadar, parseRadar, withCommas, type Radar } from "./radar";

const sample = {
  generatedAt: 1_700_000_000_000,
  windowHours: 24,
  swarm: { confirmed: 2, confirmedWeek: 9, pending: 3, recent: [{ domain: "kit.example", category: "drainer", reporters: 2, at: 1_699_999_000_000 }, { domain: "odd.example", category: "malware", reporters: 1, at: 1 }] },
  lists: [{ url: "https://x.example/l.txt", label: "x.example", category: "phishing", entries: 390_000, lastSuccessAt: 1, refreshes: 2, added: 1240, removed: 80, sample: ["a.example"] }],
  categories: { phishing: 1240, drainer: 2, bogus: 5, ad: 0 },
  brands: [{ brand: "MetaMask", count: 12, sample: ["metamask-claim.example"] }],
  totals: { listNames: 820_000, lists: 3 },
};

describe("parseRadar", () => {
  it("reads a snapshot, tolerating unknown categories and extra fields", () => {
    const radar = parseRadar({ ...sample, extra: true });
    expect(radar.swarm.recent[1]?.category).toBe("other");
    expect(radar.lists[0]).toMatchObject({ label: "x.example", added: 1240, sample: ["a.example"] });
    expect(radar.categories).toEqual({ phishing: 1240, drainer: 2 });
    expect(radar.brands[0]?.brand).toBe("MetaMask");
    expect(() => parseRadar({ nope: true })).toThrow(/not a radar/);
  });

  it("fetches with the right errors", async () => {
    const fake = (status: number, body: unknown): typeof fetch => () => Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body) } as Response);
    expect((await fetchRadar("https://dns.example/radar", fake(200, sample))).totals.lists).toBe(3);
    await expect(fetchRadar("https://dns.example/radar", fake(429, ""))).rejects.toThrow(/rate limiting/);
    await expect(fetchRadar("https://dns.example/radar", fake(500, ""))).rejects.toThrow(/refused/);
  });
});

describe("words", () => {
  const radar: Radar = parseRadar(sample);

  it("formats counts and describes lists and the whole radar", () => {
    expect(withCommas(1234567)).toBe("1,234,567");
    expect(describeList(radar.lists[0]!)).toBe("1,240 added, 80 removed in the last 24 hours over 2 refreshes.");
    expect(describeList({ ...radar.lists[0]!, refreshes: 0 })).toBe("No change in the last 24 hours.");
    expect(describeRadar(radar)).toBe("In the last 24 hours: 2 swarm confirmations, 1,240 new list names, 820,000 names on the lists in all.");
    expect(describeRadar({ ...radar, swarm: { ...radar.swarm, confirmed: 0 }, lists: [] })).toBe("Nothing new in the last 24 hours. The lists hold 820,000 names.");
  });
});
