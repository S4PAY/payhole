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
  merged: number;
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
  node?: { hostname: string; version: string; startedAt: number };
  config?: {
    dns: { listen: string; port: number; upstream: string[]; cacheSize: number };
    admin: { listen: string; port: number };
    swarm: { enabled: boolean; listen: string[]; bootstrap: string[]; mdns: boolean };
    membership: { minTier: number; vault: string | null };
    extension: { url: string | null; pullMinutes: number };
    flags: { threshold: number; ttlDays: number; reannounceMinutes: number };
  };
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
  text("s-blocked", String(c.merged), "value");
  text("s-blocked-sub", `${c.local} from the extension, ${c.manual} manual, ${c.swarmConfirmed} from the swarm`);
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

function renderBlocklist(): void {
  const filter = el<HTMLInputElement>("filter").value.trim().toLowerCase();
  const body = el<HTMLTableSectionElement>("blocklist").querySelector("tbody");
  if (!body) return;
  body.replaceChildren();
  let shown = 0;
  let matched = 0;
  for (const entry of entries) {
    if (filter && !entry.domain.includes(filter) && !entry.reason.toLowerCase().includes(filter)) continue;
    matched += 1;
    if (shown >= ROW_LIMIT) continue;
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
  const meta = entries.length === 0 ? "" : filter ? `${matched} of ${entries.length} match${shown < matched ? `, showing ${shown}` : ""}` : `${entries.length} domains${shown < entries.length ? `, showing ${shown}` : ""}`;
  text("bl-meta", meta);
  text("t-blocklist", entries.length ? String(entries.length) : "");
  if (entries.length === 0) {
    setEmpty("bl-empty", "bl-wrap", "Nothing is blocked yet. Domains arrive here from the extension's blocklist sync, from swarm flags once enough peers agree, or from the form above. The resolver answers everything normally until then.");
  } else if (matched === 0) {
    setEmpty("bl-empty", "bl-wrap", `No domain matches "${filter}".`);
  } else {
    setEmpty("bl-empty", "bl-wrap", null);
  }
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
    const [status, blocklist, flags, directory] = await Promise.all([
      api<Status>("/api/status"),
      api<{ entries: BlockEntry[] }>("/api/blocklist"),
      api<{ threshold: number; entries: FlagEntry[] }>("/api/flags"),
      api<{ entries: DirectoryEntry[] }>("/api/directory"),
    ]);
    await loadHealth();
    renderStatus(status);
    entries = blocklist.entries;
    renderBlocklist();
    renderFlags(flags);
    renderDirectory(directory);
    renderNode(status);
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
    for (const id of ["s-blocked", "s-flags", "s-ext", "s-swarm", "s-reloads", "s-peer"]) text(id, "—", id === "s-ext" || id === "s-swarm" || id === "s-peer" ? "value small" : "value");
    for (const id of ["s-blocked-sub", "s-flags-sub", "s-ext-sub", "s-swarm-sub", "s-reloads-sub"]) text(id, "connect to see");
    el<HTMLButtonElement>("copy-peer").hidden = true;
    for (const id of ["t-blocklist", "t-flags", "t-directory"]) text(id, "");
  }
}

function activeTab(): string {
  return document.querySelector<HTMLElement>(".tab.active")?.dataset["tab"] ?? "blocklist";
}

function showTab(name: string): void {
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
  el<HTMLInputElement>("filter").addEventListener("input", renderBlocklist);
  for (const button of document.querySelectorAll<HTMLElement>(".tab")) {
    button.addEventListener("click", () => showTab(button.dataset["tab"] ?? "blocklist"));
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

  let remembered = "blocklist";
  try {
    remembered = localStorage.getItem("sinkhole-tab") ?? "blocklist";
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
