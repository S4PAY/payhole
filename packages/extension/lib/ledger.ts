import { dayKey, toBigint } from "./format";
import type { KeyValueStore } from "./storage";

export type LedgerStatus = "signed" | "settled" | "failed" | "refused" | "tip";

export interface LedgerEntry {
  id: string;
  /** Origin charged (per-site payments) or `https://<hostname>` for tips. */
  origin: string;
  url: string;
  /** USDG base units as a decimal string. */
  amount: string;
  payTo: string;
  txHash?: string;
  settledAt: number;
  status: LedgerStatus;
  note?: string;
}

export interface LedgerState {
  entries: LedgerEntry[];
  perOrigin: Record<string, string>;
  daily: Record<string, string>;
  total: string;
  tipsTotal: string;
}

export interface OriginSummary {
  origin: string;
  spent: bigint;
  count: number;
  lastAt: number;
}

export const LEDGER_KEY = "ledger";
export const MAX_ENTRIES = 500;

function emptyState(): LedgerState {
  return { entries: [], perOrigin: {}, daily: {}, total: "0", tipsTotal: "0" };
}

/** Statuses that count as money leaving a per-site address. */
function counted(status: LedgerStatus): boolean {
  return status === "signed" || status === "settled";
}

function addTo(record: Record<string, string>, key: string, delta: bigint): void {
  const next = toBigint(record[key]) + delta;
  record[key] = (next < 0n ? 0n : next).toString();
}

/**
 * Per-origin payment records, daily totals, and running sums, persisted as one object. The history is bounded to the
 * last {@link MAX_ENTRIES} entries; the totals survive trimming because they are kept separately.
 */
export class Ledger {
  private state: LedgerState = emptyState();
  private loaded = false;

  constructor(
    private readonly store: KeyValueStore,
    private readonly now: () => number = () => Date.now(),
  ) {}

  async load(): Promise<void> {
    const stored = await this.store.get<Partial<LedgerState>>(LEDGER_KEY);
    this.state = { ...emptyState(), ...(stored ?? {}) };
    this.loaded = true;
  }

  private async save(): Promise<void> {
    await this.store.set(LEDGER_KEY, this.state);
  }

  private ensureLoaded(): void {
    if (!this.loaded) throw new Error("ledger not loaded");
  }

  async record(input: Omit<LedgerEntry, "id" | "settledAt"> & { settledAt?: number }): Promise<LedgerEntry> {
    this.ensureLoaded();
    const entry: LedgerEntry = { ...input, id: globalThis.crypto.randomUUID(), settledAt: input.settledAt ?? this.now() };
    this.state.entries.push(entry);
    if (this.state.entries.length > MAX_ENTRIES) this.state.entries.splice(0, this.state.entries.length - MAX_ENTRIES);
    const amount = toBigint(entry.amount);
    if (counted(entry.status)) {
      addTo(this.state.perOrigin, entry.origin, amount);
      addTo(this.state.daily, dayKey(entry.settledAt), amount);
      this.state.total = (toBigint(this.state.total) + amount).toString();
    } else if (entry.status === "tip") {
      this.state.tipsTotal = (toBigint(this.state.tipsTotal) + amount).toString();
    }
    await this.save();
    return entry;
  }

  /** Marks a signed payment settled or failed once the server's settlement header is seen. */
  async settle(id: string, result: { success: boolean; txHash?: string; note?: string }): Promise<LedgerEntry | undefined> {
    this.ensureLoaded();
    const entry = this.state.entries.find((e) => e.id === id);
    if (!entry) return undefined;
    const wasCounted = counted(entry.status);
    entry.status = result.success ? "settled" : "failed";
    if (result.txHash) entry.txHash = result.txHash;
    if (result.note !== undefined) entry.note = result.note;
    if (wasCounted && !result.success) {
      const amount = toBigint(entry.amount);
      addTo(this.state.perOrigin, entry.origin, -amount);
      addTo(this.state.daily, dayKey(entry.settledAt), -amount);
      const total = toBigint(this.state.total) - amount;
      this.state.total = (total < 0n ? 0n : total).toString();
    }
    await this.save();
    return entry;
  }

  spentFor(origin: string): bigint {
    return toBigint(this.state.perOrigin[origin]);
  }

  totalSpent(): bigint {
    return toBigint(this.state.total);
  }

  tipsTotal(): bigint {
    return toBigint(this.state.tipsTotal);
  }

  dailyTotal(day = dayKey(this.now())): bigint {
    return toBigint(this.state.daily[day]);
  }

  /** Newest first. */
  recent(limit = 20, filter?: (entry: LedgerEntry) => boolean): LedgerEntry[] {
    const entries = filter ? this.state.entries.filter(filter) : this.state.entries;
    return entries.slice(-limit).reverse();
  }

  entriesFor(origin: string, limit = 50): LedgerEntry[] {
    return this.recent(limit, (e) => e.origin === origin);
  }

  origins(): OriginSummary[] {
    const map = new Map<string, OriginSummary>();
    for (const [origin, spent] of Object.entries(this.state.perOrigin)) {
      map.set(origin, { origin, spent: toBigint(spent), count: 0, lastAt: 0 });
    }
    for (const entry of this.state.entries) {
      if (entry.status === "tip") continue;
      const summary = map.get(entry.origin) ?? { origin: entry.origin, spent: 0n, count: 0, lastAt: 0 };
      summary.count += 1;
      summary.lastAt = Math.max(summary.lastAt, entry.settledAt);
      map.set(entry.origin, summary);
    }
    return [...map.values()].sort((a, b) => b.lastAt - a.lastAt);
  }

  snapshot(): LedgerState {
    return structuredClone(this.state);
  }
}
