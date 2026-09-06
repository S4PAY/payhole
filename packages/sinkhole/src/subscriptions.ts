import { readdir, readFile, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { isIP } from "node:net";
import { normalizeHostname } from "./hostname.js";
import { defaultCategoryFor, parseCategory, strongest, type Category } from "./category.js";
import { readJson, writeFileAtomic, writeJsonAtomic } from "./store.js";

/** One subscribed public blocklist: a hosts-format or one-per-line file fetched on a schedule. */
export interface Subscription {
  id: string;
  url: string;
  /** What names on this list are; blocks from the list carry it. */
  category: Category;
  addedAt: number;
  lastFetchedAt: number | null;
  lastSuccessAt: number | null;
  lastError: string | null;
  entries: number;
  bytes: number;
  etag: string | null;
  lastModified: string | null;
}

export interface SubscriptionInfo extends Subscription {
  nextRefreshAt: number | null;
}

export interface RefreshResult {
  ok: boolean;
  changed: boolean;
  entries: number;
  error: string | null;
}

export interface SubscriptionsOptions {
  /** Directory holding `subscriptions.json` and one `<id>.txt` per list. */
  dir: string;
  refreshMs: number;
  fetch?: typeof fetch;
  timeoutMs?: number;
  maxBytes?: number;
  clock?: () => number;
  log?: (line: string) => void;
  /** Turns a fetched body into names; blocklists by default, allowlist rules for an allowlist instance. */
  parse?: (text: string) => { domains: Set<string>; invalid: number };
  /** Name of the environment variable the URLs came from, for error messages. */
  label?: string;
}

/** One refresh that changed a list: how it grew and the names it gained, for the radar. */
export interface RefreshEvent {
  at: number;
  entries: number;
  added: number;
  removed: number;
  /** The names gained, at most HISTORY_NAMES of them. */
  names: string[];
}

interface HistoryFile {
  version: 1;
  items: Record<string, RefreshEvent[]>;
}

const HISTORY_EVENTS = 12;
const HISTORY_NAMES = 5000;

interface StateFile {
  version: 1;
  items: Subscription[];
}

const RETRY_MS = 15 * 60_000;
const DEFAULT_MAX_BYTES = 32 * 1024 * 1024;

export function subscriptionId(url: string): string {
  return createHash("sha256").update(url).digest("hex").slice(0, 12);
}

/** Accepts http(s) URLs without credentials; returns the normalised URL or null. */
export function normalizeListUrl(input: string): string | null {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (url.username || url.password) return null;
  url.hash = "";
  return url.toString();
}

/**
 * Parses a blocklist in hosts format (`0.0.0.0 domain`, several names per line allowed) or one hostname per
 * line. `#` starts a comment. Names that are not real hostnames (localhost, IP literals, AdBlock syntax) are
 * counted as invalid and skipped.
 */
/**
 * Lists published as JSON: an array of hostnames, or an object with a `domains` array (the ScamSniffer scam
 * database uses the array form). Anything else returns null so the text parser takes over.
 */
function parseJsonList(text: string): string[] | null {
  const head = text.slice(0, 64).trimStart();
  if (!head.startsWith("[") && !head.startsWith("{")) return null;
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  const record = typeof value === "object" && value !== null ? (value as { domains?: unknown; blacklist?: unknown }) : null;
  const items = Array.isArray(value) ? value : record && Array.isArray(record.domains) ? record.domains : record && Array.isArray(record.blacklist) ? record.blacklist : null;
  if (!items) return null;
  return items.filter((v): v is string => typeof v === "string");
}

export function parseListText(text: string): { domains: Set<string>; invalid: number } {
  const domains = new Set<string>();
  let invalid = 0;
  const json = parseJsonList(text);
  if (json) {
    for (const name of json) {
      const domain = normalizeHostname(name);
      if (domain) domains.add(domain);
      else invalid += 1;
    }
    return { domains, invalid };
  }
  for (const rawLine of text.split(/\r?\n/)) {
    const hash = rawLine.indexOf("#");
    const line = (hash >= 0 ? rawLine.slice(0, hash) : rawLine).trim();
    if (line.length === 0) continue;
    const parts = line.split(/\s+/);
    const first = parts[0];
    const names = first !== undefined && isIP(first) !== 0 ? parts.slice(1) : parts;
    if (names.length === 0) {
      invalid += 1;
      continue;
    }
    for (const name of names) {
      const domain = normalizeHostname(name);
      if (domain) domains.add(domain);
      else invalid += 1;
    }
  }
  return { domains, invalid };
}

interface FetchOutcome {
  status: 200 | 304;
  text: string;
  etag: string | null;
  lastModified: string | null;
  bytes: number;
}

async function fetchList(fetchImpl: typeof fetch, item: Subscription, timeoutMs: number, maxBytes: number): Promise<FetchOutcome> {
  const headers: Record<string, string> = { accept: "text/plain, */*;q=0.5", "user-agent": "payhole-sinkhole" };
  if (item.etag) headers["if-none-match"] = item.etag;
  if (item.lastModified) headers["if-modified-since"] = item.lastModified;
  const res = await fetchImpl(item.url, { headers, redirect: "follow", signal: AbortSignal.timeout(timeoutMs) });
  if (res.status === 304) return { status: 304, text: "", etag: item.etag, lastModified: item.lastModified, bytes: 0 };
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const declared = Number(res.headers.get("content-length") ?? "0");
  if (declared > maxBytes) throw new Error(`list is ${declared} bytes, more than the ${maxBytes} byte limit`);
  const chunks: Uint8Array[] = [];
  let size = 0;
  const body = res.body;
  if (!body) throw new Error("empty response");
  const reader = body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      throw new Error(`list exceeds the ${maxBytes} byte limit`);
    }
    chunks.push(value);
  }
  const text = new TextDecoder().decode(Buffer.concat(chunks));
  return { status: 200, text, etag: res.headers.get("etag"), lastModified: res.headers.get("last-modified"), bytes: size };
}

/**
 * Subscriptions to public blocklists. Each list is fetched with conditional headers, parsed, stored as one
 * domain per line under `dir`, and merged into the union that `domains()` returns. The union feeds the
 * resolver's hosts file; the curated sources stay separate.
 */
export class Subscriptions {
  private readonly items = new Map<string, Subscription>();
  private readonly lists = new Map<string, Set<string>>();
  private readonly listeners = new Set<() => void>();
  private union: Set<string> | null = null;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly maxBytes: number;
  private readonly clock: () => number;
  private readonly refreshMs: number;
  private readonly dir: string;
  private readonly log: (line: string) => void;
  private readonly inFlight = new Map<string, Promise<RefreshResult>>();
  private readonly parse: (text: string) => { domains: Set<string>; invalid: number };
  private readonly label: string;
  /** Refreshes that changed each list, oldest first, capped; only kept once a baseline existed. */
  private readonly history = new Map<string, RefreshEvent[]>();

  private constructor(options: SubscriptionsOptions) {
    this.dir = options.dir;
    this.refreshMs = options.refreshMs;
    this.fetchImpl = options.fetch ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
    this.clock = options.clock ?? Date.now;
    this.log = options.log ?? (() => undefined);
    this.parse = options.parse ?? parseListText;
    this.label = options.label ?? "BLOCKLIST_URLS";
  }

  /** Loads the saved subscriptions and their cached lists; `urls` from the environment are added when missing. */
  static async load(options: SubscriptionsOptions, urls: string[] = []): Promise<Subscriptions> {
    const subs = new Subscriptions(options);
    const state = await readJson<StateFile>(join(options.dir, "subscriptions.json"));
    if (state?.version === 1) {
      for (const item of state.items) {
        const url = normalizeListUrl(item.url);
        if (!url) continue;
        subs.items.set(item.id, { ...item, url, category: parseCategory((item as Partial<Subscription>).category) ?? defaultCategoryFor(url) });
        try {
          const text = await readFile(subs.listPath(item.id), "utf8");
          subs.lists.set(item.id, new Set(text.split("\n").filter((line) => line.length > 0)));
        } catch {
          subs.lists.set(item.id, new Set());
        }
      }
    }
    const history = await readJson<HistoryFile>(join(options.dir, "history.json"));
    if (history?.version === 1) {
      for (const [id, events] of Object.entries(history.items)) {
        if (subs.items.has(id) && Array.isArray(events)) subs.history.set(id, events.slice(-HISTORY_EVENTS));
      }
    }
    for (const raw of urls) {
      const url = normalizeListUrl(raw);
      if (!url) throw new Error(`${subs.label} entry ${JSON.stringify(raw)} is not an http(s) URL`);
      if (!subs.byUrl(url)) subs.items.set(subscriptionId(url), subs.fresh(url));
    }
    await subs.cleanOrphans();
    subs.union = null;
    return subs;
  }

  private fresh(url: string, category?: Category): Subscription {
    return {
      id: subscriptionId(url),
      url,
      category: category ?? defaultCategoryFor(url),
      addedAt: this.clock(),
      lastFetchedAt: null,
      lastSuccessAt: null,
      lastError: null,
      entries: 0,
      bytes: 0,
      etag: null,
      lastModified: null,
    };
  }

  private listPath(id: string): string {
    return join(this.dir, `${id}.txt`);
  }

  private byUrl(url: string): Subscription | undefined {
    for (const item of this.items.values()) if (item.url === url) return item;
    return undefined;
  }

  private async cleanOrphans(): Promise<void> {
    let names: string[];
    try {
      names = await readdir(this.dir);
    } catch {
      return;
    }
    for (const name of names) {
      const match = /^([0-9a-f]{12})\.txt$/.exec(name);
      if (match?.[1] !== undefined && !this.items.has(match[1])) await rm(join(this.dir, name), { force: true });
    }
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    this.union = null;
    for (const listener of this.listeners) listener();
  }

  private async persist(): Promise<void> {
    await writeJsonAtomic(join(this.dir, "subscriptions.json"), { version: 1, items: this.list() } satisfies StateFile);
  }

  private async persistHistory(): Promise<void> {
    await writeJsonAtomic(join(this.dir, "history.json"), { version: 1, items: Object.fromEntries(this.history) } satisfies HistoryFile);
  }

  /** Refreshes that changed the list, oldest first; empty for a list that never had a baseline. */
  historyOf(id: string): RefreshEvent[] {
    return [...(this.history.get(id) ?? [])];
  }

  private info(item: Subscription): SubscriptionInfo {
    const next = item.lastSuccessAt === null ? (item.lastFetchedAt === null ? this.clock() : item.lastFetchedAt + RETRY_MS) : item.lastSuccessAt + this.refreshMs;
    return { ...item, nextRefreshAt: next };
  }

  list(): SubscriptionInfo[] {
    return [...this.items.values()].map((item) => this.info(item)).sort((a, b) => a.addedAt - b.addedAt);
  }

  get(id: string): SubscriptionInfo | undefined {
    const item = this.items.get(id);
    return item ? this.info(item) : undefined;
  }

  get size(): number {
    return this.items.size;
  }

  /** Every domain from every list; the same set instance is returned until a list changes. */
  domains(): Set<string> {
    if (!this.union) {
      const union = new Set<string>();
      for (const list of this.lists.values()) for (const domain of list) union.add(domain);
      this.union = union;
    }
    return this.union;
  }

  /** The strongest category among the lists that carry `domain`, or null when no list does. */
  categoryOf(domain: string): Category | null {
    let best: Category | null = null;
    for (const [id, list] of this.lists) {
      if (!list.has(domain)) continue;
      const item = this.items.get(id);
      if (item) best = strongest(best, item.category);
    }
    return best;
  }

  /** Changes what a list's names count as. */
  async setCategory(id: string, category: Category): Promise<SubscriptionInfo | undefined> {
    const item = this.items.get(id);
    if (!item) return undefined;
    if (item.category !== category) {
      item.category = category;
      await this.persist();
      this.notify();
    }
    return this.info(item);
  }

  /** Registers a list. Returns the existing entry when the URL is already subscribed. */
  async add(input: string, category?: Category): Promise<{ item: SubscriptionInfo; added: boolean }> {
    const url = normalizeListUrl(input);
    if (!url) throw new Error("url must be an http(s) URL without credentials");
    const existing = this.byUrl(url);
    if (existing) return { item: this.info(existing), added: false };
    const item = this.fresh(url, category);
    this.items.set(item.id, item);
    this.lists.set(item.id, new Set());
    await this.persist();
    return { item: this.info(item), added: true };
  }

  async remove(id: string): Promise<boolean> {
    const item = this.items.get(id);
    if (!item) return false;
    this.items.delete(id);
    const hadDomains = (this.lists.get(id)?.size ?? 0) > 0;
    this.lists.delete(id);
    await rm(this.listPath(id), { force: true });
    await this.persist();
    if (this.history.delete(id)) await this.persistHistory();
    if (hadDomains) this.notify();
    else this.union = null;
    return true;
  }

  /** Fetches one list now. Concurrent calls for the same list share one fetch. */
  refresh(id: string): Promise<RefreshResult> {
    const running = this.inFlight.get(id);
    if (running) return running;
    const item = this.items.get(id);
    if (!item) return Promise.resolve({ ok: false, changed: false, entries: 0, error: "no such subscription" });
    const task = this.fetchInto(item).finally(() => this.inFlight.delete(id));
    this.inFlight.set(id, task);
    return task;
  }

  private async fetchInto(item: Subscription): Promise<RefreshResult> {
    const startedAt = this.clock();
    try {
      const outcome = await fetchList(this.fetchImpl, item, this.timeoutMs, this.maxBytes);
      const fetchedAt = this.clock();
      item.lastFetchedAt = fetchedAt;
      if (outcome.status === 304) {
        item.lastSuccessAt = item.lastFetchedAt;
        item.lastError = null;
        await this.persist();
        return { ok: true, changed: false, entries: item.entries, error: null };
      }
      const { domains, invalid } = this.parse(outcome.text);
      const previous = this.lists.get(item.id);
      const changed = previous?.size !== domains.size || [...domains].some((d) => !previous.has(d));
      if (previous !== undefined && previous.size > 0 && changed) {
        const names: string[] = [];
        let added = 0;
        for (const domain of domains) {
          if (previous.has(domain)) continue;
          added += 1;
          if (names.length < HISTORY_NAMES) names.push(domain);
        }
        const events = this.history.get(item.id) ?? [];
        events.push({ at: fetchedAt, entries: domains.size, added, removed: previous.size - (domains.size - added), names });
        this.history.set(item.id, events.slice(-HISTORY_EVENTS));
        await this.persistHistory();
      }
      this.lists.set(item.id, domains);
      item.entries = domains.size;
      item.bytes = outcome.bytes;
      item.etag = outcome.etag;
      item.lastModified = outcome.lastModified;
      item.lastSuccessAt = item.lastFetchedAt;
      item.lastError = null;
      await writeFileAtomic(this.listPath(item.id), [...domains].sort().join("\n") + (domains.size > 0 ? "\n" : ""));
      await this.persist();
      this.log(`list ${item.url}: ${domains.size} domains (${invalid} lines skipped, ${outcome.bytes} bytes, ${this.clock() - startedAt} ms)`);
      if (changed) this.notify();
      return { ok: true, changed, entries: domains.size, error: null };
    } catch (error) {
      item.lastFetchedAt = this.clock();
      item.lastError = error instanceof Error ? error.message : String(error);
      await this.persist().catch(() => undefined);
      this.log(`list ${item.url} failed: ${item.lastError}`);
      return { ok: false, changed: false, entries: item.entries, error: item.lastError };
    }
  }

  /** Refreshes every list that is due: never fetched, older than the refresh interval, or failed a while ago. */
  async refreshDue(now = this.clock()): Promise<number> {
    let refreshed = 0;
    for (const item of [...this.items.values()]) {
      const due = item.lastSuccessAt === null ? item.lastFetchedAt === null || now - item.lastFetchedAt >= RETRY_MS : now - item.lastSuccessAt >= this.refreshMs;
      if (!due) continue;
      await this.refresh(item.id);
      refreshed += 1;
    }
    return refreshed;
  }
}
