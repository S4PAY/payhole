/**
 * What a blocked name is. Every block on a node carries one of these, whichever source caught it, so the
 * query log, the dashboard, the verdict endpoint, and the phone app can say "wallet drainer" instead of
 * "blocked". The order is the priority when several sources disagree: the strongest claim wins.
 */
export const CATEGORIES = ["infra", "drainer", "phishing", "counterfeit", "tracker", "ad", "other"] as const;

export type Category = (typeof CATEGORIES)[number];

/** Categories that mean money at risk. Only these ever produce a notification or a fast-lane confirmation. */
export const DANGEROUS: ReadonlySet<Category> = new Set<Category>(["infra", "drainer", "phishing", "counterfeit"]);

export const CATEGORY_LABELS: Record<Category, string> = {
  infra: "drainer infrastructure",
  drainer: "wallet drainer",
  phishing: "phishing",
  counterfeit: "counterfeit token",
  tracker: "tracker",
  ad: "ad",
  other: "other",
};

const INDEX = new Map<string, number>(CATEGORIES.map((c, i) => [c, i]));

export function isCategory(value: unknown): value is Category {
  return typeof value === "string" && INDEX.has(value);
}

export function parseCategory(value: unknown): Category | null {
  return isCategory(value) ? value : null;
}

/** The stronger of two claims, by the order of {@link CATEGORIES}; null loses to anything. */
export function strongest(a: Category | null, b: Category | null): Category | null {
  if (a === null) return b;
  if (b === null) return a;
  return (INDEX.get(a) ?? 99) <= (INDEX.get(b) ?? 99) ? a : b;
}

/** Sorts categories strongest first. */
export function byPriority(a: Category, b: Category): number {
  return (INDEX.get(a) ?? 99) - (INDEX.get(b) ?? 99);
}

/**
 * The category a list gets when it is subscribed without one, from the lists we know. Anything else is
 * "other" until the operator says otherwise on the Lists tab.
 */
export function defaultCategoryFor(url: string): Category {
  const u = url.toLowerCase();
  if (u.includes("drainer-infra")) return "infra";
  if (u.includes("scamsniffer") || u.includes("eth-phishing-detect")) return "drainer";
  if (u.includes("phishing")) return "phishing";
  if (u.includes("stevenblack") || u.includes("adaway") || u.includes("easylist") || u.includes("oisd")) return "ad";
  if (u.includes("tracker")) return "tracker";
  return "other";
}
