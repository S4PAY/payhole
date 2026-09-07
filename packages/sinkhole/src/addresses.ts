import { isCategory, type Category } from "./category.js";
import { debounce, readJson, writeJsonAtomic } from "./store.js";

/**
 * Addresses the network knows to be bad: drainer contracts and the wallets that receive from them. Names
 * are the DNS layer's business; this is the other layer, for a browser extension that looks at what a
 * wallet is about to sign. Three sources, like the blocklist: a public list, the operator's own entries,
 * and reports the project reviewed. Every address is kept lowercase; checksums are a display matter.
 */

export type AddressSource = "list" | "manual";

export interface AddressEntry {
  address: string;
  category: Category;
  sources: AddressSource[];
  /** Where a list entry came from, or the note on a manual one. */
  label: string | null;
  /** When this node first knew the address. */
  at: number;
}

export interface AddressVerdict {
  address: string;
  flagged: boolean;
  category: Category | null;
  sources: AddressSource[];
  label: string | null;
}

export interface AddressListStatus {
  url: string | null;
  count: number;
  manual: number;
  lastFetchAt: number | null;
  lastStatus: number | "error" | null;
  lastError: string | null;
  etag: string | null;
}

interface AddressFile {
  version: 1;
  list: { url: string | null; etag: string | null; lastModified: string | null; fetchedAt: number | null; addresses: string[] };
  /** When a list first brought each address in, kept for the bounty ledger's corroboration window. */
  arrivals: Record<string, number>;
  manual: { address: string; category: Category; label: string | null; at: number }[];
}

export interface AddressListOptions {
  path?: string | undefined;
  /** The public list to subscribe to, a JSON array of addresses; null disables the subscription. */
  url: string | null;
  refreshMs: number;
  fetch?: typeof fetch | undefined;
  maxBytes?: number | undefined;
  clock?: (() => number) | undefined;
  log?: ((line: string) => void) | undefined;
}

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
export const DEFAULT_ADDRESS_LIST_URL = "https://raw.githubusercontent.com/scamsniffer/scam-database/refs/heads/main/blacklist/address.json";
const DEFAULT_MAX_BYTES = 8 * 1024 * 1024;

/** A lowercase EVM address, or null for anything else. */
export function normalizeAddress(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const text = input.trim();
  return ADDRESS.test(text) ? text.toLowerCase() : null;
}

/** The addresses in a list body: a JSON array of strings, or one address per line. Anything else is skipped. */
export function parseAddressList(text: string): string[] {
  const out = new Set<string>();
  const trimmed = text.trim();
  if (trimmed.startsWith("[")) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      return [];
    }
    if (Array.isArray(parsed)) for (const item of parsed) {
      const address = normalizeAddress(item);
      if (address) out.add(address);
    }
    return [...out];
  }
  for (const line of trimmed.split(/\r?\n/)) {
    const address = normalizeAddress(line.split(/[\s#,;]/)[0] ?? "");
    if (address) out.add(address);
  }
  return [...out];
}

function labelFor(url: string): string {
  const lower = url.toLowerCase();
  if (lower.includes("scamsniffer")) return "ScamSniffer";
  try {
    return new URL(url).hostname;
  } catch {
    return "list";
  }
}

export class AddressList {
  private list = new Set<string>();
  private manual = new Map<string, { category: Category; label: string | null; at: number }>();
  private arrivals = new Map<string, number>();
  private etag: string | null = null;
  private lastModified: string | null = null;
  private fetchedAt: number | null = null;
  private lastStatus: number | "error" | null = null;
  private lastError: string | null = null;
  private readonly clock: () => number;
  private readonly log: (line: string) => void;
  private readonly fetchImpl: typeof fetch;
  private readonly persist: { trigger: () => void; flush: () => Promise<void> } | null;
  private refreshing: Promise<{ status: number | "error"; added: number; removed: number }> | null = null;

  constructor(
    private readonly options: AddressListOptions,
    state?: AddressFile | null,
  ) {
    this.clock = options.clock ?? Date.now;
    this.log = options.log ?? (() => undefined);
    this.fetchImpl = options.fetch ?? fetch;
    const path = options.path;
    this.persist = path ? debounce(() => writeJsonAtomic(path, this.toJSON()), 1000) : null;
    if (state?.version === 1) {
      if (state.list?.url === options.url) {
        for (const address of state.list.addresses ?? []) {
          const clean = normalizeAddress(address);
          if (clean) this.list.add(clean);
        }
        this.etag = state.list.etag ?? null;
        this.lastModified = state.list.lastModified ?? null;
        this.fetchedAt = state.list.fetchedAt ?? null;
      }
      for (const [address, at] of Object.entries(state.arrivals ?? {})) if (normalizeAddress(address) && typeof at === "number") this.arrivals.set(address.toLowerCase(), at);
      for (const entry of state.manual ?? []) {
        const clean = normalizeAddress(entry.address);
        if (clean && isCategory(entry.category)) this.manual.set(clean, { category: entry.category, label: entry.label ?? null, at: entry.at });
      }
    }
  }

  static async load(options: AddressListOptions & { path: string }): Promise<AddressList> {
    return new AddressList(options, await readJson<AddressFile>(options.path));
  }

  get size(): number {
    return new Set([...this.list, ...this.manual.keys()]).size;
  }

  /** What the node knows about an address; null when the input is not an address at all. */
  lookup(input: unknown): AddressVerdict | null {
    const address = normalizeAddress(input);
    if (!address) return null;
    const manual = this.manual.get(address);
    const listed = this.list.has(address);
    const sources: AddressSource[] = [];
    if (listed) sources.push("list");
    if (manual) sources.push("manual");
    if (sources.length === 0) return { address, flagged: false, category: null, sources, label: null };
    return {
      address,
      flagged: true,
      category: manual?.category ?? "drainer",
      sources,
      label: manual?.label ?? (listed && this.options.url ? labelFor(this.options.url) : null),
    };
  }

  isFlagged(input: unknown): boolean {
    return this.lookup(input)?.flagged === true;
  }

  /** When a list first brought an address in, for the ledger's fourteen-day window. */
  arrivalOf(input: unknown): { at: number; label: string } | null {
    const address = normalizeAddress(input);
    if (!address) return null;
    const at = this.arrivals.get(address);
    return at === undefined ? null : { at, label: this.options.url ? labelFor(this.options.url) : "list" };
  }

  addManual(input: unknown, category: Category, label: string | null = null, now = this.clock()): { address: string; added: boolean } | null {
    const address = normalizeAddress(input);
    if (!address) return null;
    const added = !this.manual.has(address);
    this.manual.set(address, { category, label, at: this.manual.get(address)?.at ?? now });
    this.persist?.trigger();
    return { address, added };
  }

  removeManual(input: unknown): boolean {
    const address = normalizeAddress(input);
    if (!address || !this.manual.delete(address)) return false;
    this.persist?.trigger();
    return true;
  }

  entries(): AddressEntry[] {
    const out = new Map<string, AddressEntry>();
    for (const address of this.list) out.set(address, { address, category: "drainer", sources: ["list"], label: this.options.url ? labelFor(this.options.url) : null, at: this.arrivals.get(address) ?? 0 });
    for (const [address, entry] of this.manual) {
      const existing = out.get(address);
      out.set(address, { address, category: entry.category, sources: existing ? [...existing.sources, "manual"] : ["manual"], label: entry.label ?? existing?.label ?? null, at: existing ? Math.min(existing.at || entry.at, entry.at) : entry.at });
    }
    return [...out.values()].sort((a, b) => a.address.localeCompare(b.address));
  }

  /** One address per line, for other nodes and tools. */
  export(): string {
    const lines = this.entries().map((entry) => entry.address);
    return lines.length > 0 ? `${lines.join("\n")}\n` : "";
  }

  status(): AddressListStatus {
    return { url: this.options.url, count: this.list.size, manual: this.manual.size, lastFetchAt: this.fetchedAt, lastStatus: this.lastStatus, lastError: this.lastError, etag: this.etag };
  }

  /** Fetches the list when it is due; the first call fetches at once. */
  async refreshDue(now = this.clock()): Promise<boolean> {
    if (!this.options.url) return false;
    if (this.fetchedAt !== null && now - this.fetchedAt < this.options.refreshMs) return false;
    await this.refresh(now);
    return true;
  }

  /** Fetches the list with conditional headers and replaces the list-sourced set; never throws. */
  refresh(now = this.clock()): Promise<{ status: number | "error"; added: number; removed: number }> {
    if (this.refreshing) return this.refreshing;
    this.refreshing = this.doRefresh(now).finally(() => {
      this.refreshing = null;
    });
    return this.refreshing;
  }

  private async doRefresh(now: number): Promise<{ status: number | "error"; added: number; removed: number }> {
    const url = this.options.url;
    if (!url) return { status: "error", added: 0, removed: 0 };
    const headers: Record<string, string> = { accept: "application/json, text/plain, */*;q=0.5", "user-agent": "payhole-sinkhole" };
    if (this.etag) headers["if-none-match"] = this.etag;
    if (this.lastModified) headers["if-modified-since"] = this.lastModified;
    try {
      const res = await this.fetchImpl(url, { headers, redirect: "follow", signal: AbortSignal.timeout(30_000) });
      this.fetchedAt = now;
      if (res.status === 304) {
        this.lastStatus = 304;
        this.lastError = null;
        this.persist?.trigger();
        return { status: 304, added: 0, removed: 0 };
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      const max = this.options.maxBytes ?? DEFAULT_MAX_BYTES;
      if (Buffer.byteLength(text) > max) throw new Error(`list exceeds the ${max} byte limit`);
      const parsed = parseAddressList(text);
      if (parsed.length === 0) throw new Error("the list is empty or not a list of addresses");
      const next = new Set(parsed);
      let added = 0;
      let removed = 0;
      for (const address of next) {
        if (!this.list.has(address)) added += 1;
        if (!this.arrivals.has(address)) this.arrivals.set(address, now);
      }
      for (const address of this.list) if (!next.has(address)) removed += 1;
      this.list = next;
      this.etag = res.headers.get("etag");
      this.lastModified = res.headers.get("last-modified");
      this.lastStatus = res.status;
      this.lastError = null;
      if (added > 0 || removed > 0) this.log(`address list: ${next.size} addresses, ${added} new, ${removed} gone`);
      this.persist?.trigger();
      return { status: res.status, added, removed };
    } catch (error) {
      this.fetchedAt = now;
      this.lastStatus = "error";
      this.lastError = error instanceof Error ? error.message : String(error);
      this.log(`address list: ${this.lastError}`);
      this.persist?.trigger();
      return { status: "error", added: 0, removed: 0 };
    }
  }

  async flush(): Promise<void> {
    await this.persist?.flush();
  }

  toJSON(): AddressFile {
    return {
      version: 1,
      list: { url: this.options.url, etag: this.etag, lastModified: this.lastModified, fetchedAt: this.fetchedAt, addresses: [...this.list].sort() },
      arrivals: Object.fromEntries(this.arrivals),
      manual: [...this.manual.entries()].map(([address, entry]) => ({ address, category: entry.category, label: entry.label, at: entry.at })),
    };
  }
}
