// The radar page: what the network learned lately, from the public resolver's /radar endpoint.

const RADAR_URL = "https://dns.payhole.org/radar";

interface Confirmation {
  domain: string;
  category: string;
  reporters: number;
  at: number;
}
interface RadarList {
  url: string;
  label: string;
  category: string;
  entries: number;
  lastSuccessAt: number | null;
  refreshes: number;
  added: number;
  removed: number;
  sample: string[];
}
interface Radar {
  generatedAt: number;
  windowHours: number;
  swarm: { confirmed: number; confirmedWeek: number; pending: number; recent: Confirmation[] };
  lists: RadarList[];
  categories: Record<string, number>;
  brands: { brand: string; count: number; sample: string[] }[];
  totals: { listNames: number; lists: number };
}

const LABELS: Record<string, string> = { infra: "drainer infrastructure", drainer: "wallet drainer", phishing: "phishing", counterfeit: "counterfeit token", tracker: "tracker", ad: "ad", other: "other" };
const DANGEROUS = new Set(["infra", "drainer", "phishing", "counterfeit"]);
const ORDER = ["infra", "drainer", "phishing", "counterfeit", "tracker", "ad", "other"];
const LIST_NAMES: Record<string, string> = { "scamsniffer/scam-database": "ScamSniffer scam database", "Phishing-Database/Phishing.Database": "Phishing.Database active domains", "StevenBlack/hosts": "StevenBlack unified hosts" };

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`missing #${id}`);
  return node as T;
}

function make(tag: string, text: string, style = ""): HTMLElement {
  const node = document.createElement(tag);
  node.textContent = text;
  if (style) node.setAttribute("style", style);
  return node;
}

function commas(value: number): string {
  return String(Math.round(value)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function ago(at: number, now = Date.now()): string {
  const minutes = Math.max(0, Math.round((now - at) / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  return hours < 24 ? `${hours} h ago` : `${Math.round(hours / 24)} d ago`;
}

function pill(category: string): HTMLElement {
  const danger = DANGEROUS.has(category);
  return make("span", (LABELS[category] ?? category).toUpperCase(), `display:inline-flex;align-items:center;padding:3px 10px;border-radius:999px;border:1px solid ${danger ? "rgba(255,77,77,.55)" : "var(--border)"};font:500 11px 'JetBrains Mono';letter-spacing:.08em;color:${danger ? "#FF7A7A" : "var(--muted)"}`);
}

function describeList(list: RadarList, hours: number): string {
  if (list.refreshes === 0) return `No change in the last ${hours} hours${list.lastSuccessAt ? `, last checked ${ago(list.lastSuccessAt)}` : ""}.`;
  const parts: string[] = [];
  if (list.added > 0) parts.push(`${commas(list.added)} added`);
  if (list.removed > 0) parts.push(`${commas(list.removed)} removed`);
  return `${parts.join(", ") || "Reordered"} in the last ${hours} hours over ${list.refreshes === 1 ? "one refresh" : `${list.refreshes} refreshes`}.`;
}

function render(radar: Radar): void {
  const hours = radar.windowHours;
  el("confirmed").textContent = commas(radar.swarm.confirmed);
  el("week").textContent = commas(radar.swarm.confirmedWeek);
  el("pending").textContent = commas(radar.swarm.pending);
  el("names").textContent = commas(radar.totals.listNames);

  const recent = el("recent");
  recent.replaceChildren();
  if (radar.swarm.recent.length === 0) {
    recent.append(make("div", `No new confirmations in the last ${hours} hours. Names arrive here the moment enough tier holders agree on one.`, "font:400 14px/1.6 Inter;color:var(--muted)"));
  }
  for (const entry of radar.swarm.recent) {
    const row = make("div", "", "display:flex;flex-direction:column;gap:6px;padding:10px 0;border-bottom:1px solid var(--border)");
    const head = make("div", "", "display:flex;justify-content:space-between;gap:12px;align-items:baseline");
    head.append(make("span", entry.domain, "font:500 14px 'JetBrains Mono';overflow-wrap:anywhere"), make("span", ago(entry.at), "font:400 12px 'JetBrains Mono';color:var(--muted);white-space:nowrap"));
    const meta = make("div", "", "display:flex;gap:10px;align-items:center");
    meta.append(pill(entry.category), make("span", `${entry.reporters} reporter${entry.reporters === 1 ? "" : "s"}`, "font:400 12px 'JetBrains Mono';color:var(--muted)"));
    row.append(head, meta);
    recent.append(row);
  }

  const brands = el("brands");
  brands.replaceChildren();
  const max = radar.brands.reduce((top, brand) => Math.max(top, brand.count), 0);
  if (radar.brands.length === 0) brands.append(make("div", `None of the names that arrived in the last ${hours} hours trade on a brand PayHole knows.`, "font:400 14px/1.6 Inter;color:var(--muted)"));
  for (const brand of radar.brands) {
    const row = make("div", "", "display:flex;flex-direction:column;gap:6px;padding:8px 0");
    const head = make("div", "", "display:flex;justify-content:space-between;gap:12px;align-items:baseline");
    head.append(make("span", brand.brand, "font:500 15px Inter"), make("span", commas(brand.count), "font:500 13px 'JetBrains Mono'"));
    const track = make("div", "", "height:6px;border-radius:3px;background:rgba(255,255,255,.06);overflow:hidden");
    track.append(make("div", "", `height:6px;border-radius:3px;background:var(--accent);width:${Math.max(4, Math.round((brand.count / max) * 100))}%`));
    row.append(head, track);
    if (brand.sample.length > 0) row.append(make("div", brand.sample.join("  "), "font:400 12px 'JetBrains Mono';color:var(--muted);overflow-wrap:anywhere"));
    brands.append(row);
  }

  const kinds = el("kinds");
  kinds.replaceChildren();
  for (const category of ORDER) {
    const count = radar.categories[category] ?? 0;
    if (count > 0) kinds.append(make("span", `${commas(count)} ${LABELS[category] ?? category}`, "padding:5px 12px;border-radius:999px;border:1px solid var(--border);font:500 12px 'JetBrains Mono'"));
  }
  el("kinds-card").style.display = kinds.childElementCount === 0 ? "none" : "flex";

  const lists = el("lists");
  lists.replaceChildren();
  for (const list of radar.lists) {
    const card = make("div", "", "display:flex;flex-direction:column;gap:6px;padding:12px 0;border-bottom:1px solid var(--border)");
    card.append(make("div", LIST_NAMES[list.label] ?? list.label, "font:600 17px 'Space Grotesk';letter-spacing:-0.02em"), make("div", `${commas(list.entries)} names. ${describeList(list, hours)}`, "font:400 14px/1.6 Inter;color:var(--muted)"));
    if (list.sample.length > 0) card.append(make("div", list.sample.slice(0, 6).join("  "), "font:400 12px/1.7 'JetBrains Mono';color:var(--muted);overflow-wrap:anywhere"));
    lists.append(card);
  }
  el("state").textContent = `Snapshot ${ago(radar.generatedAt)}. The resolver rebuilds it once a minute.`;
  el("radar").style.display = "flex";
}

async function load(): Promise<void> {
  const state = el("state");
  state.textContent = "Asking the resolver.";
  try {
    const response = await fetch(RADAR_URL, { headers: { accept: "application/json" } });
    if (response.status === 429) throw new Error("The resolver is rate limiting this connection. Try again in a minute.");
    if (!response.ok) throw new Error(`The resolver refused the request (${response.status}).`);
    render((await response.json()) as Radar);
  } catch (error) {
    state.textContent = error instanceof Error ? error.message : String(error);
  }
}

el<HTMLButtonElement>("refresh").addEventListener("click", () => void load());
void load();

export {};
