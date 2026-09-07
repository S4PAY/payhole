import { describe, expect, it, vi } from "vitest";
import { describeReport, sendReport } from "../lib/report";
import {
  AllowOnce,
  VerdictCache,
  blockRule,
  checkPageUrl,
  describeVerdict,
  extractName,
  fetchVerdict,
  hostRegex,
  hostnameOf,
  isShieldRuleId,
  parseCheckPage,
  shieldRuleId,
  shouldBlock,
  type Verdict,
} from "../lib/shield";
import { memoryStore } from "../lib/storage";

const NOW = 1_800_000_000_000;

function verdict(domain: string, blocked: boolean, extra: Partial<Verdict> = {}): Verdict {
  return { domain, blocked, allowlisted: false, category: blocked ? "drainer" : null, sources: blocked ? ["list"] : [], reasons: [], reporters: 0, confirmed: false, checkedAt: NOW, ...extra };
}

const jsonResponse = (status: number, body: unknown): Response => ({ ok: status < 400, status, json: () => Promise.resolve(body) }) as Response;

describe("names", () => {
  it("takes the hostname of http(s) URLs only, lowercased, and never an address or a bare word", () => {
    expect(hostnameOf("https://Drain.Evil./claim?x=1")).toBe("drain.evil");
    expect(hostnameOf("http://kit.example:8080/")).toBe("kit.example");
    expect(hostnameOf("chrome://extensions")).toBeNull();
    expect(hostnameOf("https://127.0.0.1/")).toBeNull();
    expect(hostnameOf("https://localhost/")).toBeNull();
    expect(hostnameOf("not a url")).toBeNull();
  });

  it("finds the name a person pasted, URL or bare host, inside other text", () => {
    expect(extractName("check this https://claim-airdrop.example/connect?ref=1 now")).toBe("claim-airdrop.example");
    expect(extractName("Drain.Evil/path")).toBe("drain.evil");
    expect(extractName("nothing here")).toBeNull();
  });
});

describe("verdicts", () => {
  it("parses the resolver's answer and describes it in one line", async () => {
    const fetchImpl = vi.fn(() => Promise.resolve(jsonResponse(200, { domain: "kit.example", blocked: true, category: "drainer", sources: ["swarm"], reporters: 5, confirmed: true, checkedAt: NOW })));
    const got = await fetchVerdict("kit.example", "https://dns.payhole.org/", fetchImpl);
    expect(fetchImpl).toHaveBeenCalledWith("https://dns.payhole.org/verdict?name=kit.example", expect.anything());
    expect(got).toMatchObject({ domain: "kit.example", blocked: true, category: "drainer", reporters: 5 });
    expect(describeVerdict(got)).toBe("A wallet drainer. Confirmed by 5 nodes in the swarm.");
    expect(describeVerdict(verdict("fine.example", false))).toBe("Not on any list. Not confirmed by the swarm. Not a guarantee.");
    expect(describeVerdict(verdict("shared.example", false, { allowlisted: true }))).toContain("allowlist");
    await expect(fetchVerdict("x.example", "https://dns.payhole.org", (() => Promise.resolve(jsonResponse(429, {}))))).rejects.toThrow(/rate limiting/);
  });

  it("remembers verdicts, longer for blocked names, and shares one request between concurrent callers", async () => {
    let now = NOW;
    const source = vi.fn((name: string) => Promise.resolve(verdict(name, name.startsWith("bad"))));
    const cache = new VerdictCache(source, { ttlMs: 1000, blockedTtlMs: 5000, now: () => now });
    const [a, b] = await Promise.all([cache.lookup("bad.example"), cache.lookup("bad.example")]);
    expect(a).toBe(b);
    expect(source).toHaveBeenCalledTimes(1);
    await cache.lookup("fine.example");
    expect(cache.known("fine.example")?.blocked).toBe(false);
    now += 1500;
    expect(cache.known("fine.example")).toBeNull();
    expect(cache.known("bad.example")?.blocked).toBe(true);
    expect(cache.blocked()).toEqual(["bad.example"]);
    now += 5000;
    expect(cache.known("bad.example")).toBeNull();
    await cache.lookup("fine.example");
    expect(source).toHaveBeenCalledTimes(3);
  });

  it("blocks a listed name unless it is allowlisted or was opened on purpose", async () => {
    expect(shouldBlock(verdict("bad.example", true), false)).toBe(true);
    expect(shouldBlock(verdict("bad.example", true), true)).toBe(false);
    expect(shouldBlock(verdict("shared.example", true, { allowlisted: true }), false)).toBe(false);
    expect(shouldBlock(verdict("fine.example", false), false)).toBe(false);
    let now = NOW;
    const store = memoryStore();
    const allow = new AllowOnce(store, () => now);
    await allow.load();
    expect(allow.isAllowed("bad.example")).toBe(false);
    await allow.allow("bad.example", 1000);
    expect(allow.isAllowed("bad.example")).toBe(true);
    const restored = new AllowOnce(store, () => now);
    await restored.load();
    expect(restored.isAllowed("bad.example")).toBe(true);
    now += 1001;
    expect(restored.isAllowed("bad.example")).toBe(false);
  });
});

describe("browser rules", () => {
  it("maps a host to a stable id in the shield range and a redirect rule that keeps the whole URL", () => {
    const id = shieldRuleId("bad.example");
    expect(isShieldRuleId(id)).toBe(true);
    expect(shieldRuleId("bad.example")).toBe(id);
    expect(shieldRuleId("other.example")).not.toBe(id);
    const rule = blockRule("bad.example", "chrome-extension://abc/check.html");
    expect(rule).toEqual({
      id,
      priority: 2,
      action: { type: "redirect", redirect: { regexSubstitution: "chrome-extension://abc/check.html?u=\\0" } },
      condition: { regexFilter: hostRegex("bad.example"), resourceTypes: ["main_frame"] },
    });
    const regex = new RegExp(rule.condition.regexFilter ?? "");
    expect(regex.test("https://bad.example/claim?x=1#frag")).toBe(true);
    expect(regex.test("http://www.bad.example:8080/")).toBe(true);
    expect(regex.test("https://bad.example")).toBe(true);
    expect(regex.test("https://notbad.example/")).toBe(false);
    expect(regex.test("https://bad.example.com/")).toBe(false);
    expect("https://bad.example/a?b=1&c=2#f".match(regex)?.[0]).toBe("https://bad.example/a?b=1&c=2#f");
  });

  it("round-trips a URL through the check page address, ampersands and fragments included", () => {
    const url = "https://bad.example/a?b=1&c=2#frag";
    const opened = new URL(checkPageUrl("chrome-extension://abc/check.html", url));
    expect(parseCheckPage(opened)).toBe(url);
    expect(parseCheckPage({ search: "", hash: "" })).toBeNull();
    expect(parseCheckPage({ search: "?u=", hash: "" })).toBeNull();
  });
});

describe("reports", () => {
  it("sends a name with its category and describes the answer", async () => {
    const fetchImpl = vi.fn(() => Promise.resolve(jsonResponse(200, { status: "hinted", domain: "new.example", hints: 1 })));
    const result = await sendReport("https://dns.payhole.org", { name: "new.example", category: "phishing", reason: " seen in a dm " }, fetchImpl);
    expect(result).toEqual({ status: "hinted", domain: "new.example", hints: 1 });
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, { body: string }];
    expect(JSON.parse(init.body)).toEqual({ name: "new.example", category: "phishing", reason: "seen in a dm" });
    expect(describeReport(result)).toBe("Counted. First report.");
    expect(describeReport({ status: "flagged", domain: "new.example", reporters: 1 })).toBe("Flagged. 1 reporter so far.");
    expect(describeReport({ status: "already_blocked", domain: "new.example" })).toBe("Already blocked.");
    await expect(sendReport("https://dns.payhole.org", { name: "x.example" }, (() => Promise.resolve(jsonResponse(200, { nope: 1 }))))).rejects.toThrow(/not a report result/);
  });
});
