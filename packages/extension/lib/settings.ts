import { isAddress, type Address } from "viem";
import { chainConfig, deployments } from "@payhole/sdk";
import type { KeyValueStore } from "./storage";
import { toBigint } from "./format";

export interface TipSettings {
  enabled: boolean;
  /** Base units per tip. */
  amount: string;
  /** Minimum hours between two tips to the same domain. */
  intervalHours: number;
  /** Base units withdrawn from the BudgetAccount to the owner when the owner runs short. */
  float: string;
}

export interface SinkholeSettings {
  url: string;
  token: string;
}

export interface Settings {
  rpcUrl: string;
  chainId: number;
  usdg: Address;
  budgetAccountFactory: string;
  burnVault: string;
  creatorRegistry: string;
  /** The user's BudgetAccount once created. */
  budgetAccount: string;
  /** Base units a site may spend before a prompt, unless overridden in `siteCaps`. */
  defaultSiteCap: string;
  /** Base units all sites together may spend before a prompt. */
  globalCap: string;
  /** Base units pushed to a per-site address per top-up. */
  topUpChunk: string;
  /** Percent of every top-up routed to the BurnVault. */
  feePercent: number;
  autoLockMinutes: number;
  pausedAll: boolean;
  siteCaps: Record<string, string>;
  tips: TipSettings;
  sinkhole: SinkholeSettings;
}

export const SETTINGS_KEY = "settings";

function deployed(name: string): string {
  const entry = (deployments.contracts as Record<string, { address?: string } | undefined>)[name];
  return entry?.address ?? "";
}

export const DEFAULT_SETTINGS: Settings = {
  rpcUrl: chainConfig.rpc,
  chainId: chainConfig.chainId,
  usdg: chainConfig.usdg,
  budgetAccountFactory: deployed("BudgetAccountFactory"),
  burnVault: deployed("BurnVault"),
  creatorRegistry: deployed("CreatorRegistry"),
  budgetAccount: "",
  defaultSiteCap: "1000000",
  globalCap: "25000000",
  topUpChunk: "500000",
  feePercent: 1,
  autoLockMinutes: 15,
  pausedAll: false,
  siteCaps: {},
  tips: { enabled: false, amount: "10000", intervalHours: 24, float: "1000000" },
  sinkhole: { url: "", token: "" },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Merges a stored partial over the defaults; unknown or malformed fields fall back. */
export function mergeSettings(stored: unknown): Settings {
  if (!isRecord(stored)) return structuredClone(DEFAULT_SETTINGS);
  const base = structuredClone(DEFAULT_SETTINGS);
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(stored)) {
    if (!(key in base)) continue;
    const current = (base as unknown as Record<string, unknown>)[key];
    if (isRecord(current) && isRecord(value)) out[key] = { ...current, ...value };
    else if (typeof current === typeof value) out[key] = value;
  }
  return out as unknown as Settings;
}

export async function loadSettings(store: KeyValueStore): Promise<Settings> {
  return mergeSettings(await store.get(SETTINGS_KEY));
}

export async function saveSettings(store: KeyValueStore, patch: Partial<Settings>): Promise<Settings> {
  const current = await loadSettings(store);
  const next = mergeSettings({ ...current, ...patch });
  await store.set(SETTINGS_KEY, next);
  return next;
}

/** Per-site cap for an origin: the override when set, the default otherwise. */
export function siteCapFor(settings: Settings, origin: string): bigint {
  return toBigint(settings.siteCaps[origin], toBigint(settings.defaultSiteCap));
}

export interface SettingsProblem {
  field: string;
  message: string;
}

/** Field-level validation for the settings form. */
export function validateSettings(settings: Settings): SettingsProblem[] {
  const problems: SettingsProblem[] = [];
  try {
    const url = new URL(settings.rpcUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:") problems.push({ field: "rpcUrl", message: "must be an http(s) URL" });
  } catch {
    problems.push({ field: "rpcUrl", message: "must be a URL" });
  }
  if (!Number.isInteger(settings.chainId) || settings.chainId <= 0) problems.push({ field: "chainId", message: "must be a positive integer" });
  for (const field of ["usdg", "budgetAccountFactory", "burnVault", "creatorRegistry", "budgetAccount"] as const) {
    const value = settings[field];
    if (value !== "" && !isAddress(value)) problems.push({ field, message: "must be an address or empty" });
  }
  if ((settings.usdg as string) === "") problems.push({ field: "usdg", message: "is required" });
  for (const field of ["defaultSiteCap", "globalCap", "topUpChunk"] as const) {
    if (!/^\d+$/.test(settings[field])) problems.push({ field, message: "must be an amount" });
  }
  if (!(settings.feePercent >= 0 && settings.feePercent <= 100)) problems.push({ field: "feePercent", message: "must be between 0 and 100" });
  if (!(settings.autoLockMinutes >= 1)) problems.push({ field: "autoLockMinutes", message: "must be at least 1" });
  if (!/^\d+$/.test(settings.tips.amount)) problems.push({ field: "tips.amount", message: "must be an amount" });
  if (!(settings.tips.intervalHours > 0)) problems.push({ field: "tips.intervalHours", message: "must be positive" });
  if (settings.sinkhole.url !== "") {
    try {
      new URL(settings.sinkhole.url);
    } catch {
      problems.push({ field: "sinkhole.url", message: "must be a URL" });
    }
  }
  return problems;
}
