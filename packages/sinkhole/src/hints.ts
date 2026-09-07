import { parseCategory, type Category } from "./category.js";
import { cleanReason, normalizeHostname } from "./hostname.js";
import type { Evidence } from "./evidence.js";
import { readJson, writeJsonAtomic } from "./store.js";

/**
 * Hints: names reported by phones and browsers that hold no tier. A hint never blocks anything. It is
 * counted, kept for tier holders to look at, and shown on the radar, so a name many people report reaches
 * someone who can confirm it. Bounded, and written to disk a few seconds after it changes.
 */

export interface HintReporter {
  /** The phone's reporter key, checksummed. */
  key: string;
  /** Where a bounty for this name goes; null until the reporter names a wallet. */
  payTo: string | null;
  at: number;
}

export interface Hint {
  domain: string;
  count: number;
  firstAt: number;
  lastAt: number;
  categories: Partial<Record<Category, number>>;
  reasons: string[];
  /** The first signed report, if any report was signed. */
  firstBy?: HintReporter;
  evidence?: Evidence;
}

export interface HintsFile {
  version: 1;
  hints: Hint[];
}

export interface HintsOptions {
  /** File the hints are kept in; absent keeps them in memory only. */
  path?: string | undefined;
  limit?: number | undefined;
  clock?: (() => number) | undefined;
  log?: ((line: string) => void) | undefined;
}

const DEFAULT_LIMIT = 5000;
const REASONS_KEPT = 5;
const WRITE_DELAY_MS = 5000;

export class Hints {
  private readonly hints = new Map<string, Hint>();
  private readonly limit: number;
  private readonly clock: () => number;
  private readonly path: string | undefined;
  private readonly log: (line: string) => void;
  private timer: NodeJS.Timeout | null = null;

  constructor(options: HintsOptions = {}, state?: HintsFile | null) {
    this.limit = options.limit ?? DEFAULT_LIMIT;
    this.clock = options.clock ?? Date.now;
    this.path = options.path;
    this.log = options.log ?? (() => undefined);
    if (state?.version === 1 && Array.isArray(state.hints)) {
      for (const entry of state.hints) {
        const domain = typeof entry.domain === "string" ? normalizeHostname(entry.domain) : null;
        if (!domain || typeof entry.count !== "number" || typeof entry.lastAt !== "number") continue;
        const categories: Partial<Record<Category, number>> = {};
        for (const [key, value] of Object.entries(entry.categories ?? {})) {
          const category = parseCategory(key);
          if (category && typeof value === "number") categories[category] = value;
        }
        this.hints.set(domain, {
          domain,
          count: entry.count,
          firstAt: typeof entry.firstAt === "number" ? entry.firstAt : entry.lastAt,
          lastAt: entry.lastAt,
          categories,
          reasons: Array.isArray(entry.reasons) ? entry.reasons.filter((reason): reason is string => typeof reason === "string").slice(0, REASONS_KEPT) : [],
          ...(entry.firstBy && typeof entry.firstBy.key === "string" && typeof entry.firstBy.at === "number" ? { firstBy: { key: entry.firstBy.key, payTo: typeof entry.firstBy.payTo === "string" ? entry.firstBy.payTo : null, at: entry.firstBy.at } } : {}),
          ...(entry.evidence && typeof entry.evidence.score === "number" ? { evidence: entry.evidence } : {}),
        });
      }
    }
  }

  static async load(options: HintsOptions & { path: string }): Promise<Hints> {
    return new Hints(options, await readJson<HintsFile>(options.path));
  }

  get size(): number {
    return this.hints.size;
  }

  get(domain: string): Hint | undefined {
    return this.hints.get(domain);
  }

  /** Counts one report of a name. Null when the input is not a hostname. */
  record(input: unknown, category: unknown = null, reason: unknown = "", now = this.clock(), by?: { key: string; payTo: string | null }): Hint | null {
    const domain = normalizeHostname(input);
    if (!domain) return null;
    let hint = this.hints.get(domain);
    if (!hint) {
      if (this.hints.size >= this.limit) this.evictOldest();
      hint = { domain, count: 0, firstAt: now, lastAt: now, categories: {}, reasons: [] };
      this.hints.set(domain, hint);
    }
    hint.count += 1;
    hint.lastAt = now;
    const parsed = parseCategory(category);
    if (parsed) hint.categories[parsed] = (hint.categories[parsed] ?? 0) + 1;
    const text = cleanReason(reason, "");
    if (text.length > 0 && !hint.reasons.includes(text) && hint.reasons.length < REASONS_KEPT) hint.reasons.push(text);
    if (by) {
      if (!hint.firstBy) hint.firstBy = { key: by.key, payTo: by.payTo, at: now };
      else if (hint.firstBy.key.toLowerCase() === by.key.toLowerCase() && by.payTo) hint.firstBy.payTo = by.payTo;
    }
    this.schedule();
    return hint;
  }

  /** Attaches what the evidence probes found. */
  setEvidence(domain: string, evidence: Evidence): void {
    const hint = this.hints.get(domain);
    if (!hint) return;
    hint.evidence = evidence;
    this.schedule();
  }

  /** Every hint, for the ledger. */
  all(): Hint[] {
    return [...this.hints.values()];
  }

  /** Drops a name, for a report an operator judged junk or one the network has since decided. */
  remove(input: unknown): boolean {
    const domain = normalizeHostname(input);
    if (!domain || !this.hints.delete(domain)) return false;
    this.schedule();
    return true;
  }

  /** Names reported at or after `since`, most reported first. */
  recent(since: number, limit = 50): Hint[] {
    const out: Hint[] = [];
    for (const hint of this.hints.values()) if (hint.lastAt >= since) out.push(hint);
    return out.sort((a, b) => b.count - a.count || b.lastAt - a.lastAt || a.domain.localeCompare(b.domain)).slice(0, limit);
  }

  /** The category most reports gave, or null when none did. */
  static categoryOf(hint: Hint): Category | null {
    let best: Category | null = null;
    let bestCount = 0;
    for (const [key, count] of Object.entries(hint.categories)) {
      const category = parseCategory(key);
      if (category && typeof count === "number" && count > bestCount) {
        best = category;
        bestCount = count;
      }
    }
    return best;
  }

  toJSON(): HintsFile {
    return { version: 1, hints: [...this.hints.values()] };
  }

  /** Writes now instead of after the delay. */
  async flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.path) await writeJsonAtomic(this.path, this.toJSON());
  }

  private evictOldest(): void {
    let oldest: Hint | null = null;
    for (const hint of this.hints.values()) if (!oldest || hint.lastAt < oldest.lastAt) oldest = hint;
    if (oldest) this.hints.delete(oldest.domain);
  }

  private schedule(): void {
    if (!this.path || this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      writeJsonAtomic(this.path!, this.toJSON()).catch((error: unknown) => this.log(`could not write hints: ${error instanceof Error ? error.message : String(error)}`));
    }, WRITE_DELAY_MS);
    this.timer.unref?.();
  }
}
