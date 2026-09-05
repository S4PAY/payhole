/**
 * Browser side of the admin page. Served as `/admin/client.js`; talks only to this origin's JSON API with the
 * token the operator pasted. No framework, no external requests.
 */

interface Health {
  ok: boolean;
  dnsmasq?: boolean;
  peers?: number;
}

interface StatusCounts {
  local: number;
  manual: number;
  swarmConfirmed: number;
  swarmFlagged: number;
  list?: number;
  merged: number;
  queries24h?: number;
  blocked24h?: number;
}

interface Status {
  peerId: string | null;
  listenAddrs?: string[];
  connectedPeers?: string[];
  identity: { address: string; publishing: boolean } | null;
  counts: StatusCounts;
  flagThreshold: number;
  flagTtlDays?: number;
  directory?: number;
  lastSync?: { extension: { updatedAt: string | null; receivedAt: number | null }; swarm: number | null };
  swarm?: { received: number; accepted: number; dropped: Record<string, number> } | null;
  dnsmasq?: { running: boolean; pid: number | null; restarts: number; unexpectedExits?: number; lastReloadAt?: number | null; lastExit?: unknown };
  uptimeSeconds?: number;
  queryLog?: { enabled: boolean };
  lists?: number;
  allowlist?: { rules: number; sources: number };
  node?: { hostname: string; version: string; startedAt: number };
  config?: {
    dns: { listen: string; port: number; upstream: string[]; cacheSize: number };
    admin: { listen: string; port: number };
    swarm: { enabled: boolean; listen: string[]; bootstrap: string[]; mdns: boolean };
    membership: { minTier: number; vault: string | null };
    extension: { url: string | null; pullMinutes: number };
    flags: { threshold: number; ttlDays: number; reannounceMinutes: number };
    encryptedDns?: { doh: { enabled: boolean; listen: string; port: number }; dot: { enabled: boolean; listen: string; port: number }; rateLimitPerMinute: number };
    queryLog?: { enabled: boolean };
    lists?: { refreshHours: number };
  };
}

interface Series {
  start: number;
  stepMs: number;
  total: number[];
  blocked: number[];
  cached: number[];
  forwarded: number[];
}

interface Stats {
  generatedAt: number;
  summary: { queries24h: number; blocked24h: number; blockedPercent: number; cached24h: number; forwarded24h: number; clients24h: number; queries7d: number; blocked7d: number };
  minutes: Series;
  hours: Series;
  clients: { client: string; total: number; blocked: number }[];
  topBlocked: { domain: string; count: number }[];
  topPermitted: { domain: string; count: number }[];
  types: { type: string; count: number }[];
  upstreams: { upstream: string; count: number }[];
}

interface QueryRecord {
  t: number;
  client: string;
  domain: string;
  type: string;
  status: string;
  answer: string | null;
  upstream: string | null;
}

interface SubscriptionInfo {
  id: string;
  url: string;
  addedAt: number;
  lastFetchedAt: number | null;
  lastSuccessAt: number | null;
  lastError: string | null;
  entries: number;
  bytes: number;
  nextRefreshAt: number | null;
}

interface BlockEntry {
  domain: string;
  sources: string[];
  reason: string;
}

interface FlagEntry {
  domain: string;
  reporters: number;
  confirmed: boolean;
  firstSeen: number;
  lastSeen: number;
  reasons: string[];
}

interface DirectoryEntry {
  url: string;
  network: string;
  asset: string;
  payTo: string;
  amount: string | null;
  origin: string;
  verifiedAt: number;
}

const STORAGE_KEY = "sinkhole-token";
const REFRESH_MS = 30_000;
const ROW_LIMIT = 500;

let token = "";
let connected = false;
let timer: number | null = null;
let entries: BlockEntry[] = [];
let toastTimer: number | null = null;
let statsEnabled = true;
let listsEnabled = true;
let logStatus = "";
let filterTimer: number | null = null;

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`missing #${id}`);
  return node as T;
}

function text(id: string, value: string, className?: string): void {
  const node = el(id);
  node.textContent = value;
  if (className !== undefined) node.className = className;
}

function readToken(): string {
  try {
    return localStorage.getItem(STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
}

function storeToken(value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, value);
  } catch {
    /* storage unavailable */
  }
}

class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const headers: Record<string, string> = { authorization: `Bearer ${token}` };
  const request: RequestInit = { method: init.method ?? "GET", headers };
  if (init.body !== undefined) {
    headers["content-type"] = "application/json";
    request.body = JSON.stringify(init.body);
  }
  const res = await fetch(path, request);
  const type = res.headers.get("content-type") ?? "";
  const data: unknown = type.startsWith("application/json") ? await res.json() : await res.text();
  if (!res.ok) {
    const record = typeof data === "object" && data !== null ? (data as Record<string, unknown>) : {};
    const code = typeof record["error"] === "string" ? record["error"] : `HTTP ${res.status}`;
    const message = typeof record["message"] === "string" ? record["message"] : "";
    throw new ApiError(res.status, message ? `${code}: ${message}` : code);
  }
  return data as T;
}

function toast(message: string, kind: "good" | "bad" = "bad"): void {
  const node = el("toast");
  node.textContent = message;
  node.className = `toast ${kind}`;
  node.hidden = false;
  if (toastTimer !== null) window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    node.hidden = true;
  }, kind === "bad" ? 6000 : 3500);
}

function short(value: string, head = 8, tail = 6): string {
  return value.length > head + tail + 1 ? `${value.slice(0, head)}…${value.slice(-tail)}` : value;
}

function when(ms: number | null | undefined): string {
  if (!ms) return "never";
  return new Date(ms).toLocaleString(undefined, { hour12: false, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function ago(ms: number | null | undefined): string {
  if (!ms) return "never";
  const seconds = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
  if (seconds < 86_400) return `${Math.round(seconds / 3600)}h ago`;
  return `${Math.round(seconds / 86_400)}d ago`;
}

function duration(seconds: number | undefined): string {
  if (seconds === undefined) return "";
  const s = Math.round(seconds);
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
  if (s < 86_400) return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
  return `${Math.floor(s / 86_400)}d ${Math.floor((s % 86_400) / 3600)}h`;
}

function cell(row: HTMLTableRowElement, content: string | Node, className?: string): HTMLTableCellElement {
  const td = document.createElement("td");
  if (typeof content === "string") td.textContent = content;
  else td.appendChild(content);
  if (className !== undefined) td.className = className;
  row.appendChild(td);
  return td;
}

function tag(label: string, className: string): HTMLSpanElement {
  const span = document.createElement("span");
  span.className = `tag ${className}`;
  span.textContent = label;
  return span;
}

function tags(labels: string[]): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "tags";
  for (const label of labels) wrap.appendChild(tag(label, label));
  return wrap;
}

function meter(value: number, threshold: number): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "meter";
  const bar = document.createElement("div");
  bar.className = "bar";
  const fill = document.createElement("i");
  fill.style.width = `${Math.min(100, Math.round((value / Math.max(1, threshold)) * 100))}%`;
  bar.appendChild(fill);
  const num = document.createElement("span");
  num.className = "num";
  num.textContent = `${value} / ${threshold}`;
  wrap.append(bar, num);
  return wrap;
}

function setEmpty(id: string, wrapId: string, message: string | null): void {
  const empty = el(id);
  const wrap = el(wrapId);
  empty.hidden = message === null;
  wrap.hidden = message !== null;
  if (message !== null) empty.textContent = message;
}

/* ---- Status cards ---- */

function renderHealth(health: Health | null): void {
  if (!health) {
    text("s-resolver", "offline", "value danger");
    text("s-resolver-sub", "the admin API did not answer");
    text("s-peers", "—", "value");
    text("s-peers-sub", "unknown");
    return;
  }
  const running = health.dnsmasq === true;
  text("s-resolver", running ? "running" : "stopped", running ? "value ok" : "value danger");
  text("s-resolver-sub", running ? "dnsmasq is answering queries" : "dnsmasq is not running");
  const peers = health.peers ?? 0;
  text("s-peers", String(peers), "value");
  if (!connected) text("s-peers-sub", peers === 0 ? "no peers connected yet" : "connected");
}

function renderStatus(status: Status): void {
  const c = status.counts;
  text("s-blocked", c.merged.toLocaleString(), "value");
  text(
    "s-blocked-sub",
    `${c.local} from the extension, ${c.manual} manual, ${c.swarmConfirmed} from the swarm${c.list ? `, ${c.list.toLocaleString()} from lists` : ""}${status.allowlist?.rules ? `; ${status.allowlist.rules} allowlist rules` : ""}`,
  );
  statsEnabled = status.queryLog?.enabled ?? c.queries24h !== undefined;
  if (!statsEnabled) {
    text("s-queries", "off", "value small");
    text("s-queries-sub", "query logging is disabled on this node");
    text("s-blocked24", "off", "value small");
    text("s-blocked24-sub", "set QUERY_LOG_ENABLED=1 to count");
  }
  const peers = status.connectedPeers?.length ?? 0;
  text("s-peers", String(peers), "value");
  const bootstrap = status.config?.swarm.bootstrap.length ?? 0;
  text("s-peers-sub", status.peerId === null ? "swarm disabled" : peers === 0 ? (bootstrap === 0 ? "no bootstrap peers configured" : "waiting for peers") : "connected");
  const pending = Math.max(0, c.swarmFlagged - c.swarmConfirmed);
  text("s-flags", String(pending), "value");
  text("s-flags-sub", `${c.swarmConfirmed} confirmed at ${status.flagThreshold} reporters`);
  const ext = status.lastSync?.extension;
  text("s-ext", ext?.receivedAt ? ago(ext.receivedAt) : "never", "value small");
  text("s-ext-sub", ext?.receivedAt ? `list dated ${ext.updatedAt ?? "unknown"}` : status.config?.extension.url ? `pulling ${status.config.extension.url}` : "no extension has pushed a list yet");
  const swarmAt = status.lastSync?.swarm ?? null;
  text("s-swarm", swarmAt ? ago(swarmAt) : "none", "value small");
  const sw = status.swarm;
  text("s-swarm-sub", sw ? `${sw.received} received, ${sw.accepted} accepted` : "swarm disabled");
  const dns = status.dnsmasq;
  text("s-reloads", String(dns?.restarts ?? 0), "value");
  text("s-reloads-sub", dns ? (dns.running ? `pid ${dns.pid ?? "?"}, ${dns.unexpectedExits ?? 0} unexpected exits` : "not running") : "");
  text("s-peer", status.peerId ? short(status.peerId, 10, 6) : "off", "value small");
  const copy = el<HTMLButtonElement>("copy-peer");
  copy.hidden = status.peerId === null;
  copy.onclick = () => {
    if (status.peerId) void copyText(status.peerId, "peer id copied");
  };
}

async function copyText(value: string, done: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(value);
    toast(done, "good");
  } catch {
    toast("copy failed; select the text instead");
  }
}

/* ---- Blocklist ---- */

let blocklistTotal = 0;
let blocklistMatched = 0;

async function loadBlocklist(): Promise<void> {
  const filter = el<HTMLInputElement>("filter").value.trim().toLowerCase();
  const data = await api<{ count: number; matched: number; entries: BlockEntry[] }>(`/api/blocklist?limit=${ROW_LIMIT}${filter ? `&q=${encodeURIComponent(filter)}` : ""}`);
  entries = data.entries;
  blocklistTotal = data.count;
  blocklistMatched = data.matched;
  renderBlocklist();
}

function renderBlocklist(): void {
  const filter = el<HTMLInputElement>("filter").value.trim().toLowerCase();
  const body = el<HTMLTableSectionElement>("blocklist").querySelector("tbody");
  if (!body) return;
  body.replaceChildren();
  let shown = 0;
  const matched = blocklistMatched;
  for (const entry of entries) {
    if (shown >= ROW_LIMIT) break;
    shown += 1;
    const tr = document.createElement("tr");
    cell(tr, entry.domain, "mono");
    cell(tr, tags(entry.sources));
    cell(tr, entry.reason);
    const actions = cell(tr, "");
    if (entry.sources.includes("manual")) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "danger small";
      button.textContent = "Remove";
      button.onclick = () => {
        button.disabled = true;
        api(`/api/blocklist/manual/${encodeURIComponent(entry.domain)}`, { method: "DELETE" })
          .then(() => {
            toast(`${entry.domain} removed`, "good");
            return refreshAll();
          })
          .catch((error: unknown) => {
            button.disabled = false;
            toast(describe(error));
          });
      };
      actions.appendChild(button);
    }
    body.appendChild(tr);
  }
  const meta = blocklistTotal === 0 ? "" : filter ? `${matched} of ${blocklistTotal} match${shown < matched ? `, showing ${shown}` : ""}` : `${blocklistTotal} domains${shown < blocklistTotal ? `, showing ${shown}` : ""}`;
  text("bl-meta", meta);
  text("t-blocklist", blocklistTotal ? String(blocklistTotal) : "");
  if (blocklistTotal === 0) {
    setEmpty("bl-empty", "bl-wrap", "Nothing is blocked yet. Domains arrive here from the extension's blocklist sync, from swarm flags once enough peers agree, from subscribed lists, or from the form above. The resolver answers everything normally until then.");
  } else if (matched === 0) {
    setEmpty("bl-empty", "bl-wrap", `No domain matches "${filter}".`);
  } else {
    setEmpty("bl-empty", "bl-wrap", null);
  }
}

/* ---- Query statistics ---- */

const SVG = "http://www.w3.org/2000/svg";

function svgEl<K extends keyof SVGElementTagNameMap>(name: K, attrs: Record<string, string | number>): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG, name);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
  return node;
}

function compact(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 10_000) return `${Math.round(value / 1000)}k`;
  if (value >= 1000) return `${(value / 1000).toFixed(1)}k`;
  return String(value);
}

interface Bin {
  start: number;
  end: number;
  total: number;
  blocked: number;
}

function binSeries(series: Series, size: number): Bin[] {
  const bins: Bin[] = [];
  for (let i = 0; i < series.total.length; i += size) {
    let total = 0;
    let blocked = 0;
    for (let j = i; j < Math.min(i + size, series.total.length); j += 1) {
      total += series.total[j] ?? 0;
      blocked += series.blocked[j] ?? 0;
    }
    bins.push({ start: series.start + i * series.stepMs, end: series.start + Math.min(i + size, series.total.length) * series.stepMs, total, blocked });
  }
  return bins;
}

function clock(ms: number): string {
  return new Date(ms).toLocaleTimeString(undefined, { hour12: false, hour: "2-digit", minute: "2-digit" });
}

function dayLabel(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, { weekday: "short", day: "2-digit" });
}

function drawChart(id: string, noteId: string, axisId: string, bins: Bin[], label: (bin: Bin) => string, ticks: (bin: Bin) => string): void {
  const host = el(id);
  host.replaceChildren();
  const width = 1000;
  const height = 100;
  const max = Math.max(1, ...bins.map((b) => b.total));
  const svg = svgEl("svg", { viewBox: `0 0 ${width} ${height}`, preserveAspectRatio: "none", role: "img", "aria-label": "queries per interval" });
  for (const fraction of [0.25, 0.5, 0.75]) svg.appendChild(svgEl("line", { class: "grid", x1: 0, x2: width, y1: height * fraction, y2: height * fraction }));
  const slot = width / bins.length;
  const gap = Math.min(2, slot * 0.2);
  bins.forEach((bin, i) => {
    const x = i * slot;
    const totalH = (bin.total / max) * height;
    const blockedH = (bin.blocked / max) * height;
    svg.appendChild(svgEl("rect", { class: "permitted", x: x + gap / 2, y: height - totalH, width: Math.max(0.5, slot - gap), height: totalH }));
    if (blockedH > 0) svg.appendChild(svgEl("rect", { class: "blocked", x: x + gap / 2, y: height - blockedH, width: Math.max(0.5, slot - gap), height: blockedH }));
  });
  const hit = svgEl("rect", { class: "hit", x: 0, y: 0, width: slot, height, visibility: "hidden" });
  svg.appendChild(hit);
  const note = el(noteId);
  const show = (event: PointerEvent): void => {
    const box = svg.getBoundingClientRect();
    const index = Math.min(bins.length - 1, Math.max(0, Math.floor(((event.clientX - box.left) / box.width) * bins.length)));
    const bin = bins[index];
    if (!bin) return;
    hit.setAttribute("x", String(index * slot));
    hit.setAttribute("visibility", "visible");
    note.textContent = label(bin);
  };
  svg.addEventListener("pointermove", show);
  svg.addEventListener("pointerdown", show);
  svg.addEventListener("pointerleave", () => hit.setAttribute("visibility", "hidden"));
  host.appendChild(svg);
  const axis = el(axisId);
  axis.replaceChildren();
  const first = bins[0];
  const middle = bins[Math.floor(bins.length / 2)];
  const last = bins[bins.length - 1];
  for (const bin of [first, middle, last]) {
    const span = document.createElement("span");
    span.textContent = bin ? ticks(bin) : "";
    axis.appendChild(span);
  }
}

function barList(id: string, rows: { label: string; count: number; blocked?: boolean }[], empty: string): void {
  const host = el(id);
  host.replaceChildren();
  if (rows.length === 0) {
    const p = document.createElement("div");
    p.className = "muted";
    p.style.fontSize = "12px";
    p.textContent = empty;
    host.appendChild(p);
    return;
  }
  const max = Math.max(1, ...rows.map((r) => r.count));
  for (const row of rows.slice(0, 8)) {
    const wrap = document.createElement("div");
    wrap.className = row.blocked ? "bar-row blocked" : "bar-row";
    const label = document.createElement("div");
    label.className = "bar-label";
    label.textContent = row.label;
    label.title = row.label;
    const track = document.createElement("div");
    track.className = "bar-track";
    const fill = document.createElement("i");
    fill.style.width = `${Math.max(2, Math.round((row.count / max) * 100))}%`;
    track.appendChild(fill);
    const count = document.createElement("div");
    count.className = "bar-count";
    count.textContent = compact(row.count);
    wrap.append(label, track, count);
    host.appendChild(wrap);
  }
}

function renderStats(stats: Stats | null): void {
  const body = el("q-body");
  if (!stats) {
    text("t-queries", "");
    body.hidden = true;
    setEmpty("q-empty", "q-body", "Query logging is off on this node. Set QUERY_LOG_ENABLED=1 to count queries, chart them, and keep a short log of recent lookups. Nothing is stored per query beyond a ring of the last thousand.");
    return;
  }
  body.hidden = false;
  el("q-empty").hidden = true;
  const s = stats.summary;
  text("s-queries", compact(s.queries24h), "value");
  text("s-queries-sub", s.queries24h === 0 ? "no queries in the last 24 hours" : `${s.clients24h} client${s.clients24h === 1 ? "" : "s"}, ${compact(s.queries7d)} in 7 days`);
  text("s-blocked24", compact(s.blocked24h), "value ok");
  text("s-blocked24-sub", s.queries24h === 0 ? "nothing to block yet" : `${s.blockedPercent}% of queries, ${compact(s.cached24h)} from cache`);
  text("t-queries", s.queries24h ? compact(s.queries24h) : "");
  text("q-meta", `${compact(s.queries24h)} queries, ${compact(s.blocked24h)} blocked, ${compact(s.forwarded24h)} forwarded, ${compact(s.cached24h)} cached`);
  text("q-week-meta", `${compact(s.queries7d)} queries, ${compact(s.blocked7d)} blocked`);
  const day = binSeries(stats.minutes, 10);
  drawChart("chart-day", "chart-day-note", "chart-day-axis", day, (bin) => `${clock(bin.start)} to ${clock(bin.end)}: ${bin.total} queries, ${bin.blocked} blocked`, (bin) => clock(bin.start));
  const week = binSeries(stats.hours, 1);
  drawChart("chart-week", "chart-week-note", "chart-week-axis", week, (bin) => `${dayLabel(bin.start)} ${clock(bin.start)}: ${bin.total} queries, ${bin.blocked} blocked`, (bin) => dayLabel(bin.start));
  barList("bars-blocked", stats.topBlocked.map((d) => ({ label: d.domain, count: d.count, blocked: true })), "nothing blocked in the last 24 hours");
  barList("bars-permitted", stats.topPermitted.map((d) => ({ label: d.domain, count: d.count })), "no permitted lookups yet");
  barList("bars-clients", stats.clients.map((c) => ({ label: c.client, count: c.total })), "no clients yet");
  barList("bars-types", stats.types.map((t) => ({ label: t.type, count: t.count })), "no queries yet");
  barList("bars-upstreams", stats.upstreams.map((u) => ({ label: u.upstream, count: u.count })), "nothing forwarded yet");
}

function renderQueryLog(records: QueryRecord[]): void {
  const body = el<HTMLTableSectionElement>("log").querySelector("tbody");
  if (!body) return;
  body.replaceChildren();
  for (const record of records) {
    const tr = document.createElement("tr");
    cell(tr, new Date(record.t).toLocaleTimeString(undefined, { hour12: false }), "mono");
    cell(tr, record.client, "mono");
    cell(tr, record.domain, "mono");
    cell(tr, record.type, "mono");
    cell(tr, tag(record.status, record.status));
    cell(tr, record.answer ?? (record.upstream ? `to ${record.upstream}` : ""), "mono");
    body.appendChild(tr);
  }
  const filter = el<HTMLInputElement>("log-filter").value.trim();
  text("log-meta", records.length ? `${records.length} most recent${logStatus ? ` ${logStatus}` : ""}${filter ? ` matching "${filter}"` : ""}` : "");
  setEmpty("log-empty", "log-wrap", records.length === 0 ? (filter || logStatus ? "No recent query matches that filter." : "No queries logged yet. The log fills as devices resolve names through this node.") : null);
}

async function loadQueries(): Promise<void> {
  if (!statsEnabled) return;
  const filter = el<HTMLInputElement>("log-filter").value.trim();
  const params = new URLSearchParams({ limit: "60" });
  if (filter) params.set(/^[0-9a-f.:]+$/i.test(filter) ? "client" : "domain", filter);
  if (logStatus) params.set("status", logStatus);
  const data = await api<{ entries: QueryRecord[] }>(`/api/queries?${params.toString()}`);
  renderQueryLog(data.entries);
}

/* ---- Lists ---- */

function renderLists(items: SubscriptionInfo[] | null): void {
  const tab = document.querySelector<HTMLElement>('.tab[data-tab="lists"]');
  if (tab) tab.hidden = items === null;
  if (items === null) return;
  const body = el<HTMLTableSectionElement>("lists").querySelector("tbody");
  if (!body) return;
  body.replaceChildren();
  let total = 0;
  for (const item of items) {
    total += item.entries;
    const tr = document.createElement("tr");
    const link = document.createElement("a");
    link.href = item.url;
    link.target = "_blank";
    link.rel = "noopener";
    link.textContent = item.url;
    cell(tr, link, "mono");
    cell(tr, item.entries ? compact(item.entries) : "0", "mono");
    cell(tr, item.lastSuccessAt ? ago(item.lastSuccessAt) : item.lastFetchedAt ? `failed ${ago(item.lastFetchedAt)}` : "never", "mono");
    cell(tr, item.nextRefreshAt ? (item.nextRefreshAt <= Date.now() ? "due" : `in ${ago(Date.now() * 2 - item.nextRefreshAt).replace(" ago", "")}`) : "", "mono");
    cell(tr, item.lastError ? tag("error", "error") : item.lastSuccessAt ? tag("ok", "ok") : tag("pending", ""));
    const actions = cell(tr, "");
    const refresh = document.createElement("button");
    refresh.type = "button";
    refresh.className = "small";
    refresh.textContent = "Refresh";
    refresh.onclick = () => {
      refresh.disabled = true;
      api<{ refresh: { ok: boolean; entries: number; error: string | null } }>(`/api/subscriptions/${item.id}/refresh`, { method: "POST" })
        .then((result) => {
          if (result.refresh.ok) toast(`${result.refresh.entries} names from ${item.url}`, "good");
          else toast(result.refresh.error ?? "refresh failed");
          return refreshAll();
        })
        .catch((error: unknown) => toast(describe(error)))
        .finally(() => {
          refresh.disabled = false;
        });
    };
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "danger small";
    remove.textContent = "Remove";
    remove.onclick = () => {
      remove.disabled = true;
      api(`/api/subscriptions/${item.id}`, { method: "DELETE" })
        .then(() => {
          toast("list removed", "good");
          return refreshAll();
        })
        .catch((error: unknown) => {
          remove.disabled = false;
          toast(describe(error));
        });
    };
    actions.append(refresh, document.createTextNode(" "), remove);
    if (item.lastError) {
      const why = document.createElement("div");
      why.className = "muted";
      why.style.fontSize = "11px";
      why.textContent = item.lastError;
      tr.cells[4]?.appendChild(why);
    }
    body.appendChild(tr);
  }
  text("lists-meta", items.length ? `${items.length} list${items.length === 1 ? "" : "s"}, ${compact(total)} names` : "");
  text("t-lists", items.length ? String(items.length) : "");
  setEmpty("lists-empty", "lists-wrap", items.length === 0 ? "No lists subscribed. Add a public blocklist URL above and this node fetches it now and again every refresh interval; its names are blocked by exact match, next to the curated sources." : null);
}

/* ---- Flags ---- */

function renderFlags(data: { threshold: number; entries: FlagEntry[] }): void {
  const body = el<HTMLTableSectionElement>("flags").querySelector("tbody");
  if (!body) return;
  body.replaceChildren();
  const sorted = [...data.entries].sort((a, b) => b.lastSeen - a.lastSeen);
  for (const entry of sorted.slice(0, ROW_LIMIT)) {
    const tr = document.createElement("tr");
    cell(tr, entry.domain, "mono");
    cell(tr, meter(entry.reporters, data.threshold));
    cell(tr, entry.confirmed ? tag("blocked", "yes") : tag("pending", ""));
    cell(tr, when(entry.lastSeen), "mono");
    cell(tr, entry.reasons.join("; "));
    body.appendChild(tr);
  }
  const confirmed = data.entries.filter((e) => e.confirmed).length;
  text("flags-meta", data.entries.length ? `${confirmed} blocked, ${data.entries.length - confirmed} pending, threshold ${data.threshold}` : "");
  text("t-flags", data.entries.length ? String(data.entries.length) : "");
  setEmpty(
    "flags-empty",
    "flags-wrap",
    data.entries.length === 0
      ? `No swarm flags yet. When peers report a domain it appears here with a count of distinct reporters, and it is blocked once ${data.threshold} of them agree. This node has no flags because it has not received any from peers.`
      : null,
  );
}

/* ---- Directory ---- */

function renderDirectory(data: { entries: DirectoryEntry[] }): void {
  const body = el<HTMLTableSectionElement>("directory").querySelector("tbody");
  if (!body) return;
  body.replaceChildren();
  for (const entry of data.entries.slice(0, ROW_LIMIT)) {
    const tr = document.createElement("tr");
    const link = document.createElement("a");
    link.href = entry.url;
    link.target = "_blank";
    link.rel = "noopener";
    link.textContent = entry.url;
    cell(tr, link, "mono");
    cell(tr, entry.network, "mono");
    cell(tr, short(entry.payTo, 6, 4), "mono");
    cell(tr, entry.amount ?? "", "mono");
    cell(tr, tag(entry.origin, entry.origin === "local" ? "manual" : "swarm"));
    cell(tr, when(entry.verifiedAt), "mono");
    body.appendChild(tr);
  }
  text("dir-meta", data.entries.length ? `${data.entries.length} verified endpoints` : "");
  text("t-directory", data.entries.length ? String(data.entries.length) : "");
  setEmpty(
    "dir-empty",
    "dir-wrap",
    data.entries.length === 0 ? "No endpoints yet. Probe a paid URL above and it is added once it answers with a valid 402 for the given wallet; peers share the endpoints they verify, and those land here too." : null,
  );
}

/* ---- Node ---- */

function define(list: HTMLDListElement, rows: [string, string | Node][]): void {
  list.replaceChildren();
  for (const [label, value] of rows) {
    const dt = document.createElement("dt");
    dt.textContent = label;
    const dd = document.createElement("dd");
    if (typeof value === "string") {
      dd.textContent = value;
      dd.className = "mono";
    } else dd.appendChild(value);
    list.append(dt, dd);
  }
}

function lines(values: string[], empty: string): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "mono";
  if (values.length === 0) {
    wrap.textContent = empty;
    wrap.className = "muted";
    return wrap;
  }
  for (const value of values) {
    const line = document.createElement("div");
    line.textContent = value;
    wrap.appendChild(line);
  }
  return wrap;
}

function renderNode(status: Status): void {
  const cfg = status.config;
  const left: [string, string | Node][] = [
    ["Peer id", status.peerId ?? "swarm disabled"],
    ["Listening on", lines(status.listenAddrs ?? [], "no swarm addresses")],
    ["Connected peers", lines(status.connectedPeers ?? [], "none")],
    ["Operator", status.identity ? `${status.identity.address} (${status.identity.publishing ? "publishing" : "receive only"})` : "none configured; this node receives but does not publish"],
  ];
  if (cfg) {
    left.push(
      ["Bootstrap peers", lines(cfg.swarm.bootstrap, "none, waiting for inbound peers or mDNS")],
      ["Swarm", `${cfg.swarm.enabled ? "enabled" : "disabled"}, mDNS ${cfg.swarm.mdns ? "on" : "off"}, min tier ${cfg.membership.minTier}`],
      ["BurnVault", cfg.membership.vault ?? "not set"],
    );
  }
  const right: [string, string | Node][] = [];
  if (cfg) {
    right.push(
      ["DNS listen", `${cfg.dns.listen}:${cfg.dns.port} inside the container`],
      ["Upstreams", lines(cfg.dns.upstream, "none")],
      ["Cache", `${cfg.dns.cacheSize} entries`],
      ["Admin API", `${cfg.admin.listen}:${cfg.admin.port}`],
      ["Extension pull", cfg.extension.url ? `${cfg.extension.url} every ${cfg.extension.pullMinutes} min` : "not configured; the extension pushes instead"],
      ["Flags", `${cfg.flags.threshold} reporters, kept ${cfg.flags.ttlDays} days, re-announced every ${cfg.flags.reannounceMinutes} min`],
    );
    const enc = cfg.encryptedDns;
    if (enc) {
      const parts = [enc.doh.enabled ? `DoH on ${enc.doh.listen}:${enc.doh.port}` : "DoH off", enc.dot.enabled ? `DoT on ${enc.dot.listen}:${enc.dot.port}` : "DoT off"];
      right.push(["Encrypted DNS", `${parts.join(", ")}, ${enc.rateLimitPerMinute} queries per minute per client`]);
    }
  }
  const dns = status.dnsmasq;
  if (dns) {
    right.push(["dnsmasq", dns.running ? `running, pid ${dns.pid ?? "?"}, ${dns.restarts} reloads, ${dns.unexpectedExits ?? 0} unexpected exits` : "not running"]);
    right.push(["Last reload", when(dns.lastReloadAt ?? null)]);
  }
  right.push(["Uptime", duration(status.uptimeSeconds)]);
  if (status.node) right.push(["Version", `${status.node.version} on ${status.node.hostname}`]);
  define(el<HTMLDListElement>("node-left"), left);
  define(el<HTMLDListElement>("node-right"), right);
  text("node-meta", status.node ? status.node.hostname : "");
}

/* ---- Connection and refresh ---- */

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Resolves to null when the node answers 404, which means the feature is off there. */
async function optional<T>(request: Promise<T>): Promise<T | null> {
  try {
    return await request;
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null;
    throw error;
  }
}

async function loadHealth(): Promise<void> {
  try {
    const res = await fetch("/healthz", { cache: "no-store" });
    renderHealth((await res.json()) as Health);
  } catch {
    renderHealth(null);
  }
}

async function refreshAll(): Promise<void> {
  if (!connected) return;
  const refresh = el<HTMLButtonElement>("refresh");
  refresh.disabled = true;
  try {
    const status = await api<Status>("/api/status");
    statsEnabled = status.queryLog?.enabled ?? statsEnabled;
    const [flags, directory, stats, subscriptions] = await Promise.all([
      api<{ threshold: number; entries: FlagEntry[] }>("/api/flags"),
      api<{ entries: DirectoryEntry[] }>("/api/directory"),
      statsEnabled ? optional(api<Stats>("/api/stats")) : Promise.resolve(null),
      listsEnabled ? optional(api<{ entries: SubscriptionInfo[] }>("/api/subscriptions")) : Promise.resolve(null),
    ]);
    await loadHealth();
    renderStatus(status);
    await loadBlocklist();
    renderFlags(flags);
    renderDirectory(directory);
    renderNode(status);
    if (stats === null) statsEnabled = false;
    renderStats(stats);
    if (subscriptions === null) listsEnabled = false;
    renderLists(subscriptions ? subscriptions.entries : null);
    await loadQueries();
    text("foot-left", `refreshed ${new Date().toLocaleTimeString(undefined, { hour12: false })} · auto every 30s`);
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      disconnect("The token was rejected. Enter it again.");
      return;
    }
    toast(describe(error));
  } finally {
    refresh.disabled = false;
  }
}

function setConnected(on: boolean): void {
  connected = on;
  el("connect").hidden = on;
  el("tabs").hidden = !on;
  el<HTMLButtonElement>("refresh").hidden = !on;
  el<HTMLButtonElement>("disconnect").hidden = !on;
  el("conn-text").textContent = on ? "connected" : "offline";
  el("conn").className = on ? "pill on" : "pill";
  for (const panel of document.querySelectorAll<HTMLElement>("[data-panel]")) {
    panel.hidden = !on || panel.dataset["panel"] !== activeTab();
  }
  if (timer !== null) {
    window.clearInterval(timer);
    timer = null;
  }
  if (on) {
    timer = window.setInterval(() => {
      if (!document.hidden) void refreshAll();
    }, REFRESH_MS);
  } else {
    text("foot-left", "not connected");
    for (const id of ["s-blocked", "s-queries", "s-blocked24", "s-flags", "s-ext", "s-swarm", "s-reloads", "s-peer"]) text(id, "—", id === "s-ext" || id === "s-swarm" || id === "s-peer" ? "value small" : "value");
    for (const id of ["s-blocked-sub", "s-queries-sub", "s-blocked24-sub", "s-flags-sub", "s-ext-sub", "s-swarm-sub", "s-reloads-sub"]) text(id, "connect to see");
    el<HTMLButtonElement>("copy-peer").hidden = true;
    for (const id of ["t-blocklist", "t-queries", "t-lists", "t-flags", "t-directory"]) text(id, "");
  }
}

function activeTab(): string {
  return document.querySelector<HTMLElement>(".tab.active")?.dataset["tab"] ?? "queries";
}

function showTab(name: string): void {
  if (!document.querySelector(`.tab[data-tab="${name}"]`)) name = "queries";
  for (const button of document.querySelectorAll<HTMLElement>(".tab")) button.classList.toggle("active", button.dataset["tab"] === name);
  for (const panel of document.querySelectorAll<HTMLElement>("[data-panel]")) panel.hidden = !connected || panel.dataset["panel"] !== name;
  try {
    localStorage.setItem("sinkhole-tab", name);
  } catch {
    /* storage unavailable */
  }
}

async function connect(candidate: string): Promise<void> {
  const errorBox = el("token-error");
  errorBox.textContent = "";
  token = candidate;
  try {
    await api<Status>("/api/status");
  } catch (error) {
    token = "";
    errorBox.textContent = error instanceof ApiError && error.status === 401 ? "That token was rejected. Check ADMIN_TOKEN in the node's .env file." : `Could not reach the node: ${describe(error)}`;
    return;
  }
  storeToken(token);
  setConnected(true);
  await refreshAll();
}

function disconnect(message?: string): void {
  token = "";
  storeToken(null);
  setConnected(false);
  el<HTMLInputElement>("token").value = "";
  el("token-error").textContent = message ?? "";
}

function download(format: string): void {
  fetch(`/api/blocklist/export?format=${encodeURIComponent(format)}`, { headers: { authorization: `Bearer ${token}` } })
    .then((res) => {
      if (!res.ok) throw new Error(`export failed with HTTP ${res.status}`);
      return res.blob();
    })
    .then((blob) => {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `sinkhole-blocklist.${format === "json" ? "json" : "txt"}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    })
    .catch((error: unknown) => toast(describe(error)));
}

function boot(): void {
  text("host", window.location.host);
  el<HTMLFormElement>("token-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const value = el<HTMLInputElement>("token").value.trim();
    if (value) void connect(value);
  });
  el<HTMLButtonElement>("refresh").addEventListener("click", () => void refreshAll());
  el<HTMLButtonElement>("disconnect").addEventListener("click", () => disconnect());
  const debounced = (fn: () => Promise<void>): void => {
    if (filterTimer !== null) window.clearTimeout(filterTimer);
    filterTimer = window.setTimeout(() => {
      filterTimer = null;
      fn().catch((error: unknown) => toast(describe(error)));
    }, 250);
  };
  el<HTMLInputElement>("filter").addEventListener("input", () => debounced(loadBlocklist));
  el<HTMLInputElement>("log-filter").addEventListener("input", () => debounced(loadQueries));
  for (const chip of document.querySelectorAll<HTMLButtonElement>("#log-chips .chip")) {
    chip.addEventListener("click", () => {
      logStatus = chip.dataset["status"] ?? "";
      for (const other of document.querySelectorAll<HTMLButtonElement>("#log-chips .chip")) other.classList.toggle("active", other === chip);
      loadQueries().catch((error: unknown) => toast(describe(error)));
    });
  }
  el<HTMLFormElement>("list-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const input = el<HTMLInputElement>("list-url");
    const url = input.value.trim();
    if (!url) return;
    const button = el<HTMLFormElement>("list-form").querySelector("button");
    if (button) button.disabled = true;
    toast("Fetching the list...", "good");
    api<{ added: boolean; entry: SubscriptionInfo; refresh?: { ok: boolean; entries: number; error: string | null } }>("/api/subscriptions", { method: "POST", body: { url } })
      .then((result) => {
        input.value = "";
        if (!result.added) toast("That list is already subscribed", "good");
        else if (result.refresh?.ok) toast(`Subscribed: ${result.refresh.entries} names`, "good");
        else toast(`Subscribed, but the first fetch failed: ${result.refresh?.error ?? "unknown error"}`);
        return refreshAll();
      })
      .catch((error: unknown) => toast(describe(error)))
      .finally(() => {
        if (button) button.disabled = false;
      });
  });
  for (const button of document.querySelectorAll<HTMLElement>(".tab")) {
    button.addEventListener("click", () => showTab(button.dataset["tab"] ?? "queries"));
  }
  for (const button of document.querySelectorAll<HTMLButtonElement>("button[data-format]")) {
    button.addEventListener("click", () => download(button.dataset["format"] ?? "plain"));
  }
  el<HTMLFormElement>("manual-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const domainInput = el<HTMLInputElement>("manual-domain");
    const reasonInput = el<HTMLInputElement>("manual-reason");
    const domain = domainInput.value.trim();
    const reason = reasonInput.value.trim() || "manual";
    if (!domain) return;
    api<{ domain: string; added: boolean }>("/api/blocklist/manual", { method: "POST", body: { domain, reason } })
      .then((result) => {
        domainInput.value = "";
        reasonInput.value = "";
        toast(result.added ? `${result.domain} is now blocked` : `${result.domain} was already on the list`, "good");
        return refreshAll();
      })
      .catch((error: unknown) => toast(describe(error)));
  });
  el<HTMLFormElement>("dir-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const body: Record<string, string> = { url: el<HTMLInputElement>("dir-url").value.trim(), payTo: el<HTMLInputElement>("dir-payto").value.trim() };
    const network = el<HTMLInputElement>("dir-network").value.trim();
    const asset = el<HTMLInputElement>("dir-asset").value.trim();
    if (network) body["network"] = network;
    if (asset) body["asset"] = asset;
    toast("Probing the endpoint...", "good");
    api("/api/directory", { method: "POST", body })
      .then(() => {
        toast("Endpoint verified and added", "good");
        return refreshAll();
      })
      .catch((error: unknown) => toast(describe(error)));
  });

  let remembered = "queries";
  try {
    remembered = localStorage.getItem("sinkhole-tab") ?? "queries";
  } catch {
    /* storage unavailable */
  }
  showTab(remembered);
  setConnected(false);
  void loadHealth();
  const saved = readToken();
  if (saved) void connect(saved);
}

boot();

export {};
