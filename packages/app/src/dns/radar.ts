// The radar: what the network learned lately, read from the resolver's public /radar endpoint.
// Built by the node from swarm confirmations and list refreshes only, never from what phones looked up.

import { isCategory, type Category } from "./verdict";

export interface RadarConfirmation {
  domain: string;
  category: Category;
  reporters: number;
  at: number;
}

export interface RadarList {
  url: string;
  label: string;
  category: Category | null;
  entries: number;
  lastSuccessAt: number | null;
  refreshes: number;
  added: number;
  removed: number;
  sample: string[];
}

export interface RadarBrand {
  brand: string;
  count: number;
  sample: string[];
}

export interface Radar {
  generatedAt: number;
  windowHours: number;
  swarm: { confirmed: number; confirmedWeek: number; pending: number; recent: RadarConfirmation[] };
  lists: RadarList[];
  categories: Partial<Record<Category, number>>;
  brands: RadarBrand[];
  totals: { listNames: number; lists: number };
}

export class RadarError extends Error {}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function num(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

/** A radar snapshot from the resolver's JSON, tolerant of fields a newer node may add. */
export function parseRadar(value: unknown): Radar {
  const root = record(value);
  const swarm = record(root?.["swarm"]);
  const totals = record(root?.["totals"]);
  if (!root || !swarm || !totals || !Array.isArray(root["lists"]) || !Array.isArray(root["brands"])) throw new RadarError("The resolver's answer was not a radar.");
  const recent: RadarConfirmation[] = [];
  for (const item of Array.isArray(swarm["recent"]) ? swarm["recent"] : []) {
    const entry = record(item);
    if (entry && typeof entry["domain"] === "string") {
      recent.push({ domain: entry["domain"], category: isCategory(entry["category"]) ? entry["category"] : "other", reporters: num(entry["reporters"]), at: num(entry["at"]) });
    }
  }
  const lists: RadarList[] = [];
  for (const item of root["lists"]) {
    const entry = record(item);
    if (!entry || typeof entry["url"] !== "string") continue;
    lists.push({
      url: entry["url"],
      label: typeof entry["label"] === "string" ? entry["label"] : entry["url"],
      category: isCategory(entry["category"]) ? entry["category"] : null,
      entries: num(entry["entries"]),
      lastSuccessAt: typeof entry["lastSuccessAt"] === "number" ? entry["lastSuccessAt"] : null,
      refreshes: num(entry["refreshes"]),
      added: num(entry["added"]),
      removed: num(entry["removed"]),
      sample: strings(entry["sample"]),
    });
  }
  const brands: RadarBrand[] = [];
  for (const item of root["brands"]) {
    const entry = record(item);
    if (entry && typeof entry["brand"] === "string") brands.push({ brand: entry["brand"], count: num(entry["count"]), sample: strings(entry["sample"]) });
  }
  const categories: Partial<Record<Category, number>> = {};
  for (const [key, count] of Object.entries(record(root["categories"]) ?? {})) if (isCategory(key) && num(count) > 0) categories[key] = num(count);
  return {
    generatedAt: num(root["generatedAt"], Date.now()),
    windowHours: num(root["windowHours"], 24),
    swarm: { confirmed: num(swarm["confirmed"]), confirmedWeek: num(swarm["confirmedWeek"]), pending: num(swarm["pending"]), recent },
    lists,
    categories,
    brands,
    totals: { listNames: num(totals["listNames"]), lists: num(totals["lists"]) },
  };
}

export async function fetchRadar(url: string, fetchImpl: typeof fetch = fetch): Promise<Radar> {
  const response = await fetchImpl(url, { headers: { accept: "application/json" } });
  if (response.status === 429) throw new RadarError("The resolver is rate limiting this connection. Try again in a minute.");
  if (!response.ok) throw new RadarError(`The resolver refused the request (${response.status}).`);
  return parseRadar(await response.json());
}

/** 12345 as 12,345 without relying on the platform's locale tables. */
export function withCommas(value: number): string {
  return String(Math.round(value)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** One sentence on how a list moved inside the window. */
export function describeList(list: RadarList, windowHours = 24): string {
  if (list.refreshes === 0) return `No change in the last ${windowHours} hours.`;
  const parts: string[] = [];
  if (list.added > 0) parts.push(`${withCommas(list.added)} added`);
  if (list.removed > 0) parts.push(`${withCommas(list.removed)} removed`);
  const refreshes = list.refreshes === 1 ? "one refresh" : `${list.refreshes} refreshes`;
  return `${parts.join(", ") || "Reordered"} in the last ${windowHours} hours over ${refreshes}.`;
}

/** The one-line summary the tab opens with. */
export function describeRadar(radar: Radar): string {
  const grew = radar.lists.reduce((sum, list) => sum + list.added, 0);
  const hours = radar.windowHours;
  if (radar.swarm.confirmed === 0 && grew === 0) return `Nothing new in the last ${hours} hours. The lists hold ${withCommas(radar.totals.listNames)} names.`;
  const swarm = radar.swarm.confirmed === 0 ? "no swarm confirmations" : `${withCommas(radar.swarm.confirmed)} swarm confirmation${radar.swarm.confirmed === 1 ? "" : "s"}`;
  const lists = grew === 0 ? "no list growth" : `${withCommas(grew)} new list name${grew === 1 ? "" : "s"}`;
  return `In the last ${hours} hours: ${swarm}, ${lists}, ${withCommas(radar.totals.listNames)} names on the lists in all.`;
}
