import { describe, expect, it } from "vitest";
import { byPriority, CATEGORIES, DANGEROUS, defaultCategoryFor, parseCategory, strongest, type Category } from "../src/category.js";

describe("categories", () => {
  it("parses only known categories", () => {
    for (const category of CATEGORIES) expect(parseCategory(category)).toBe(category);
    expect(parseCategory("malware")).toBeNull();
    expect(parseCategory(3)).toBeNull();
    expect(parseCategory(undefined)).toBeNull();
  });

  it("ranks drainer infrastructure above everything and null below anything", () => {
    expect(strongest("ad", "drainer")).toBe("drainer");
    expect(strongest("phishing", "infra")).toBe("infra");
    expect(strongest(null, "tracker")).toBe("tracker");
    expect(strongest("other", null)).toBe("other");
    expect(strongest(null, null)).toBeNull();
    expect([...CATEGORIES].sort(byPriority)).toEqual([...CATEGORIES]);
    const mixed: Category[] = ["ad", "infra", "phishing"];
    expect(mixed.sort(byPriority)).toEqual(["infra", "phishing", "ad"]);
  });

  it("marks the money-at-risk categories as dangerous", () => {
    expect([...DANGEROUS].sort()).toEqual(["counterfeit", "drainer", "infra", "phishing"]);
  });

  it("guesses the category of the lists we know from their URL", () => {
    expect(defaultCategoryFor("https://raw.githubusercontent.com/scamsniffer/scam-database/refs/heads/main/blacklist/domains.json")).toBe("drainer");
    expect(defaultCategoryFor("https://raw.githubusercontent.com/Phishing-Database/Phishing.Database/master/phishing-domains-ACTIVE.txt")).toBe("phishing");
    expect(defaultCategoryFor("https://raw.githubusercontent.com/StevenBlack/hosts/master/hosts")).toBe("ad");
    expect(defaultCategoryFor("https://raw.githubusercontent.com/S4PAY/payhole/main/packages/sinkhole/lists/drainer-infra.txt")).toBe("infra");
    expect(defaultCategoryFor("https://example.org/some-list.txt")).toBe("other");
  });
});
