import { describe, expect, it, vi } from "vitest";
import { CURATED_LIMIT, CURATED_RULE_ID_MIN, curatedRules, fetchCurated, isCuratedRuleId, parseNames } from "../lib/curated";

describe("the PayHole list inside the browser", () => {
  it("reads one name per line and turns names into block rules for everything but the document", () => {
    expect(parseNames("# PayHole list\n\nDrain.Evil\n0.0.0.0 kit.example\nnot a host!\nkit.example\n")).toEqual(["drain.evil", "kit.example"]);
    const rules = curatedRules(["kit.example", "drain.evil", "kit.example"], new Set(["drain.evil"]));
    expect(rules).toHaveLength(1);
    expect(rules[0]).toEqual({ id: CURATED_RULE_ID_MIN, priority: 1, action: { type: "block" }, condition: { urlFilter: "||kit.example^", resourceTypes: expect.not.arrayContaining(["main_frame"]) as string[] } });
    expect(rules[0]?.condition.resourceTypes).toContain("script");
    expect(isCuratedRuleId(CURATED_RULE_ID_MIN)).toBe(true);
    expect(isCuratedRuleId(CURATED_RULE_ID_MIN - 1)).toBe(false);
    expect(curatedRules(Array.from({ length: CURATED_LIMIT + 5 }, (_, i) => `n${i}.example`))).toHaveLength(CURATED_LIMIT);
  });

  it("fetches the list with its etag and treats 304 as current", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    fetchImpl.mockResolvedValueOnce({ status: 200, ok: true, headers: { get: (name: string) => (name === "etag" ? '"v1"' : null) }, text: () => Promise.resolve("kit.example\ndrain.evil\n") } as unknown as Response);
    fetchImpl.mockResolvedValueOnce({ status: 304, ok: false, headers: { get: () => null }, text: () => Promise.resolve("") } as unknown as Response);
    fetchImpl.mockResolvedValueOnce({ status: 500, ok: false, headers: { get: () => null }, text: () => Promise.resolve("") } as unknown as Response);
    const first = await fetchCurated("https://dns.payhole.org/", null, fetchImpl);
    expect(first).toEqual({ status: 200, names: ["drain.evil", "kit.example"], etag: '"v1"' });
    expect(fetchImpl).toHaveBeenCalledWith("https://dns.payhole.org/lists/payhole.txt", { headers: { accept: "text/plain" } });
    const second = await fetchCurated("https://dns.payhole.org", '"v1"', fetchImpl);
    expect(second).toEqual({ status: 304, names: [], etag: '"v1"' });
    expect((fetchImpl.mock.calls[1]?.[1] as { headers: Record<string, string> }).headers["if-none-match"]).toBe('"v1"');
    await expect(fetchCurated("https://dns.payhole.org", null, fetchImpl)).rejects.toThrow(/500/);
  });
});
