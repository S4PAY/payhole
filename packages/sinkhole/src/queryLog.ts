/**
 * Query statistics built from dnsmasq's own log lines (`log-queries=extra`). The supervisor hands every line
 * dnsmasq prints to `ingest`; the lines that describe a query are aggregated into fixed-size rings and the
 * rest are ignored. Nothing is stored per query beyond a bounded ring of the most recent ones, so memory is
 * fixed however busy the resolver is. A snapshot of the rings is persisted by the caller on a timer.
 *
 * Line shapes, from dnsmasq's `log_query` (cache.c): with `log-queries=extra` every line starts with the query
 * id and, when known, the client `ip/port`; an optional `UDP ` or `TCP ` prefix appears with `log-queries=proto`.
 *
 *   12 192.168.1.5/54321 query[A] example.com from 192.168.1.5
 *   12 192.168.1.5/54321 forwarded example.com to 1.1.1.1
 *   12 192.168.1.5/54321 reply example.com is 93.184.216.34
 *   13 192.168.1.5/54322 cached example.com is 93.184.216.34
 *   14 192.168.1.5/54323 config drainer.example is 0.0.0.0
 *   15 192.168.1.5/54324 /data/dnsmasq/blocked.hosts ads.example is 0.0.0.0
 */

export type QueryStatus = "blocked" | "cached" | "forwarded" | "local" | "unanswered" | "unknown";

export interface QueryLine {
  kind: "query";
  id: number | null;
  client: string | null;
  type: string;
  domain: string;
}

export interface ForwardedLine {
  kind: "forwarded";
  id: number | null;
  client: string | null;
  domain: string;
  upstream: string;
}

export type AnswerSource = "reply" | "cached" | "config" | "hosts" | "auth";

export interface AnswerLine {
  kind: "answer";
  id: number | null;
  client: string | null;
  domain: string;
  source: AnswerSource;
  answer: string;
}

export type ParsedLine = QueryLine | ForwardedLine | AnswerLine;

const PREFIX = /^dnsmasq(?:-[a-z]+)?(?:\[\d+\])?:\s+/;
const EXTRA = /^(?:(?:UDP|TCP) )?(\d+) (?:(\S+)\/\d+ )?(.*)$/;
const QUERY = /^query\[([^\]]+)\] (\S+) from (\S+)$/;
const FORWARDED = /^forwarded (\S+) to (\S+)$/;
const ANSWER = /^(reply|cached|cached-stale|config|auth|\/\S+) (\S+) is (.+)$/;
const SINK_ANSWERS = new Set(["0.0.0.0", "::"]);

/** Parses one dnsmasq log line; null for lines that are not about a query (startup, DHCP, warnings). */
export function parseQueryLogLine(raw: string): ParsedLine | null {
  let line = raw.trim().replace(PREFIX, "");
  let id: number | null = null;
  let client: string | null = null;
  const extra = EXTRA.exec(line);
  if (extra?.[1] !== undefined && extra[3] !== undefined) {
    id = Number(extra[1]);
    client = extra[2] ?? null;
    line = extra[3];
  }
  const query = QUERY.exec(line);
  if (query?.[1] !== undefined && query[2] !== undefined && query[3] !== undefined) {
    return { kind: "query", id, client: client ?? query[3], type: query[1], domain: query[2].toLowerCase() };
  }
  const forwarded = FORWARDED.exec(line);
  if (forwarded?.[1] !== undefined && forwarded[2] !== undefined) {
    return { kind: "forwarded", id, client, domain: forwarded[1].toLowerCase(), upstream: forwarded[2] };
  }
  const answer = ANSWER.exec(line);
  if (answer?.[1] !== undefined && answer[2] !== undefined && answer[3] !== undefined) {
    const sourceText = answer[1];
    const source: AnswerSource = sourceText.startsWith("/") ? "hosts" : sourceText.startsWith("cached") ? "cached" : sourceText === "reply" ? "reply" : sourceText === "auth" ? "auth" : "config";
    return { kind: "answer", id, client, domain: answer[2].toLowerCase(), source, answer: answer[3].replace(/\s+\(.*\)$/, "").trim() };
  }
  return null;
}

export interface Bucket {
  total: number;
  blocked: number;
  cached: number;
  forwarded: number;
}

export interface QueryRecord {
  /** Time the query was seen, ms since the epoch. */
  t: number;
  client: string;
  domain: string;
  type: string;
  status: QueryStatus;
  /** Final answer (an address, NXDOMAIN, ...) when one was logged. */
  answer: string | null;
  upstream: string | null;
}

export interface QueryFilter {
  limit?: number;
  client?: string;
  domain?: string;
  status?: QueryStatus;
}

export interface Series {
  /** Time of the first slot, ms since the epoch; slot i covers [start + i * stepMs, start + (i + 1) * stepMs). */
  start: number;
  stepMs: number;
  total: number[];
  blocked: number[];
  cached: number[];
  forwarded: number[];
}

export interface StatsSnapshot {
  generatedAt: number;
  summary: {
    queries24h: number;
    blocked24h: number;
    blockedPercent: number;
    cached24h: number;
    forwarded24h: number;
    clients24h: number;
    queries7d: number;
    blocked7d: number;
  };
  minutes: Series;
  hours: Series;
  clients: { client: string; total: number; blocked: number }[];
  topBlocked: { domain: string; count: number }[];
  topPermitted: { domain: string; count: number }[];
  types: { type: string; count: number }[];
  upstreams: { upstream: string; count: number }[];
}

export interface QueryStatsOptions {
  clock?: () => number;
  /** Queries still waiting for an answer are finalised after this long. */
  pendingTimeoutMs?: number;
  maxPending?: number;
  logSize?: number;
  /** Distinct clients and distinct domains ranked per hourly slot; more than this in one hour are counted in totals only. */
  clientsPerSlot?: number;
  domainsPerSlot?: number;
}

interface Pending {
  id: number;
  client: string;
  domain: string;
  type: string;
  t: number;
  minute: number;
  hour: number;
  forwarded: string | null;
  answer: string | null;
  status: QueryStatus | null;
}

interface MinuteBucket extends Bucket {
  minute: number;
}

interface HourBucket extends Bucket {
  hour: number;
}

interface Slot {
  hour: number;
  clients: Map<string, { total: number; blocked: number }>;
  blocked: Map<string, number>;
  permitted: Map<string, number>;
  types: Map<string, number>;
  upstreams: Map<string, number>;
}

export interface QueryStatsState {
  version: 1;
  minutes: [number, number, number, number, number][];
  hours: [number, number, number, number, number][];
  slots: {
    hour: number;
    clients: [string, number, number][];
    blocked: [string, number][];
    permitted: [string, number][];
    types: [string, number][];
    upstreams: [string, number][];
  }[];
  log: QueryRecord[];
}

const MINUTE = 60_000;
const HOUR = 3_600_000;
export const MINUTE_SLOTS = 24 * 60;
export const HOUR_SLOTS = 7 * 24;
const CLIENT_SLOTS = 24;
const STATUSES: readonly QueryStatus[] = ["blocked", "cached", "forwarded", "local", "unanswered", "unknown"];

export function isQueryStatus(value: string): value is QueryStatus {
  return (STATUSES as readonly string[]).includes(value);
}

function bump(map: Map<string, number>, key: string, cap: number): void {
  const current = map.get(key);
  if (current !== undefined) map.set(key, current + 1);
  else if (map.size < cap) map.set(key, 1);
}

function top(maps: Map<string, number>[], limit: number): { key: string; count: number }[] {
  const total = new Map<string, number>();
  for (const map of maps) for (const [key, count] of map) total.set(key, (total.get(key) ?? 0) + count);
  return [...total]
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count || (a.key < b.key ? -1 : 1))
    .slice(0, limit);
}

/** Aggregates dnsmasq query log lines into bounded rings; see the module comment for the line shapes. */
export class QueryStats {
  private readonly clock: () => number;
  private readonly pendingTimeoutMs: number;
  private readonly maxPending: number;
  private readonly logSize: number;
  private readonly clientsPerSlot: number;
  private readonly domainsPerSlot: number;
  private readonly minutes: MinuteBucket[] = [];
  private readonly hours: HourBucket[] = [];
  private readonly slots: Slot[] = [];
  private readonly pending = new Map<number, Pending>();
  private readonly log: QueryRecord[] = [];
  private logNext = 0;
  private dirty = false;
  /** Lines that were not about a query, or answers whose query was never seen; exposed for tests. */
  ignored = 0;

  constructor(options: QueryStatsOptions = {}, state?: QueryStatsState | null) {
    this.clock = options.clock ?? Date.now;
    this.pendingTimeoutMs = options.pendingTimeoutMs ?? 10_000;
    this.maxPending = options.maxPending ?? 4096;
    this.logSize = options.logSize ?? 1000;
    this.clientsPerSlot = options.clientsPerSlot ?? 256;
    this.domainsPerSlot = options.domainsPerSlot ?? 1500;
    for (let i = 0; i < MINUTE_SLOTS; i += 1) this.minutes.push({ minute: -1, total: 0, blocked: 0, cached: 0, forwarded: 0 });
    for (let i = 0; i < HOUR_SLOTS; i += 1) this.hours.push({ hour: -1, total: 0, blocked: 0, cached: 0, forwarded: 0 });
    for (let i = 0; i < CLIENT_SLOTS; i += 1) this.slots.push({ hour: -1, clients: new Map(), blocked: new Map(), permitted: new Map(), types: new Map(), upstreams: new Map() });
    if (state) this.restore(state);
  }

  /** True when something changed since the last `toJSON`. */
  get changed(): boolean {
    return this.dirty;
  }

  /** Feeds one line dnsmasq printed. Returns true when the line described a query. */
  ingest(line: string, now = this.clock()): boolean {
    const parsed = parseQueryLogLine(line);
    if (!parsed) return false;
    this.dirty = true;
    switch (parsed.kind) {
      case "query":
        this.onQuery(parsed, now);
        return true;
      case "forwarded":
        this.onForwarded(parsed, now);
        return true;
      case "answer":
        this.onAnswer(parsed, now);
        return true;
    }
  }

  private minuteBucket(minute: number, create: boolean): MinuteBucket | null {
    const bucket = this.minutes[((minute % MINUTE_SLOTS) + MINUTE_SLOTS) % MINUTE_SLOTS];
    if (!bucket) return null;
    if (bucket.minute !== minute) {
      if (!create) return null;
      bucket.minute = minute;
      bucket.total = bucket.blocked = bucket.cached = bucket.forwarded = 0;
    }
    return bucket;
  }

  private hourBucket(hour: number, create: boolean): HourBucket | null {
    const bucket = this.hours[((hour % HOUR_SLOTS) + HOUR_SLOTS) % HOUR_SLOTS];
    if (!bucket) return null;
    if (bucket.hour !== hour) {
      if (!create) return null;
      bucket.hour = hour;
      bucket.total = bucket.blocked = bucket.cached = bucket.forwarded = 0;
    }
    return bucket;
  }

  private slot(hour: number, create: boolean): Slot | null {
    const slot = this.slots[((hour % CLIENT_SLOTS) + CLIENT_SLOTS) % CLIENT_SLOTS];
    if (!slot) return null;
    if (slot.hour !== hour) {
      if (!create) return null;
      slot.hour = hour;
      slot.clients.clear();
      slot.blocked.clear();
      slot.permitted.clear();
      slot.types.clear();
      slot.upstreams.clear();
    }
    return slot;
  }

  private onQuery(line: QueryLine, now: number): void {
    const minute = Math.floor(now / MINUTE);
    const hour = Math.floor(now / HOUR);
    const client = line.client ?? "unknown";
    const mb = this.minuteBucket(minute, true);
    const hb = this.hourBucket(hour, true);
    const slot = this.slot(hour, true);
    if (mb) mb.total += 1;
    if (hb) hb.total += 1;
    if (slot) {
      const entry = slot.clients.get(client);
      if (entry) entry.total += 1;
      else if (slot.clients.size < this.clientsPerSlot) slot.clients.set(client, { total: 1, blocked: 0 });
      bump(slot.types, line.type, 64);
    }
    if (line.id === null) {
      this.pushLog({ t: now, client, domain: line.domain, type: line.type, status: "unknown", answer: null, upstream: null });
      return;
    }
    const previous = this.pending.get(line.id);
    if (previous) this.finalize(previous, previous.status ?? "unanswered");
    if (this.pending.size >= this.maxPending) {
      const oldest = this.pending.values().next().value;
      if (oldest) this.finalize(oldest, oldest.status ?? "unanswered");
    }
    this.pending.set(line.id, { id: line.id, client, domain: line.domain, type: line.type, t: now, minute, hour, forwarded: null, answer: null, status: null });
  }

  private onForwarded(line: ForwardedLine, now: number): void {
    const upstream = line.upstream.replace(/#53$/, "");
    if (line.id === null) {
      const slot = this.slot(Math.floor(now / HOUR), true);
      if (slot) bump(slot.upstreams, upstream, 32);
      return;
    }
    const pending = this.pending.get(line.id);
    if (!pending) {
      this.ignored += 1;
      return;
    }
    if (pending.forwarded === null) {
      pending.forwarded = upstream;
      const slot = this.slot(pending.hour, false);
      if (slot) bump(slot.upstreams, upstream, 32);
    }
  }

  private static statusOf(line: AnswerLine): QueryStatus {
    switch (line.source) {
      case "config":
      case "hosts":
        return SINK_ANSWERS.has(line.answer) ? "blocked" : "local";
      case "cached":
        return "cached";
      case "reply":
        return "forwarded";
      case "auth":
        return "local";
    }
  }

  private onAnswer(line: AnswerLine, now: number): void {
    const status = QueryStats.statusOf(line);
    if (line.id === null) {
      const mb = this.minuteBucket(Math.floor(now / MINUTE), true);
      const hb = this.hourBucket(Math.floor(now / HOUR), true);
      if (status === "blocked" || status === "cached" || status === "forwarded") {
        if (mb) mb[status] += 1;
        if (hb) hb[status] += 1;
      }
      return;
    }
    const pending = this.pending.get(line.id);
    if (!pending) {
      this.ignored += 1;
      return;
    }
    // A query that went upstream and whose reply is then served from the cache is still an upstream query.
    pending.status = status === "cached" && pending.forwarded !== null ? "forwarded" : status;
    pending.answer = line.answer;
    if (line.answer === "<CNAME>") return;
    this.finalize(pending, pending.status);
  }

  private finalize(pending: Pending, status: QueryStatus): void {
    this.pending.delete(pending.id);
    const mb = this.minuteBucket(pending.minute, false);
    const hb = this.hourBucket(pending.hour, false);
    if (status === "blocked" || status === "cached" || status === "forwarded") {
      if (mb) mb[status] += 1;
      if (hb) hb[status] += 1;
    }
    const slot = this.slot(pending.hour, false);
    if (slot) {
      if (status === "blocked") {
        const client = slot.clients.get(pending.client);
        if (client) client.blocked += 1;
        bump(slot.blocked, pending.domain, this.domainsPerSlot);
      } else if (status === "cached" || status === "forwarded") {
        bump(slot.permitted, pending.domain, this.domainsPerSlot);
      }
    }
    this.pushLog({ t: pending.t, client: pending.client, domain: pending.domain, type: pending.type, status, answer: pending.answer, upstream: pending.forwarded });
  }

  private pushLog(record: QueryRecord): void {
    if (this.log.length < this.logSize) this.log.push(record);
    else this.log[this.logNext] = record;
    this.logNext = (this.logNext + 1) % this.logSize;
    this.dirty = true;
  }

  /** Finalises queries that never got an answer line. Call on a timer. */
  sweep(now = this.clock()): number {
    let swept = 0;
    for (const pending of this.pending.values()) {
      if (now - pending.t < this.pendingTimeoutMs) continue;
      this.finalize(pending, pending.status ?? (pending.forwarded ? "forwarded" : "unanswered"));
      swept += 1;
    }
    if (swept > 0) this.dirty = true;
    return swept;
  }

  private series(kind: "minutes" | "hours", now: number): Series {
    const stepMs = kind === "minutes" ? MINUTE : HOUR;
    const slots = kind === "minutes" ? MINUTE_SLOTS : HOUR_SLOTS;
    const current = Math.floor(now / stepMs);
    const first = current - slots + 1;
    const out: Series = { start: first * stepMs, stepMs, total: [], blocked: [], cached: [], forwarded: [] };
    for (let i = 0; i < slots; i += 1) {
      const key = first + i;
      const bucket = kind === "minutes" ? this.minuteBucket(key, false) : this.hourBucket(key, false);
      out.total.push(bucket?.total ?? 0);
      out.blocked.push(bucket?.blocked ?? 0);
      out.cached.push(bucket?.cached ?? 0);
      out.forwarded.push(bucket?.forwarded ?? 0);
    }
    return out;
  }

  private liveSlots(now: number): Slot[] {
    const current = Math.floor(now / HOUR);
    const out: Slot[] = [];
    for (let hour = current - CLIENT_SLOTS + 1; hour <= current; hour += 1) {
      const slot = this.slot(hour, false);
      if (slot) out.push(slot);
    }
    return out;
  }

  snapshot(now = this.clock()): StatsSnapshot {
    const minutes = this.series("minutes", now);
    const hours = this.series("hours", now);
    const sum = (values: number[]): number => values.reduce((a, b) => a + b, 0);
    const queries24h = sum(minutes.total);
    const blocked24h = sum(minutes.blocked);
    const slots = this.liveSlots(now);
    const clients = new Map<string, { total: number; blocked: number }>();
    for (const slot of slots) {
      for (const [client, counts] of slot.clients) {
        const entry = clients.get(client);
        if (entry) {
          entry.total += counts.total;
          entry.blocked += counts.blocked;
        } else clients.set(client, { ...counts });
      }
    }
    return {
      generatedAt: now,
      summary: {
        queries24h,
        blocked24h,
        blockedPercent: queries24h === 0 ? 0 : Math.round((blocked24h / queries24h) * 1000) / 10,
        cached24h: sum(minutes.cached),
        forwarded24h: sum(minutes.forwarded),
        clients24h: clients.size,
        queries7d: sum(hours.total),
        blocked7d: sum(hours.blocked),
      },
      minutes,
      hours,
      clients: [...clients]
        .map(([client, counts]) => ({ client, ...counts }))
        .sort((a, b) => b.total - a.total || (a.client < b.client ? -1 : 1))
        .slice(0, 100),
      topBlocked: top(slots.map((s) => s.blocked), 100).map((e) => ({ domain: e.key, count: e.count })),
      topPermitted: top(slots.map((s) => s.permitted), 100).map((e) => ({ domain: e.key, count: e.count })),
      types: top(slots.map((s) => s.types), 20).map((e) => ({ type: e.key, count: e.count })),
      upstreams: top(slots.map((s) => s.upstreams), 20).map((e) => ({ upstream: e.key, count: e.count })),
    };
  }

  /** The most recent queries, newest first, optionally filtered. */
  queries(filter: QueryFilter = {}): QueryRecord[] {
    const limit = Math.max(1, Math.min(filter.limit ?? 200, this.logSize));
    const client = filter.client?.trim().toLowerCase();
    const domain = filter.domain?.trim().toLowerCase();
    const out: QueryRecord[] = [];
    const size = this.log.length;
    for (let i = 1; i <= size && out.length < limit; i += 1) {
      const record = this.log[(((this.logNext - i) % size) + size) % size];
      if (!record) continue;
      if (client && !record.client.toLowerCase().includes(client)) continue;
      if (domain && !record.domain.includes(domain)) continue;
      if (filter.status && record.status !== filter.status) continue;
      out.push(record);
    }
    return out;
  }

  toJSON(): QueryStatsState {
    this.dirty = false;
    const ordered: QueryRecord[] = [];
    const size = this.log.length;
    for (let i = 0; i < size; i += 1) {
      const record = this.log[(this.logNext + i) % size];
      if (record) ordered.push(record);
    }
    return {
      version: 1,
      minutes: this.minutes.filter((b) => b.minute >= 0).map((b) => [b.minute, b.total, b.blocked, b.cached, b.forwarded]),
      hours: this.hours.filter((b) => b.hour >= 0).map((b) => [b.hour, b.total, b.blocked, b.cached, b.forwarded]),
      slots: this.slots
        .filter((s) => s.hour >= 0)
        .map((s) => ({
          hour: s.hour,
          clients: [...s.clients].map(([client, c]) => [client, c.total, c.blocked]),
          blocked: [...s.blocked],
          permitted: [...s.permitted],
          types: [...s.types],
          upstreams: [...s.upstreams],
        })),
      log: ordered,
    };
  }

  private restore(state: QueryStatsState): void {
    if (state.version !== 1) return;
    for (const [minute, total, blocked, cached, forwarded] of state.minutes) {
      const bucket = this.minuteBucket(minute, true);
      if (bucket) Object.assign(bucket, { total, blocked, cached, forwarded });
    }
    for (const [hour, total, blocked, cached, forwarded] of state.hours) {
      const bucket = this.hourBucket(hour, true);
      if (bucket) Object.assign(bucket, { total, blocked, cached, forwarded });
    }
    for (const saved of state.slots) {
      const slot = this.slot(saved.hour, true);
      if (!slot) continue;
      for (const [client, total, blocked] of saved.clients) slot.clients.set(client, { total, blocked });
      for (const [domain, count] of saved.blocked) slot.blocked.set(domain, count);
      for (const [domain, count] of saved.permitted) slot.permitted.set(domain, count);
      for (const [type, count] of saved.types) slot.types.set(type, count);
      for (const [upstream, count] of saved.upstreams) slot.upstreams.set(upstream, count);
    }
    for (const record of state.log.slice(-this.logSize)) this.pushLog(record);
    this.dirty = false;
  }
}
