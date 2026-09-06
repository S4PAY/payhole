import { LINKS } from "../links";

/** What a Sinkhole node says about a name; the shape of `GET /verdict?name=`. */
export interface Verdict {
  domain: string;
  blocked: boolean;
  allowlisted: boolean;
  category: Category | null;
  sources: string[];
  reasons: string[];
  reporters: number;
  confirmed: boolean;
  checkedAt: number;
}

export type Category = "infra" | "drainer" | "phishing" | "counterfeit" | "tracker" | "ad" | "other";

export const CATEGORY_LABELS: Record<Category, string> = {
  infra: "drainer infrastructure",
  drainer: "wallet drainer",
  phishing: "phishing",
  counterfeit: "counterfeit token",
  tracker: "tracker",
  ad: "ad",
  other: "blocked",
};

/** The same categories as the subject of a sentence: "kit.example is a wallet drainer". */
const CATEGORY_PHRASES: Record<Category, string> = {
  infra: "drainer infrastructure",
  drainer: "a wallet drainer",
  phishing: "a phishing page",
  counterfeit: "a counterfeit token site",
  tracker: "a tracker",
  ad: "an ad server",
  other: "blocked",
};

const DANGEROUS: ReadonlySet<string> = new Set(["infra", "drainer", "phishing", "counterfeit"]);

export function isCategory(value: unknown): value is Category {
  return typeof value === "string" && value in CATEGORY_LABELS;
}

export function isDangerous(category: string | null | undefined): boolean {
  return category !== null && category !== undefined && DANGEROUS.has(category);
}

export function categoryLabel(category: string | null | undefined): string {
  return isCategory(category) ? CATEGORY_LABELS[category] : "blocked";
}

const HOST = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,62}$/;

/**
 * The hostname a person meant when they shared or pasted `input`: the host of the first URL in the
 * text, or the first bare hostname, lowercased and stripped of a trailing dot. Null when nothing in
 * the text looks like a name.
 */
export function extractName(input: string): string | null {
  const text = input.trim();
  if (text.length === 0) return null;
  for (const token of text.split(/[\s<>"'()[\]{}]+/)) {
    if (token.length === 0) continue;
    const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(token) ? token : /^[a-z0-9.-]+\.[a-z][a-z0-9-]*(?::\d+)?(?:[/?#]|$)/i.test(token) ? `https://${token}` : null;
    if (withScheme === null) continue;
    let host: string;
    try {
      host = new URL(withScheme).hostname;
    } catch {
      continue;
    }
    host = host.toLowerCase().replace(/\.$/, "");
    if (host.startsWith("[")) continue;
    if (HOST.test(host)) return host;
  }
  return null;
}

/** Asks the resolver's public verdict endpoint about `name`. Throws on network errors or a refused name. */
export async function fetchVerdict(name: string, baseUrl: string = LINKS.verdictUrl, fetchImpl: typeof fetch = fetch): Promise<Verdict> {
  const response = await fetchImpl(`${baseUrl}?name=${encodeURIComponent(name)}`, { headers: { accept: "application/json" } });
  if (response.status === 429) throw new Error("The resolver is rate limiting this phone. Try again in a minute.");
  if (!response.ok) throw new Error(`The resolver refused the name (${response.status}).`);
  const body = (await response.json()) as Partial<Verdict>;
  if (typeof body.domain !== "string" || typeof body.blocked !== "boolean") throw new Error("The resolver sent an answer this app does not understand.");
  return {
    domain: body.domain,
    blocked: body.blocked,
    allowlisted: body.allowlisted === true,
    category: isCategory(body.category) ? body.category : null,
    sources: Array.isArray(body.sources) ? body.sources.filter((s): s is string => typeof s === "string") : [],
    reasons: Array.isArray(body.reasons) ? body.reasons.filter((s): s is string => typeof s === "string") : [],
    reporters: typeof body.reporters === "number" ? body.reporters : 0,
    confirmed: body.confirmed === true,
    checkedAt: typeof body.checkedAt === "number" ? body.checkedAt : Date.now(),
  };
}

/** One line a person can read or share. */
export function describeVerdict(v: Verdict): string {
  if (v.allowlisted) return `${v.domain} is on PayHole's allowlist: a shared platform that stays reachable even when a list names it.`;
  if (!v.blocked) return `${v.domain} is not on any PayHole list and the swarm has not confirmed it. That is not a guarantee, only what the network knows.`;
  const what = v.category ? CATEGORY_PHRASES[v.category] : "blocked";
  const by = v.sources.includes("swarm")
    ? `confirmed by ${v.reporters} node${v.reporters === 1 ? "" : "s"} in the swarm`
    : v.sources.includes("list")
      ? "on a subscribed list"
      : v.sources.includes("manual")
        ? "blocked by an operator"
        : "flagged by the extension";
  return `${v.domain} is ${what}, ${by}. PayHole users never load it.`;
}

export function shareText(v: Verdict): string {
  return `${describeVerdict(v)}\n\nChecked with PayHole, ${new Date(v.checkedAt).toISOString().slice(0, 16).replace("T", " ")} UTC. Check any link: https://payhole.org/check.html`;
}
