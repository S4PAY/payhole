import { cleanReason, normalizeHostname } from "./hostname.js";
import { Allowlist } from "./allowlist.js";

export interface LocalEntry {
  domain: string;
  reason: string;
  flaggedAt: string;
}

/** Payload the browser extension pushes to `PUT /api/blocklist`. */
export interface ExtensionPush {
  version: 1;
  updatedAt: string;
  entries: LocalEntry[];
}

export interface ManualEntry {
  domain: string;
  reason: string;
  addedAt: number;
}

/** One reporter's flag for a domain. `ts` is the reporter's announcement time, `seen` our clock. */
export interface SwarmFlag {
  reason: string;
  ts: number;
  seen: number;
}

export type Source = "local" | "manual" | "swarm" | "list";

export interface MergedEntry {
  domain: string;
  sources: Source[];
  reason: string;
}

export interface FlagSummary {
  domain: string;
  reporters: number;
  confirmed: boolean;
  firstSeen: number;
  lastSeen: number;
  reasons: string[];
}

export interface BlocklistState {
  version: 1;
  local: { updatedAt: string | null; receivedAt: number | null; entries: LocalEntry[] };
  manual: ManualEntry[];
  swarm: Record<string, Record<string, SwarmFlag>>;
}

export interface BlocklistOptions {
  /** Distinct reporters needed before a swarm flag blocks. */
  threshold: number;
  /** Flags older than this (by our clock) no longer count. */
  ttlMs: number;
  clock?: () => number;
}

export type ParsedPush = { ok: true; push: ExtensionPush; rejected: string[] } | { ok: false; error: string };

const MAX_PUSH_ENTRIES = 50_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isIsoDate(value: unknown): value is string {
  return typeof value === "string" && value.length <= 64 && !Number.isNaN(Date.parse(value));
}

/** Validates an extension push; entries with invalid hostnames are dropped and listed, not fatal. */
export function parseExtensionPush(value: unknown): ParsedPush {
  if (!isRecord(value)) return { ok: false, error: "body must be a JSON object" };
  if (value["version"] !== 1) return { ok: false, error: "version must be 1" };
  const updatedAt = value["updatedAt"];
  if (!isIsoDate(updatedAt)) return { ok: false, error: "updatedAt must be an ISO date" };
  const entries = value["entries"];
  if (!Array.isArray(entries)) return { ok: false, error: "entries must be an array" };
  if (entries.length > MAX_PUSH_ENTRIES) return { ok: false, error: `entries must hold at most ${MAX_PUSH_ENTRIES} items` };
  const items: unknown[] = entries;
  const seen = new Map<string, LocalEntry>();
  const rejected: string[] = [];
  for (const raw of items) {
    const candidate = isRecord(raw) ? raw["domain"] : raw;
    const domain = normalizeHostname(candidate);
    if (domain === null) {
      rejected.push(typeof candidate === "string" ? candidate.slice(0, 120) : JSON.stringify(candidate ?? null).slice(0, 120));
      continue;
    }
    const record: Record<string, unknown> = isRecord(raw) ? raw : {};
    const flaggedAt = isIsoDate(record["flaggedAt"]) ? record["flaggedAt"] : updatedAt;
    seen.set(domain, { domain, reason: cleanReason(record["reason"], "flagged by extension"), flaggedAt });
  }
  return { ok: true, push: { version: 1, updatedAt, entries: [...seen.values()] }, rejected };
}

function byDomain<T extends { domain: string }>(a: T, b: T): number {
  return a.domain < b.domain ? -1 : a.domain > b.domain ? 1 : 0;
}

function sameSet(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const value of a) if (!b.has(value)) return false;
  return true;
}

/**
 * The blocklist sources and their merge. Local flags (extension pushes) and manual entries always block.
 * Swarm flags block only once `threshold` distinct reporters have flagged the domain within the TTL.
 * Subscribed public lists are a fourth source, kept as one shared set because they can hold hundreds of
 * thousands of names. Listeners are told whenever the merged set changes so dnsmasq can be updated.
 */
export class Blocklist {
  private readonly local = new Map<string, LocalEntry>();
  private localUpdatedAt: string | null = null;
  private localReceivedAt: number | null = null;
  private readonly manual = new Map<string, ManualEntry>();
  private readonly swarm = new Map<string, Map<string, SwarmFlag>>();
  private lists: ReadonlySet<string> = new Set();
  /** The list-source domains before the allowlist is applied, kept so a new allowlist can re-filter them. */
  private rawLists: ReadonlySet<string> = new Set();
  private allow = new Allowlist([]);
  private readonly listeners = new Set<() => void>();
  /** Merged set as of the last notification; expiry can change the set without any mutation. */
  private lastNotified: Set<string>;
  readonly threshold: number;
  readonly ttlMs: number;
  private readonly clock: () => number;

  constructor(options: BlocklistOptions, state?: BlocklistState | null) {
    if (!Number.isInteger(options.threshold) || options.threshold < 1) throw new Error("threshold must be a positive integer");
    if (!(options.ttlMs > 0)) throw new Error("ttlMs must be positive");
    this.threshold = options.threshold;
    this.ttlMs = options.ttlMs;
    this.clock = options.clock ?? Date.now;
    if (state) this.restore(state);
    this.lastNotified = this.domains();
  }

  private restore(state: BlocklistState): void {
    for (const entry of state.local.entries) {
      const domain = normalizeHostname(entry.domain);
      if (domain) this.local.set(domain, { domain, reason: cleanReason(entry.reason), flaggedAt: entry.flaggedAt });
    }
    this.localUpdatedAt = state.local.updatedAt;
    this.localReceivedAt = state.local.receivedAt;
    for (const entry of state.manual) {
      const domain = normalizeHostname(entry.domain);
      if (domain) this.manual.set(domain, { domain, reason: cleanReason(entry.reason, "manual"), addedAt: entry.addedAt });
    }
    for (const [rawDomain, flags] of Object.entries(state.swarm)) {
      const domain = normalizeHostname(rawDomain);
      if (!domain) continue;
      const map = new Map<string, SwarmFlag>();
      for (const [reporter, flag] of Object.entries(flags)) {
        if (typeof flag.seen === "number" && typeof flag.ts === "number") {
          map.set(reporter.toLowerCase(), { reason: cleanReason(flag.reason), ts: flag.ts, seen: flag.seen });
        }
      }
      if (map.size > 0) this.swarm.set(domain, map);
    }
  }

  /** Registers a listener for merged-set changes; returns the unsubscribe function. */
  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }

  /** Notifies listeners when the merged set differs from what they last saw, expiry included. */
  private checkChanged(): void {
    const current = this.domains();
    if (sameSet(current, this.lastNotified)) return;
    this.lastNotified = current;
    this.notify();
  }

  /** Replaces the subscribed-list set (owned by the subscriptions module; not copied). */
  setLists(domains: ReadonlySet<string>): void {
    this.rawLists = domains;
    this.lists = this.allow.filter(domains);
    this.checkChanged();
  }

  /** Names that are never blocked, whatever a list or the swarm says. Applied to every source. */
  setAllowlist(rules: ReadonlySet<string>): void {
    this.allow = new Allowlist(rules);
    this.lists = this.allow.filter(this.rawLists);
    this.checkChanged();
  }

  allowlistSize(): number {
    return this.allow.size;
  }

  /** The list-source domains as last set. */
  listDomains(): ReadonlySet<string> {
    return this.lists;
  }

  private withChange<T>(fn: () => T): T {
    const result = fn();
    this.checkChanged();
    return result;
  }

  /** Replaces the local flag list with an extension push. Returns what changed relative to the old list. */
  setLocal(push: ExtensionPush, receivedAt = this.clock()): { added: LocalEntry[]; removed: string[] } {
    return this.withChange(() => {
      const added: LocalEntry[] = [];
      const next = new Map<string, LocalEntry>();
      for (const entry of push.entries) {
        const domain = normalizeHostname(entry.domain);
        if (!domain) continue;
        const clean = { domain, reason: cleanReason(entry.reason, "flagged by extension"), flaggedAt: entry.flaggedAt };
        next.set(domain, clean);
        if (!this.local.has(domain)) added.push(clean);
      }
      const removed = [...this.local.keys()].filter((domain) => !next.has(domain));
      this.local.clear();
      for (const [domain, entry] of next) this.local.set(domain, entry);
      this.localUpdatedAt = push.updatedAt;
      this.localReceivedAt = receivedAt;
      return { added, removed };
    });
  }

  localEntries(): LocalEntry[] {
    return [...this.local.values()].sort(byDomain);
  }

  localMeta(): { updatedAt: string | null; receivedAt: number | null } {
    return { updatedAt: this.localUpdatedAt, receivedAt: this.localReceivedAt };
  }

  /** Adds a manual entry; returns the normalised domain, or null when the input is not a hostname. */
  addManual(input: string, reason = "manual", addedAt = this.clock()): { domain: string; added: boolean } | null {
    const domain = normalizeHostname(input);
    if (!domain) return null;
    return this.withChange(() => {
      if (this.manual.has(domain)) return { domain, added: false };
      this.manual.set(domain, { domain, reason: cleanReason(reason, "manual"), addedAt });
      return { domain, added: true };
    });
  }

  removeManual(input: string): boolean {
    const domain = normalizeHostname(input);
    if (!domain) return false;
    return this.withChange(() => this.manual.delete(domain));
  }

  manualEntries(): ManualEntry[] {
    return [...this.manual.values()].sort(byDomain);
  }

  private liveFlags(flags: Map<string, SwarmFlag>, now: number): SwarmFlag[] {
    const out: SwarmFlag[] = [];
    for (const flag of flags.values()) if (flag.seen + this.ttlMs > now) out.push(flag);
    return out;
  }

  /** True when enough distinct reporters have live flags for the domain. */
  isConfirmed(domain: string, now = this.clock()): boolean {
    const flags = this.swarm.get(domain);
    return flags !== undefined && this.liveFlags(flags, now).length >= this.threshold;
  }

  /**
   * Records one reporter's flag. The same reporter flagging again refreshes their flag but never counts
   * twice. Returns the live reporter count and whether the merged set changed.
   */
  recordFlag(
    input: string,
    reporter: string,
    reason: string,
    ts: number,
    seen = this.clock(),
  ): { domain: string; reporters: number; confirmed: boolean; changed: boolean } | null {
    const domain = normalizeHostname(input);
    if (!domain) return null;
    const blockedBefore = this.local.has(domain) || this.manual.has(domain) || this.isConfirmed(domain, seen);
    let flags = this.swarm.get(domain);
    if (!flags) {
      flags = new Map();
      this.swarm.set(domain, flags);
    }
    flags.set(reporter.toLowerCase(), { reason: cleanReason(reason), ts, seen });
    const reporters = this.liveFlags(flags, seen).length;
    const confirmed = reporters >= this.threshold;
    const changed = confirmed && !blockedBefore;
    this.checkChanged();
    return { domain, reporters, confirmed, changed };
  }

  /** Drops expired flags. Returns true when the merged set changed. */
  prune(now = this.clock()): boolean {
    let changed = false;
    this.withChange(() => {
      for (const [domain, flags] of this.swarm) {
        for (const [reporter, flag] of flags) {
          if (flag.seen + this.ttlMs <= now) {
            flags.delete(reporter);
            changed = true;
          }
        }
        if (flags.size === 0) this.swarm.delete(domain);
      }
    });
    return changed;
  }

  swarmConfirmed(now = this.clock()): string[] {
    const out: string[] = [];
    for (const [domain, flags] of this.swarm) if (this.liveFlags(flags, now).length >= this.threshold) out.push(domain);
    return out.sort();
  }

  flagSummaries(now = this.clock()): FlagSummary[] {
    const out: FlagSummary[] = [];
    for (const [domain, flags] of this.swarm) {
      const live = this.liveFlags(flags, now);
      if (live.length === 0) continue;
      out.push({
        domain,
        reporters: live.length,
        confirmed: live.length >= this.threshold,
        firstSeen: Math.min(...live.map((f) => f.seen)),
        lastSeen: Math.max(...live.map((f) => f.seen)),
        reasons: [...new Set(live.map((f) => f.reason))].slice(0, 10),
      });
    }
    return out.sort(byDomain);
  }

  /** The curated entries (extension, manual, swarm) with their sources; list entries are not included. */
  curatedEntries(now = this.clock()): MergedEntry[] {
    const out = new Map<string, MergedEntry>();
    const add = (domain: string, source: Source, reason: string): void => {
      if (this.allow.allows(domain)) return;
      const existing = out.get(domain);
      if (existing) existing.sources.push(source);
      else out.set(domain, { domain, sources: [source], reason });
    };
    for (const entry of this.local.values()) add(entry.domain, "local", entry.reason);
    for (const entry of this.manual.values()) add(entry.domain, "manual", entry.reason);
    for (const [domain, flags] of this.swarm) {
      const live = this.liveFlags(flags, now);
      if (live.length >= this.threshold) add(domain, "swarm", `flagged by ${live.length} reporters`);
    }
    return [...out.values()].sort(byDomain);
  }

  /** Every blocked domain with its sources, list entries included. Large with big subscriptions; prefer `search`. */
  merged(now = this.clock()): MergedEntry[] {
    const entries = this.curatedEntries(now);
    const seen = new Map(entries.map((e) => [e.domain, e]));
    for (const domain of this.lists) {
      const existing = seen.get(domain);
      if (existing) existing.sources.push("list");
      else entries.push({ domain, sources: ["list"], reason: "subscribed list" });
    }
    return entries.sort(byDomain);
  }

  /**
   * Entries matching `query` (substring of the domain or reason), curated ones first, at most `limit`.
   * `count` is the size of the whole merged set, `matched` how many entries matched before the limit.
   */
  search(query: string, limit: number, now = this.clock()): { count: number; matched: number; entries: MergedEntry[] } {
    const q = query.trim().toLowerCase();
    const curated = this.curatedEntries(now);
    const curatedSet = new Set(curated.map((e) => e.domain));
    const out: MergedEntry[] = [];
    let matched = 0;
    for (const entry of curated) {
      if (q && !entry.domain.includes(q) && !entry.reason.toLowerCase().includes(q)) continue;
      matched += 1;
      if (out.length < limit) out.push(this.lists.has(entry.domain) ? { ...entry, sources: [...entry.sources, "list"] } : entry);
    }
    let listMatched = 0;
    const listHits: string[] = [];
    for (const domain of this.lists) {
      if (curatedSet.has(domain)) continue;
      if (q && !domain.includes(q)) continue;
      listMatched += 1;
      if (listHits.length < limit) listHits.push(domain);
    }
    matched += listMatched;
    for (const domain of listHits.sort()) {
      if (out.length >= limit) break;
      out.push({ domain, sources: ["list"], reason: "subscribed list" });
    }
    return { count: this.domains(now).size, matched, entries: out };
  }

  /** Domains blocked by the curated sources: extension, manual, swarm. Rendered as dnsmasq `address=` rules. */
  curated(now = this.clock()): Set<string> {
    const out = new Set<string>();
    for (const domain of this.local.keys()) if (!this.allow.allows(domain)) out.add(domain);
    for (const domain of this.manual.keys()) if (!this.allow.allows(domain)) out.add(domain);
    for (const [domain, flags] of this.swarm) {
      if (this.liveFlags(flags, now).length >= this.threshold && !this.allow.allows(domain)) out.add(domain);
    }
    return out;
  }

  domains(now = this.clock()): Set<string> {
    const out = this.curated(now);
    for (const domain of this.lists) out.add(domain);
    return out;
  }

  counts(now = this.clock()): { local: number; manual: number; swarmConfirmed: number; swarmFlagged: number; list: number; merged: number } {
    return {
      local: this.local.size,
      manual: this.manual.size,
      swarmConfirmed: this.swarmConfirmed(now).length,
      swarmFlagged: this.flagSummaries(now).length,
      list: this.lists.size,
      merged: this.domains(now).size,
    };
  }

  toJSON(): BlocklistState {
    const swarm: Record<string, Record<string, SwarmFlag>> = {};
    for (const [domain, flags] of this.swarm) swarm[domain] = Object.fromEntries(flags);
    return {
      version: 1,
      local: { updatedAt: this.localUpdatedAt, receivedAt: this.localReceivedAt, entries: this.localEntries() },
      manual: this.manualEntries(),
      swarm,
    };
  }
}
