import { describe, expect, it } from "vitest";
import { allocateRuleId, exactUrlCondition, isNavigationRuleId, NAVIGATION_RULE_ID_MAX, NAVIGATION_RULE_ID_MIN, navigationRule } from "../lib/dnr";

describe("declarativeNetRequest rules", () => {
  it("builds a session rule that sets the payment header for one tab and URL", () => {
    const rule = navigationRule(100_001, "https://api.example/paid?x=1", 7, "payment-signature", "abc==");
    expect(rule).toEqual({
      id: 100_001,
      priority: 1,
      action: { type: "modifyHeaders", requestHeaders: [{ header: "payment-signature", operation: "set", value: "abc==" }] },
      condition: { urlFilter: "|https://api.example/paid?x=1|", isUrlFilterCaseSensitive: true, resourceTypes: ["main_frame"], tabIds: [7] },
    });
  });

  it("falls back to an anchored regex when the URL carries filter metacharacters", () => {
    const condition = exactUrlCondition("https://api.example/a|b?q=*");
    expect(condition.urlFilter).toBeUndefined();
    expect(condition.regexFilter).toBe("^https://api\\.example/a\\|b\\?q=\\*$");
    expect(new RegExp(condition.regexFilter!).test("https://api.example/a|b?q=*")).toBe(true);
    expect(new RegExp(condition.regexFilter!).test("https://api.example/a|b?q=1")).toBe(false);
  });

  it("uses the normalised href", () => {
    expect(exactUrlCondition("HTTPS://API.example/p%20q").urlFilter).toBe("|https://api.example/p%20q|");
  });

  it("allocates ids inside the reserved range", () => {
    const ids = new Set<number>();
    for (let i = 0; i < 5; i++) ids.add(allocateRuleId());
    expect(ids.size).toBe(5);
    for (const id of ids) {
      expect(isNavigationRuleId(id)).toBe(true);
      expect(id).toBeGreaterThanOrEqual(NAVIGATION_RULE_ID_MIN);
      expect(id).toBeLessThanOrEqual(NAVIGATION_RULE_ID_MAX);
    }
    expect(isNavigationRuleId(1)).toBe(false);
  });
});
