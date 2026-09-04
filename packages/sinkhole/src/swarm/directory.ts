import { getAddress, isAddress, type Address } from "viem";
import type { RateLimiter } from "../rateLimit.js";
import type { EndpointBody } from "./messages.js";
import type { EndpointAnnouncement, ProbeFailure, ProbeResult } from "./probe.js";

export interface DirectoryEntry {
  url: string;
  network: string;
  asset: Address;
  payTo: Address;
  amount: string | null;
  scheme: string;
  /** Wallet that announced the entry most recently, or the operator for local entries. */
  reporter: Address;
  origin: "local" | "swarm";
  announcedTs: number;
  verifiedAt: number;
  lastSeen: number;
  publishedAt: number | null;
  failures: number;
}

export interface DirectoryOptions {
  probe: (entry: EndpointAnnouncement) => Promise<ProbeResult>;
  /** Per-host probe limiter; keyed by hostname. */
  limiter?: RateLimiter;
  /** Age after which a stored entry is probed again before being trusted or re-published. */
  reverifyMs?: number;
  /** Minimum interval between re-publications of one entry. */
  republishMs?: number;
  /** Entries not seen for this long are dropped. */
  ttlMs?: number;
  maxEntries?: number;
  maxFailures?: number;
  clock?: () => number;
}

export type DirectoryFailure = "invalid_url" | "rate_limited" | "directory_full" | ProbeFailure;
export type AnnouncementResult = { ok: true; entry: DirectoryEntry; probed: boolean } | { ok: false; reason: DirectoryFailure; detail: string };

/** Canonical form of an endpoint URL: http(s) only, fragment removed. */
export function normalizeEndpointUrl(input: string): string | null {
  try {
    const url = new URL(input);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (url.username !== "" || url.password !== "") return null;
    url.hash = "";
    return url.href;
  } catch {
    return null;
  }
}

function fail(reason: DirectoryFailure, detail: string): AnnouncementResult {
  return { ok: false, reason, detail };
}

/**
 * Verified x402 endpoints. Nothing enters without a successful probe; entries are re-probed before
 * being trusted again after `reverifyMs` and before every re-publication.
 */
export class Directory {
  private readonly entries = new Map<string, DirectoryEntry>();
  private readonly listeners = new Set<() => void>();
  private readonly probe: DirectoryOptions["probe"];
  private readonly limiter: RateLimiter | undefined;
  private readonly reverifyMs: number;
  private readonly republishMs: number;
  private readonly ttlMs: number;
  private readonly maxEntries: number;
  private readonly maxFailures: number;
  private readonly clock: () => number;

  constructor(options: DirectoryOptions, state?: DirectoryEntry[] | null) {
    this.probe = options.probe;
    this.limiter = options.limiter;
    this.reverifyMs = options.reverifyMs ?? 60 * 60_000;
    this.republishMs = options.republishMs ?? 60 * 60_000;
    this.ttlMs = options.ttlMs ?? 7 * 24 * 60 * 60_000;
    this.maxEntries = options.maxEntries ?? 5000;
    this.maxFailures = options.maxFailures ?? 3;
    this.clock = options.clock ?? Date.now;
    if (state) this.restore(state);
  }

  private restore(state: DirectoryEntry[]): void {
    for (const raw of state) {
      const url = normalizeEndpointUrl(raw.url);
      if (!url || !isAddress(raw.asset) || !isAddress(raw.payTo) || !isAddress(raw.reporter)) continue;
      if (typeof raw.verifiedAt !== "number" || typeof raw.lastSeen !== "number") continue;
      this.entries.set(url, {
        ...raw,
        url,
        asset: getAddress(raw.asset),
        payTo: getAddress(raw.payTo),
        reporter: getAddress(raw.reporter),
        origin: raw.origin === "local" ? "local" : "swarm",
        publishedAt: typeof raw.publishedAt === "number" ? raw.publishedAt : null,
        failures: typeof raw.failures === "number" ? raw.failures : 0,
      });
    }
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }

  get size(): number {
    return this.entries.size;
  }

  list(): DirectoryEntry[] {
    return [...this.entries.values()].sort((a, b) => (a.url < b.url ? -1 : a.url > b.url ? 1 : 0));
  }

  get(url: string): DirectoryEntry | undefined {
    const key = normalizeEndpointUrl(url);
    return key ? this.entries.get(key) : undefined;
  }

  /** A verified swarm announcement. Probes unless the same entry was verified recently. */
  handleAnnouncement(body: EndpointBody, reporter: Address): Promise<AnnouncementResult> {
    return this.upsert({ url: body.url, network: body.network, asset: body.asset, payTo: body.payTo }, reporter, body.ts, "swarm", false);
  }

  /** An operator-added endpoint; always probed. */
  addLocal(input: EndpointAnnouncement, reporter: Address): Promise<AnnouncementResult> {
    return this.upsert(input, reporter, this.clock(), "local", true);
  }

  private async upsert(input: EndpointAnnouncement, reporter: Address, announcedTs: number, origin: "local" | "swarm", force: boolean): Promise<AnnouncementResult> {
    const url = normalizeEndpointUrl(input.url);
    if (!url) return fail("invalid_url", "URL must be http or https");
    if (!isAddress(input.asset) || !isAddress(input.payTo)) return fail("no_matching_offer", "asset and payTo must be addresses");
    const asset = getAddress(input.asset);
    const payTo = getAddress(input.payTo);
    const now = this.clock();
    const existing = this.entries.get(url);
    const unchanged = existing?.network === input.network && existing.asset === asset && existing.payTo === payTo;
    if (existing && unchanged && !force && existing.verifiedAt + this.reverifyMs > now) {
      existing.lastSeen = now;
      existing.announcedTs = Math.max(existing.announcedTs, announcedTs);
      return { ok: true, entry: existing, probed: false };
    }
    if (!existing && this.entries.size >= this.maxEntries) return fail("directory_full", `directory holds ${this.maxEntries} entries`);
    const host = new URL(url).hostname;
    if (this.limiter && !this.limiter.take(host, now).allowed) return fail("rate_limited", `probe budget for ${host} exhausted`);
    const result = await this.probe({ url, network: input.network, asset, payTo });
    if (!result.ok) {
      if (existing) this.recordFailure(existing);
      return { ok: false, reason: result.reason, detail: result.detail };
    }
    const verifiedAt = this.clock();
    const entry: DirectoryEntry = {
      url,
      network: input.network,
      asset,
      payTo,
      amount: result.offer.amount,
      scheme: result.offer.scheme,
      reporter: getAddress(reporter),
      origin: existing?.origin === "local" ? "local" : origin,
      announcedTs,
      verifiedAt,
      lastSeen: verifiedAt,
      publishedAt: existing && unchanged ? existing.publishedAt : null,
      failures: 0,
    };
    this.entries.set(url, entry);
    this.notify();
    return { ok: true, entry, probed: true };
  }

  private recordFailure(entry: DirectoryEntry): void {
    entry.failures += 1;
    if (entry.failures >= this.maxFailures) {
      this.entries.delete(entry.url);
      this.notify();
    }
  }

  /** Probes a stored entry again; false when it no longer verifies (or the host is rate-limited). */
  async reverify(url: string): Promise<boolean> {
    const entry = this.get(url);
    if (!entry) return false;
    const now = this.clock();
    if (this.limiter && !this.limiter.take(new URL(entry.url).hostname, now).allowed) return false;
    const result = await this.probe({ url: entry.url, network: entry.network, asset: entry.asset, payTo: entry.payTo });
    if (!result.ok) {
      this.recordFailure(entry);
      return false;
    }
    entry.verifiedAt = this.clock();
    entry.lastSeen = entry.verifiedAt;
    entry.failures = 0;
    return true;
  }

  /** Entries whose last publication is older than `republishMs`. */
  dueForPublish(now = this.clock()): DirectoryEntry[] {
    return this.list().filter((entry) => entry.publishedAt === null || entry.publishedAt + this.republishMs <= now);
  }

  markPublished(url: string, now = this.clock()): void {
    const entry = this.get(url);
    if (entry) entry.publishedAt = now;
  }

  /** Drops entries not seen within the TTL. */
  prune(now = this.clock()): boolean {
    let changed = false;
    for (const [url, entry] of this.entries) {
      if (entry.lastSeen + this.ttlMs <= now) {
        this.entries.delete(url);
        changed = true;
      }
    }
    if (changed) this.notify();
    return changed;
  }

  toJSON(): DirectoryEntry[] {
    return this.list();
  }
}
