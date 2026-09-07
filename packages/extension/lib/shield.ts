/**
 * The shield: what the public resolver says about a name, remembered for a while, and what the browser does
 * about it. Verdicts come from the same `GET /verdict?name=` the app and the check page use, so a name blocked on
 * the phone is blocked here for the same reason. Nothing here needs a wallet.
 */
import type { Browser } from "wxt/browser";
import type { KeyValueStore } from "./storage";

export type Category = "infra" | "drainer" | "phishing" | "counterfeit" | "tracker" | "ad" | "other";

export const CATEGORIES: readonly Category[] = ["infra", "drainer", "phishing", "counterfeit", "tracker", "ad", "other"];

/** The categories a person can report from the browser; trackers and ads come from lists, not reports. */
export const REPORT_CATEGORIES: readonly Category[] = ["drainer", "phishing", "counterfeit", "infra"];

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

export const CATEGORY_LABELS: Record<Category, string> = {
  infra: "drainer infrastructure",
  drainer: "wallet drainer",
  phishing: "phishing",
  counterfeit: "counterfeit token",
  tracker: "tracker",
  ad: "ad",
  other: "blocked",
};

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

/** The hostname of an http(s) URL the resolver can be asked about: lowercase, dotted, not an address. Null otherwise. */
export function hostnameOf(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  const host = parsed.hostname.toLowerCase().replace(/\.$/, "");
  return HOST.test(host) ? host : null;
}

/**
 * The hostname a person meant when they pasted `input`: the host of the first URL in the text, or the first bare
 * hostname. Null when nothing in the text looks like a name.
 */
export function extractName(input: string): string | null {
  const text = input.trim();
  if (text.length === 0) return null;
  for (const token of text.split(/[\s<>"'()[\]{}]+/)) {
    if (token.length === 0) continue;
    const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(token) ? token : /^[a-z0-9.-]+\.[a-z][a-z0-9-]*(?::\d+)?(?:[/?#]|$)/i.test(token) ? `https://${token}` : null;
    if (withScheme === null) continue;
    const host = hostnameOf(withScheme);
    if (host) return host;
  }
  return null;
}

/** Asks the resolver's public verdict endpoint about `name`. Throws on network errors or a refused name. */
export async function fetchVerdict(name: string, resolver: string, fetchImpl: typeof fetch = fetch): Promise<Verdict> {
  const response = await fetchImpl(`${resolver.replace(/\/+$/, "")}/verdict?name=${encodeURIComponent(name)}`, { headers: { accept: "application/json" } });
  if (response.status === 429) throw new Error("The resolver is rate limiting this browser. Try again in a minute.");
  if (!response.ok) throw new Error(`The resolver refused the name (${response.status}).`);
  const body = (await response.json()) as Partial<Verdict>;
  if (typeof body.domain !== "string" || typeof body.blocked !== "boolean") throw new Error("The resolver sent an answer this extension does not understand.");
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

/** One line a person can read. */
export function describeVerdict(v: Verdict): string {
  if (v.allowlisted) return "On the allowlist. A shared platform that stays reachable.";
  if (!v.blocked) return "Not on any list. Not confirmed by the swarm. Not a guarantee.";
  const what = v.category ? CATEGORY_PHRASES[v.category] : null;
  const by = v.sources.includes("swarm")
    ? `Confirmed by ${v.reporters} node${v.reporters === 1 ? "" : "s"} in the swarm.`
    : v.sources.includes("list")
      ? "On a subscribed list."
      : v.sources.includes("manual")
        ? "Blocked by an operator."
        : "Flagged by a PayHole user.";
  return what && what !== "blocked" ? `${what.charAt(0).toUpperCase()}${what.slice(1)}. ${by}` : by;
}

export interface VerdictCacheOptions {
  /** How long a "not blocked" answer is trusted. */
  ttlMs?: number | undefined;
  /** How long a "blocked" answer is trusted; longer, because a listed name rarely comes back. */
  blockedTtlMs?: number | undefined;
  now?: (() => number) | undefined;
}

/** Verdicts by hostname, each trusted for a while, with one request in flight per name at most. */
export class VerdictCache {
  private readonly entries = new Map<string, { verdict: Verdict; at: number }>();
  private readonly inflight = new Map<string, Promise<Verdict>>();
  private readonly ttl: number;
  private readonly blockedTtl: number;
  private readonly now: () => number;

  constructor(
    private readonly source: (name: string) => Promise<Verdict>,
    options: VerdictCacheOptions = {},
  ) {
    this.ttl = options.ttlMs ?? 10 * 60_000;
    this.blockedTtl = options.blockedTtlMs ?? 60 * 60_000;
    this.now = options.now ?? (() => Date.now());
  }

  /** The remembered verdict when it is still fresh. */
  known(host: string): Verdict | null {
    const entry = this.entries.get(host);
    if (!entry) return null;
    const ttl = entry.verdict.blocked ? this.blockedTtl : this.ttl;
    if (this.now() - entry.at >= ttl) {
      this.entries.delete(host);
      return null;
    }
    return entry.verdict;
  }

  /** The verdict, from memory or from the resolver; concurrent callers share one request. */
  lookup(host: string): Promise<Verdict> {
    const fresh = this.known(host);
    if (fresh) return Promise.resolve(fresh);
    let pending = this.inflight.get(host);
    if (!pending) {
      pending = this.source(host)
        .then((verdict) => {
          this.entries.set(host, { verdict, at: this.now() });
          return verdict;
        })
        .finally(() => this.inflight.delete(host));
      this.inflight.set(host, pending);
    }
    return pending;
  }

  forget(host: string): void {
    this.entries.delete(host);
  }

  clear(): void {
    this.entries.clear();
  }

  /** Blocked names remembered right now, for rebuilding the browser's own rules. */
  blocked(): string[] {
    const out: string[] = [];
    for (const host of this.entries.keys()) if (this.known(host)?.blocked) out.push(host);
    return out.sort();
  }
}

export const SHIELD_ALLOW_KEY = "shieldAllow";
export const SHIELD_RECENT_KEY = "shieldRecent";
export const RECENT_EVENTS_KEPT = 50;

/** Something the shield did this session: stopped a navigation, or let one through on purpose. */
export interface ShieldEvent {
  host: string;
  url: string;
  category: Category | null;
  action: "blocked" | "opened";
  at: number;
}
export const ALLOW_ONCE_MS = 10 * 60_000;

/** Names a person chose to open anyway, each for a short while; kept in session storage so a worker restart forgets nothing. */
export class AllowOnce {
  private allowed: Record<string, number> = {};

  constructor(
    private readonly store: KeyValueStore,
    private readonly now: () => number = () => Date.now(),
  ) {}

  async load(): Promise<void> {
    this.allowed = (await this.store.get<Record<string, number>>(SHIELD_ALLOW_KEY)) ?? {};
  }

  isAllowed(host: string): boolean {
    const until = this.allowed[host];
    return until !== undefined && until > this.now();
  }

  async allow(host: string, forMs = ALLOW_ONCE_MS): Promise<number> {
    const until = this.now() + forMs;
    this.allowed = { ...this.prune(), [host]: until };
    await this.store.set(SHIELD_ALLOW_KEY, this.allowed);
    return until;
  }

  private prune(): Record<string, number> {
    const now = this.now();
    return Object.fromEntries(Object.entries(this.allowed).filter(([, until]) => until > now));
  }
}

/** Session rule ids for the shield live in this range; each blocked host maps to one id. */
export const SHIELD_RULE_ID_MIN = 200_000;
export const SHIELD_RULE_ID_MAX = 299_999;

export function isShieldRuleId(id: number): boolean {
  return id >= SHIELD_RULE_ID_MIN && id <= SHIELD_RULE_ID_MAX;
}

/** A stable rule id for a host (FNV-1a over the name, folded into the range). */
export function shieldRuleId(host: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < host.length; index += 1) {
    hash ^= host.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return SHIELD_RULE_ID_MIN + (hash % (SHIELD_RULE_ID_MAX - SHIELD_RULE_ID_MIN + 1));
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** The regex that matches every http(s) URL on `host` or a subdomain of it, whole URL included, for `\0`. */
export function hostRegex(host: string): string {
  return `^https?://(?:[^/]+\\.)?${escapeRegex(host)}(?::\\d+)?(?:[/?#].*)?$`;
}

/**
 * A session rule sending every top-level navigation to `host` straight to the check page, so a name the resolver
 * already called blocked never loads again this session, worker asleep or not.
 */
export function blockRule(host: string, checkPage: string): Browser.declarativeNetRequest.Rule {
  return {
    id: shieldRuleId(host),
    priority: 2,
    action: { type: "redirect", redirect: { regexSubstitution: `${checkPage}?u=\\0` } },
    condition: { regexFilter: hostRegex(host), resourceTypes: ["main_frame"] },
  };
}

/** The check page's address for a URL; the URL goes in raw so nothing in it is lost, and `parseCheckPage` reads it back. */
export function checkPageUrl(checkPage: string, url: string): string {
  return `${checkPage}?u=${url}`;
}

/** The URL a check page was opened for, from its own location; null when it was opened plain. */
export function parseCheckPage(location: { search: string; hash: string }): string | null {
  if (!location.search.startsWith("?u=")) return null;
  const raw = location.search.slice(3) + location.hash;
  return raw.length > 0 ? raw : null;
}

/** Whether a navigation should be stopped: blocked by the resolver, not allowlisted, and not opened on purpose. */
export function shouldBlock(verdict: Verdict, allowed: boolean): boolean {
  return verdict.blocked && !verdict.allowlisted && !allowed;
}
