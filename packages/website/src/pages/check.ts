// The Check page: one name, one verdict from the public resolver, in words a person can act on.

const VERDICT_URL = "https://dns.payhole.org/verdict";

interface Verdict {
  domain: string;
  blocked: boolean;
  allowlisted: boolean;
  category: string | null;
  sources: string[];
  reasons: string[];
  reporters: number;
  confirmed: boolean;
  checkedAt: number;
}

const LABELS: Record<string, string> = {
  infra: "drainer infrastructure",
  drainer: "wallet drainer",
  phishing: "phishing",
  counterfeit: "counterfeit token",
  tracker: "tracker",
  ad: "ad",
  other: "blocked",
};
const PHRASES: Record<string, string> = {
  infra: "drainer infrastructure",
  drainer: "a wallet drainer",
  phishing: "a phishing page",
  counterfeit: "a counterfeit token site",
  tracker: "a tracker",
  ad: "an ad server",
  other: "blocked",
};
const DANGEROUS = new Set(["infra", "drainer", "phishing", "counterfeit"]);
const SOURCES: Record<string, string> = {
  swarm: "confirmed by the swarm",
  list: "on a subscribed list",
  manual: "blocked by an operator",
  local: "flagged by the extension",
};
const HOST = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,62}$/;

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`missing #${id}`);
  return node as T;
}

/** The hostname meant by a pasted link, domain, or message; null when nothing in it looks like one. */
export function extractName(input: string): string | null {
  for (const token of input.trim().split(/[\s<>"'()[\]{}]+/)) {
    if (token.length === 0) continue;
    const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(token) ? token : /^[a-z0-9.-]+\.[a-z][a-z0-9-]*(?::\d+)?(?:[/?#]|$)/i.test(token) ? `https://${token}` : null;
    if (withScheme === null) continue;
    let host: string;
    try {
      host = new URL(withScheme).hostname;
    } catch {
      continue;
    }
    host = host.toLowerCase().replace(/\.$/, "");
    if (!host.startsWith("[") && HOST.test(host)) return host;
  }
  return null;
}

function describe(v: Verdict): string {
  if (v.allowlisted) return `${v.domain} is on PayHole's allowlist: a shared platform that stays reachable even when a list names it.`;
  if (!v.blocked) return `${v.domain} is not on any PayHole list and the swarm has not confirmed it. That is what the network knows today, not a promise.`;
  const what = v.category ? (PHRASES[v.category] ?? v.category) : "blocked";
  const by = v.sources.includes("swarm")
    ? `confirmed by ${v.reporters} node${v.reporters === 1 ? "" : "s"} in the swarm`
    : v.sources.includes("list")
      ? "on a subscribed list"
      : v.sources.includes("manual")
        ? "blocked by an operator"
        : "flagged by the extension";
  return `${v.domain} is ${what}, ${by}. Phones and browsers running PayHole never load it.`;
}

function render(v: Verdict): void {
  const card = el("verdict");
  card.classList.remove("ph-hidden");
  const status = el("v-status");
  status.textContent = v.blocked ? "Blocked" : v.allowlisted ? "Allowlisted" : "Not blocked";
  status.style.color = v.blocked ? "#FF7A7A" : "var(--accent-text)";
  el("v-domain").textContent = v.domain;
  const cat = el("v-category");
  if (v.blocked) {
    cat.textContent = v.category ? (LABELS[v.category] ?? v.category) : "blocked";
    cat.style.display = "inline-flex";
    const danger = v.category !== null && DANGEROUS.has(v.category);
    cat.style.color = danger ? "#FF7A7A" : "var(--muted)";
    cat.style.borderColor = danger ? "rgba(255,77,77,.55)" : "var(--border)";
  } else {
    cat.style.display = "none";
  }
  el("v-text").textContent = describe(v);
  const sources = v.sources.map((s) => SOURCES[s] ?? s);
  if (v.reporters > 0) sources.push(`${v.reporters} reporter${v.reporters === 1 ? "" : "s"}`);
  el("v-sources").textContent = sources.join(" · ");
  el("v-reasons").textContent = v.reasons.join("; ");
  const share = el<HTMLAnchorElement>("v-share");
  const text = `${describe(v)}\n\nChecked with PayHole: https://payhole.org/check.html?name=${encodeURIComponent(v.domain)}`;
  share.href = `https://x.com/intent/post?text=${encodeURIComponent(text)}`;
  el<HTMLButtonElement>("v-copy").onclick = () => {
    void navigator.clipboard.writeText(text).then(() => {
      el("state").textContent = "Copied.";
    });
  };
  history.replaceState(null, "", `?name=${encodeURIComponent(v.domain)}`);
}

async function check(raw: string): Promise<void> {
  const state = el("state");
  const name = extractName(raw);
  el("verdict").classList.add("ph-hidden");
  if (name === null) {
    state.textContent = "Nothing in that looks like a web address. Paste a link or a domain name.";
    return;
  }
  state.textContent = `Asking the resolver about ${name}.`;
  try {
    const response = await fetch(`${VERDICT_URL}?name=${encodeURIComponent(name)}`, { headers: { accept: "application/json" } });
    if (response.status === 429) throw new Error("The resolver is rate limiting this connection. Try again in a minute.");
    if (!response.ok) throw new Error(`The resolver refused the name (${response.status}).`);
    const v = (await response.json()) as Verdict;
    state.textContent = `Checked ${new Date(v.checkedAt).toLocaleTimeString(undefined, { hour12: false })}.`;
    render(v);
  } catch (error) {
    state.textContent = error instanceof Error ? error.message : String(error);
  }
}

const input = el<HTMLInputElement>("name");
const button = el<HTMLButtonElement>("check");
button.addEventListener("click", () => void check(input.value));
input.addEventListener("keydown", (event) => {
  if (event.key === "Enter") void check(input.value);
});
const preset = new URLSearchParams(location.search).get("name");
if (preset) {
  input.value = preset;
  void check(preset);
}
