import type { Blocklist, Confirmation } from "./blocklist.js";
import { CATEGORIES, type Category } from "./category.js";
import type { RefreshEvent, SubscriptionInfo } from "./subscriptions.js";

/**
 * The radar: what the network learned lately, built only from swarm confirmations and list refreshes.
 * Nothing here comes from queries, so a node with query logging off serves the same radar as one with it on.
 */

export interface RadarList {
  url: string;
  label: string;
  category: Category;
  entries: number;
  lastSuccessAt: number | null;
  /** Refreshes inside the window that changed the list. */
  refreshes: number;
  added: number;
  removed: number;
  /** Names gained in the latest refresh inside the window, a few of them. */
  sample: string[];
}

export interface RadarBrand {
  brand: string;
  count: number;
  sample: string[];
}

export interface RadarSnapshot {
  generatedAt: number;
  windowHours: number;
  swarm: { confirmed: number; confirmedWeek: number; pending: number; recent: Confirmation[] };
  lists: RadarList[];
  /** New names inside the window by category: swarm confirmations plus list growth. */
  categories: Record<Category, number>;
  brands: RadarBrand[];
  totals: { listNames: number; lists: number };
}

export interface RadarSource {
  blocklist: Pick<Blocklist, "recentConfirmations" | "flagSummaries">;
  lists: { list(): SubscriptionInfo[]; historyOf(id: string): RefreshEvent[]; domains(): Set<string> };
  clock?: (() => number) | undefined;
}

interface Brand {
  brand: string;
  /** Matched anywhere inside a label; long enough not to hit by accident. */
  keys: readonly string[];
  /** Matched only as a whole token between hyphens, digits, or dots. */
  exact?: readonly string[];
}

const BRANDS: readonly Brand[] = [
  { brand: "MetaMask", keys: ["metamask"] },
  { brand: "Coinbase", keys: ["coinbase"] },
  { brand: "Ledger", keys: ["ledger"] },
  { brand: "Trezor", keys: ["trezor"] },
  { brand: "Trust Wallet", keys: ["trustwallet"], exact: ["trust"] },
  { brand: "Phantom", keys: ["phantom"] },
  { brand: "Uniswap", keys: ["uniswap"] },
  { brand: "OpenSea", keys: ["opensea"] },
  { brand: "Binance", keys: ["binance"] },
  { brand: "Kraken", keys: ["kraken"] },
  { brand: "Bybit", keys: ["bybit"] },
  { brand: "OKX", keys: [], exact: ["okx"] },
  { brand: "KuCoin", keys: ["kucoin"] },
  { brand: "Robinhood", keys: ["robinhood"] },
  { brand: "PancakeSwap", keys: ["pancakeswap"] },
  { brand: "Lido", keys: [], exact: ["lido"] },
  { brand: "Aave", keys: [], exact: ["aave"] },
  { brand: "Arbitrum", keys: ["arbitrum"] },
  { brand: "Optimism", keys: ["optimism"] },
  { brand: "Polygon", keys: ["polygon"] },
  { brand: "Solana", keys: ["solana"] },
  { brand: "Ethereum", keys: ["ethereum"] },
  { brand: "Tether", keys: ["tether"], exact: ["usdt"] },
  { brand: "Circle", keys: [], exact: ["usdc"] },
  { brand: "PayPal", keys: ["paypal"] },
  { brand: "Apple", keys: ["appleid", "icloud"], exact: ["apple"] },
  { brand: "Google", keys: [], exact: ["google", "gmail"] },
  { brand: "Microsoft", keys: ["microsoft", "office365", "outlook"] },
  { brand: "Amazon", keys: ["amazon"] },
  { brand: "Netflix", keys: ["netflix"] },
  { brand: "Meta", keys: ["facebook", "instagram", "whatsapp"] },
  { brand: "Telegram", keys: ["telegram"] },
  { brand: "DHL", keys: [], exact: ["dhl"] },
  { brand: "USPS", keys: [], exact: ["usps"] },
  { brand: "FedEx", keys: ["fedex"] },
  { brand: "Chase", keys: [], exact: ["chase"] },
  { brand: "Wells Fargo", keys: ["wellsfargo"] },
  { brand: "Bank of America", keys: ["bankofamerica"] },
  { brand: "HSBC", keys: [], exact: ["hsbc"] },
];

/** Second-level labels that act as part of the public suffix under a country code, such as co.uk. */
const SECOND_LEVEL = new Set(["co", "com", "net", "org", "gov", "edu", "ac"]);

/** The labels that can impersonate something: everything but the public suffix and the registrable label itself. */
function labelsOf(name: string): { registrable: string | null; labels: string[] } {
  const labels = name.toLowerCase().split(".").filter((label) => label.length > 0);
  if (labels.length < 2) return { registrable: null, labels: [] };
  const tld = labels[labels.length - 1] ?? "";
  const second = labels[labels.length - 2] ?? "";
  const suffixLength = tld.length === 2 && SECOND_LEVEL.has(second) && labels.length >= 3 ? 2 : 1;
  const registrable = labels[labels.length - suffixLength - 1] ?? null;
  return { registrable, labels: labels.slice(0, labels.length - suffixLength) };
}

/** The brands a hostname trades on. The brand's own registrable name does not count: metamask.io is MetaMask, metamask-claim.io is not. */
export function brandsOf(name: string): string[] {
  const { registrable, labels } = labelsOf(name);
  if (labels.length === 0) return [];
  const out: string[] = [];
  for (const brand of BRANDS) {
    let hit = false;
    for (const label of labels) {
      const tokens = label.split(/[^a-z]+/).filter((token) => token.length > 0);
      const own = label === registrable && (tokens.length === 1 || brand.keys.includes(label));
      if (own) continue;
      if (brand.keys.some((key) => label.includes(key))) hit = true;
      if (brand.exact?.some((key) => tokens.includes(key))) hit = true;
      if (hit) break;
    }
    if (hit) out.push(brand.brand);
  }
  return out;
}

/** Brands impersonated across `names`, most often first, with a few examples each. */
export function impersonatedBrands(names: Iterable<string>, sampleSize = 3): RadarBrand[] {
  const counts = new Map<string, RadarBrand>();
  for (const name of names) {
    for (const brand of brandsOf(name)) {
      const entry = counts.get(brand) ?? { brand, count: 0, sample: [] };
      entry.count += 1;
      if (entry.sample.length < sampleSize) entry.sample.push(name);
      counts.set(brand, entry);
    }
  }
  return [...counts.values()].sort((a, b) => b.count - a.count || a.brand.localeCompare(b.brand));
}

/** A short name for a list URL: owner/repo for GitHub raw files, the host otherwise. */
export function labelFor(url: string): string {
  try {
    const parsed = new URL(url);
    const parts = parsed.pathname.split("/").filter((part) => part.length > 0);
    if (parsed.hostname === "raw.githubusercontent.com" && parts.length >= 2) return `${parts[0]}/${parts[1]}`;
    return parsed.hostname;
  } catch {
    return url;
  }
}

export function buildRadar(source: RadarSource, windowHours = 24): RadarSnapshot {
  const now = (source.clock ?? Date.now)();
  const since = now - windowHours * 3_600_000;
  const week = now - 7 * 24 * 3_600_000;
  const recentWeek = source.blocklist.recentConfirmations(week);
  const recent = recentWeek.filter((entry) => entry.at >= since);
  const pending = source.blocklist.flagSummaries(now).filter((summary) => !summary.confirmed).length;
  const categories = Object.fromEntries(CATEGORIES.map((category) => [category, 0])) as Record<Category, number>;
  const names: string[] = [];
  for (const entry of recent) {
    categories[entry.category] += 1;
    names.push(entry.domain);
  }
  const lists: RadarList[] = [];
  for (const item of source.lists.list()) {
    const events = source.lists.historyOf(item.id).filter((event) => event.at >= since);
    let added = 0;
    let removed = 0;
    let sample: string[] = [];
    for (const event of events) {
      added += event.added;
      removed += event.removed;
      names.push(...event.names);
      if (event.names.length > 0) sample = event.names.slice(0, 10);
    }
    categories[item.category] += added;
    lists.push({ url: item.url, label: labelFor(item.url), category: item.category, entries: item.entries, lastSuccessAt: item.lastSuccessAt, refreshes: events.length, added, removed, sample });
  }
  return {
    generatedAt: now,
    windowHours,
    swarm: { confirmed: recent.length, confirmedWeek: recentWeek.length, pending, recent: recent.slice(0, 20) },
    lists,
    categories,
    brands: impersonatedBrands(names).slice(0, 15),
    totals: { listNames: source.lists.domains().size, lists: lists.length },
  };
}

/** Rebuilds a value at most once per `ttlMs`; the radar is asked for far more often than it changes. */
export function memoize<T>(build: () => T, ttlMs: number, clock: () => number = Date.now): () => T {
  let value: T | null = null;
  let builtAt = 0;
  return () => {
    const now = clock();
    if (value === null || now - builtAt >= ttlMs) {
      value = build();
      builtAt = now;
    }
    return value;
  };
}
