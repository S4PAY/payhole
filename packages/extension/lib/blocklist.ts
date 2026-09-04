import type { KeyValueStore } from "./storage";

export type BlockReason = "drainer" | "scam" | "tracker" | "other";
export const BLOCK_REASONS: readonly BlockReason[] = ["drainer", "scam", "tracker", "other"];

export interface BlockEntry {
  domain: string;
  reason: BlockReason;
  flaggedAt: number;
}

/** The document the Sinkhole accepts at `PUT /api/blocklist`. */
export interface BlocklistJson {
  version: 1;
  updatedAt: string;
  entries: BlockEntry[];
}

export interface SyncStatus {
  lastAttemptAt?: number;
  lastSuccessAt?: number;
  lastStatus?: number;
  lastError?: string;
}

export type ExportFormat = "hostnames" | "dnsmasq" | "hosts" | "json";
export const EXPORT_FORMATS: readonly ExportFormat[] = ["hostnames", "dnsmasq", "hosts", "json"];

export const BLOCKLIST_KEY = "blocklist";
export const BLOCKLIST_SYNC_KEY = "blocklistSync";

export function isBlockReason(value: unknown): value is BlockReason {
  return typeof value === "string" && (BLOCK_REASONS as readonly string[]).includes(value);
}

/** Lowercase hostname without a trailing dot; accepts a bare host or a URL. Throws on anything else. */
export function normalizeDomain(input: string): string {
  const text = input.trim();
  if (text === "") throw new Error("domain is empty");
  const candidate = text.includes("://") ? text : `https://${text}`;
  let hostname: string;
  try {
    hostname = new URL(candidate).hostname.toLowerCase();
  } catch {
    throw new Error(`"${input}" is not a hostname`);
  }
  if (hostname.endsWith(".")) hostname = hostname.slice(0, -1);
  if (hostname === "" || hostname.includes("/") || !/^[a-z0-9.-]+$/.test(hostname)) throw new Error(`"${input}" is not a hostname`);
  return hostname;
}

/** The entry that blocks `hostname`: an exact match or any parent domain. */
export function matchBlocked(entries: readonly BlockEntry[], hostname: string): BlockEntry | undefined {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  return entries.find((entry) => host === entry.domain || host.endsWith(`.${entry.domain}`));
}

function sorted(entries: readonly BlockEntry[]): BlockEntry[] {
  return [...entries].sort((a, b) => a.domain.localeCompare(b.domain));
}

export function exportHostnames(entries: readonly BlockEntry[]): string {
  return sorted(entries)
    .map((e) => e.domain)
    .join("\n")
    .concat(entries.length ? "\n" : "");
}

export function exportDnsmasq(entries: readonly BlockEntry[]): string {
  return sorted(entries)
    .map((e) => `address=/${e.domain}/0.0.0.0`)
    .join("\n")
    .concat(entries.length ? "\n" : "");
}

export function exportHosts(entries: readonly BlockEntry[]): string {
  const lines = ["# PayHole blocklist", ...sorted(entries).map((e) => `0.0.0.0 ${e.domain}`)];
  return `${lines.join("\n")}\n`;
}

export function exportJson(entries: readonly BlockEntry[], updatedAt: number): BlocklistJson {
  return { version: 1, updatedAt: new Date(updatedAt).toISOString(), entries: sorted(entries) };
}

export function exportBlocklist(entries: readonly BlockEntry[], format: ExportFormat, updatedAt: number): string {
  switch (format) {
    case "hostnames":
      return exportHostnames(entries);
    case "dnsmasq":
      return exportDnsmasq(entries);
    case "hosts":
      return exportHosts(entries);
    case "json":
      return `${JSON.stringify(exportJson(entries, updatedAt), null, 2)}\n`;
  }
}

export interface PushOptions {
  url: string;
  token: string;
  entries: readonly BlockEntry[];
  updatedAt: number;
  fetchFn?: typeof globalThis.fetch;
  now?: () => number;
}

/** `PUT <url>/api/blocklist` with the JSON export and a bearer token; never throws, the status carries the error. */
export async function pushToSinkhole(options: PushOptions): Promise<SyncStatus> {
  const now = options.now ?? (() => Date.now());
  const fetchFn = options.fetchFn ?? globalThis.fetch.bind(globalThis);
  const attemptedAt = now();
  const base = options.url.trim().replace(/\/+$/, "");
  if (base === "") return { lastAttemptAt: attemptedAt, lastError: "sync URL is not set" };
  try {
    const response = await fetchFn(`${base}/api/blocklist`, {
      method: "PUT",
      headers: { "content-type": "application/json", authorization: `Bearer ${options.token}` },
      body: JSON.stringify(exportJson(options.entries, options.updatedAt)),
    });
    if (!response.ok) {
      const text = (await response.text().catch(() => "")).slice(0, 200);
      return { lastAttemptAt: attemptedAt, lastStatus: response.status, lastError: `HTTP ${response.status}${text ? `: ${text}` : ""}` };
    }
    return { lastAttemptAt: attemptedAt, lastSuccessAt: now(), lastStatus: response.status };
  } catch (error) {
    return { lastAttemptAt: attemptedAt, lastError: error instanceof Error ? error.message : String(error) };
  }
}

interface StoredBlocklist {
  entries: BlockEntry[];
  updatedAt: number;
}

export class BlocklistStore {
  private data: StoredBlocklist = { entries: [], updatedAt: 0 };
  private sync: SyncStatus = {};

  constructor(
    private readonly store: KeyValueStore,
    private readonly now: () => number = () => Date.now(),
  ) {}

  async load(): Promise<void> {
    const stored = await this.store.get<Partial<StoredBlocklist>>(BLOCKLIST_KEY);
    this.data = { entries: stored?.entries ?? [], updatedAt: stored?.updatedAt ?? 0 };
    this.sync = (await this.store.get<SyncStatus>(BLOCKLIST_SYNC_KEY)) ?? {};
  }

  list(): BlockEntry[] {
    return sorted(this.data.entries);
  }

  updatedAt(): number {
    return this.data.updatedAt;
  }

  isBlocked(hostname: string): BlockEntry | undefined {
    return matchBlocked(this.data.entries, hostname);
  }

  async add(domainInput: string, reason: BlockReason): Promise<BlockEntry> {
    const domain = normalizeDomain(domainInput);
    if (!isBlockReason(reason)) throw new Error("unknown reason");
    const existing = this.data.entries.find((e) => e.domain === domain);
    const entry: BlockEntry = { domain, reason, flaggedAt: existing?.flaggedAt ?? this.now() };
    this.data.entries = [...this.data.entries.filter((e) => e.domain !== domain), entry];
    this.data.updatedAt = this.now();
    await this.store.set(BLOCKLIST_KEY, this.data);
    return entry;
  }

  async remove(domainInput: string): Promise<boolean> {
    const domain = normalizeDomain(domainInput);
    const before = this.data.entries.length;
    this.data.entries = this.data.entries.filter((e) => e.domain !== domain);
    if (this.data.entries.length === before) return false;
    this.data.updatedAt = this.now();
    await this.store.set(BLOCKLIST_KEY, this.data);
    return true;
  }

  export(format: ExportFormat): string {
    return exportBlocklist(this.data.entries, format, this.data.updatedAt);
  }

  syncStatus(): SyncStatus {
    return { ...this.sync };
  }

  async setSyncStatus(status: SyncStatus): Promise<void> {
    this.sync = status;
    await this.store.set(BLOCKLIST_SYNC_KEY, status);
  }
}
