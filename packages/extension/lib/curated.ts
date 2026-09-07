/**
 * The PayHole list inside the browser: the names the network itself vouches for (confirmed by the swarm or added
 * by an operator, a few hundred at most), plus the person's own blocklist, turned into rules that drop every
 * request to those names. Top-level navigations are left to the shield's own wall; these rules catch what a page
 * pulls in: the drainer script, the frame, the beacon.
 */
import type { Browser } from "wxt/browser";

export const CURATED_RULE_ID_MIN = 300_000;
export const CURATED_RULE_ID_MAX = 399_999;
/** More names than this and the browser's rule budget is at risk; the list is far smaller in practice. */
export const CURATED_LIMIT = 2000;
export const CURATED_KEY = "curatedList";

export interface CuratedState {
  names: string[];
  fetchedAt: number | null;
  etag: string | null;
  error: string | null;
}

export const EMPTY_CURATED: CuratedState = { names: [], fetchedAt: null, etag: null, error: null };

/** Everything but the top-level document, which the shield answers with its wall instead. */
export const SUBRESOURCE_TYPES = ["sub_frame", "stylesheet", "script", "image", "font", "object", "xmlhttprequest", "ping", "media", "websocket", "other"] as const;

const HOST = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,62}$/;

/** One hostname per line, comments and blanks skipped, lowercase, without repeats. */
export function parseNames(text: string): string[] {
  const out = new Set<string>();
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.split("#")[0]?.trim().toLowerCase() ?? "";
    if (line.length === 0) continue;
    const name = line.split(/\s+/).pop() ?? "";
    if (HOST.test(name)) out.add(name);
  }
  return [...out].sort();
}

export function isCuratedRuleId(id: number): boolean {
  return id >= CURATED_RULE_ID_MIN && id <= CURATED_RULE_ID_MAX;
}

/** A rule dropping every request, except the document itself, to `name` and its subdomains. */
export function curatedRule(id: number, name: string): Browser.declarativeNetRequest.Rule {
  return { id, priority: 1, action: { type: "block" }, condition: { urlFilter: `||${name}^`, resourceTypes: [...SUBRESOURCE_TYPES] } };
}

/** Rules for every name, ids in the curated range, in a stable order; names being allowed for a while are left out. */
export function curatedRules(names: readonly string[], except: ReadonlySet<string> = new Set()): Browser.declarativeNetRequest.Rule[] {
  const kept = [...new Set(names)].filter((name) => !except.has(name)).sort().slice(0, CURATED_LIMIT);
  return kept.map((name, index) => curatedRule(CURATED_RULE_ID_MIN + index, name));
}

/** Fetches the resolver's PayHole list with a conditional request; 304 means what we have is current. */
export async function fetchCurated(resolver: string, etag: string | null, fetchImpl: typeof fetch = fetch): Promise<{ status: 200 | 304; names: string[]; etag: string | null }> {
  const headers: Record<string, string> = { accept: "text/plain" };
  if (etag) headers["if-none-match"] = etag;
  const response = await fetchImpl(`${resolver.replace(/\/+$/, "")}/lists/payhole.txt`, { headers });
  if (response.status === 304) return { status: 304, names: [], etag };
  if (!response.ok) throw new Error(`the resolver answered ${response.status}`);
  return { status: 200, names: parseNames(await response.text()), etag: response.headers.get("etag") };
}
