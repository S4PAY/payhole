const EXPLORER = "https://robinhoodchain.blockscout.com";

interface Offer {
  amount: string;
  payTo: string;
  network: string;
  asset: string;
}
interface PaymentRequired402 {
  accepts?: Offer[];
}
interface Settlement {
  success: boolean;
  transaction?: string;
  payer?: string;
  errorReason?: string;
  errorMessage?: string;
}
interface Article {
  title: string;
  paragraphs: string[];
  paid?: { transaction?: string; payer?: string; price?: string };
}

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`missing #${id}`);
  return node as T;
}

const load = el<HTMLButtonElement>("load");
const state = el("state");
const offer = el("offer");
const offerRows = el("offer-rows");
const offerNote = el("offer-note");
const article = el("article");
const articleTitle = el("a-title");
const articleBody = el("a-body");
const paid = el("paid");

function decode<T>(header: string | null): T | null {
  if (!header) return null;
  try {
    const bytes = Uint8Array.from(atob(header), (c) => c.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes)) as T;
  } catch {
    return null;
  }
}

function usdg(base: string): string {
  const n = Number(base) / 1e6;
  return `${n.toFixed(n < 0.01 ? 4 : 2)} USDG`;
}

function short(value: string): string {
  return value.length > 14 ? `${value.slice(0, 6)}…${value.slice(-4)}` : value;
}

function show(node: HTMLElement, on: boolean): void {
  node.classList.toggle("ph-hidden", !on);
}

function row(label: string, value: string, href?: string): HTMLElement {
  const line = document.createElement("div");
  line.style.cssText = "display:flex;justify-content:space-between;gap:16px;flex-wrap:wrap";
  const k = document.createElement("span");
  k.style.color = "var(--muted)";
  k.textContent = label;
  const v = href ? document.createElement("a") : document.createElement("span");
  if (v instanceof HTMLAnchorElement) {
    v.href = href ?? "";
    v.target = "_blank";
    v.rel = "noopener";
    v.style.color = "var(--accent-text)";
  }
  v.textContent = value;
  line.append(k, v);
  return line;
}

function render402(o: Offer | undefined, settlement: Settlement | null): void {
  offerRows.replaceChildren();
  if (o) {
    offerRows.append(row("price", usdg(o.amount)), row("pay to", short(o.payTo), `${EXPLORER}/address/${o.payTo}`), row("network", o.network), row("asset", `USDG ${short(o.asset)}`));
  }
  offerNote.textContent =
    settlement && !settlement.success
      ? `The payment was sent but not accepted: ${settlement.errorMessage ?? settlement.errorReason ?? "rejected"}. Nothing was charged.`
      : "This is the response every browser gets. PayHole reads that header, pays, and asks again. Install the extension, fund a pocket, and click the button once more.";
  show(article, false);
  show(offer, true);
}

function renderArticle(data: Article, settlement: Settlement | null): void {
  articleTitle.textContent = data.title;
  articleBody.replaceChildren(
    ...data.paragraphs.map((text) => {
      const p = document.createElement("p");
      p.style.margin = "0";
      p.textContent = text;
      return p;
    }),
  );
  paid.replaceChildren();
  const tx = settlement?.transaction ?? data.paid?.transaction;
  const payer = settlement?.payer ?? data.paid?.payer;
  paid.append(row("paid", data.paid?.price ?? "0.01 USDG"));
  if (payer) paid.append(row("from your address for this site", short(payer), `${EXPLORER}/address/${payer}`));
  if (tx) paid.append(row("settlement", short(tx), `${EXPLORER}/tx/${tx}`));
  show(offer, false);
  show(article, true);
}

async function run(): Promise<void> {
  load.disabled = true;
  state.textContent = "Requesting the article…";
  try {
    const res = await fetch("/api/demo/article", { cache: "no-store", headers: { accept: "application/json" } });
    const settlement = decode<Settlement>(res.headers.get("payment-response"));
    if (res.status === 402) {
      const required = decode<PaymentRequired402>(res.headers.get("payment-required"));
      render402(required?.accepts?.[0], settlement);
      state.textContent = settlement && !settlement.success ? "Payment rejected. Nothing was charged." : "402 Payment Required. Nothing was paid.";
      return;
    }
    if (!res.ok) {
      state.textContent = `The server answered ${res.status}. Nothing was charged.`;
      return;
    }
    const data = (await res.json()) as Article;
    renderArticle(data, settlement);
    state.textContent = `Paid ${data.paid?.price ?? "0.01 USDG"}. Click again and it pays again.`;
  } catch (error) {
    state.textContent = `Request failed: ${error instanceof Error ? error.message : String(error)}`;
  } finally {
    load.disabled = false;
  }
}

load.addEventListener("click", () => void run());
