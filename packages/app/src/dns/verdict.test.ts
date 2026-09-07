import { describe, expect, it } from "vitest";
import { categoryLabel, describeVerdict, extractName, fetchVerdict, isDangerous, shareText, type Verdict } from "./verdict";

describe("extractName", () => {
  it("takes the host of the first URL in shared text", () => {
    expect(extractName("check this https://Evil-Claim.pages.dev/connect?x=1 before you tap")).toBe("evil-claim.pages.dev");
    expect(extractName("http://uniswap-airdrop.claims./")).toBe("uniswap-airdrop.claims");
    expect(extractName("Look: (https://example.org/path) ok")).toBe("example.org");
  });

  it("accepts bare hostnames with paths and ports, and ignores everything else", () => {
    expect(extractName("metamask-verify.xyz/login")).toBe("metamask-verify.xyz");
    expect(extractName("dns.payhole.org:853")).toBe("dns.payhole.org");
    expect(extractName("just some words here")).toBeNull();
    expect(extractName("")).toBeNull();
    expect(extractName("192.168.1.1")).toBeNull();
    expect(extractName("http://[::1]/")).toBeNull();
  });
});

describe("fetchVerdict", () => {
  const verdict = { domain: "kit.example", blocked: true, allowlisted: false, category: "drainer", sources: ["swarm", "list"], reasons: ["c2"], reporters: 2, confirmed: true, checkedAt: 1 };
  const fake = (status: number, body: unknown): typeof fetch =>
    () => Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body) } as Response);

  it("parses a verdict and tolerates unknown categories", async () => {
    const v = await fetchVerdict("kit.example", "https://dns.example/verdict", fake(200, verdict));
    expect(v).toMatchObject({ domain: "kit.example", blocked: true, category: "drainer", reporters: 2, confirmed: true });
    const odd = await fetchVerdict("kit.example", "https://dns.example/verdict", fake(200, { ...verdict, category: "malware", sources: "x" }));
    expect(odd.category).toBeNull();
    expect(odd.sources).toEqual([]);
  });

  it("explains rate limits and refusals", async () => {
    await expect(fetchVerdict("x.example", "https://dns.example/verdict", fake(429, "slow down"))).rejects.toThrow(/rate limiting/);
    await expect(fetchVerdict("x.example", "https://dns.example/verdict", fake(400, "bad"))).rejects.toThrow(/refused/);
    await expect(fetchVerdict("x.example", "https://dns.example/verdict", fake(200, { nope: true }))).rejects.toThrow(/understand/);
  });

  it("encodes the name in the query", async () => {
    let url = "";
    const spy: typeof fetch = ((input: string) => {
      url = input;
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(verdict) } as Response);
    }) as typeof fetch;
    await fetchVerdict("a b.example", "https://dns.example/verdict", spy);
    expect(url).toBe("https://dns.example/verdict?name=a%20b.example");
  });
});

describe("words", () => {
  const base: Verdict = { domain: "kit.example", blocked: true, allowlisted: false, category: "drainer", sources: ["swarm"], reasons: [], reporters: 3, confirmed: true, checkedAt: 1_700_000_000_000 };

  it("labels categories and knows which ones are dangerous", () => {
    expect(categoryLabel("infra")).toBe("drainer infrastructure");
    expect(categoryLabel(null)).toBe("blocked");
    expect(isDangerous("phishing")).toBe(true);
    expect(isDangerous("ad")).toBe(false);
    expect(isDangerous(null)).toBe(false);
  });

  it("describes swarm, list, operator, allowlisted, and clean verdicts", () => {
    expect(describeVerdict(base)).toBe("A wallet drainer. Confirmed by 3 nodes in the swarm.");
    expect(describeVerdict({ ...base, sources: ["list"], category: "phishing" })).toBe("A phishing page. On a subscribed list.");
    expect(describeVerdict({ ...base, sources: ["manual"], category: null })).toBe("Blocked by an operator.");
    expect(describeVerdict({ ...base, blocked: false, allowlisted: true })).toContain("allowlist");
    expect(describeVerdict({ ...base, blocked: false, sources: [] })).toBe("Not on any list. Not confirmed by the swarm. Not a guarantee.");
    expect(shareText(base)).toContain("Checked with PayHole, 2023-11-14 22:13 UTC");
    expect(shareText(base).startsWith("kit.example: A wallet drainer.")).toBe(true);
  });
});
