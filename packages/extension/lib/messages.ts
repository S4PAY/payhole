/** Request and response contract between the extension pages and the background service worker. */
import type { Address } from "viem";
import type { AgentView } from "./agents";
import type { BlockEntry, BlockReason, ExportFormat, SyncStatus } from "./blocklist";
import type { LedgerEntry } from "./ledger";
import type { ApprovalRequest } from "./payments";
import type { Settings, SinkholeSettings, TipSettings } from "./settings";

export const API_KIND = "payhole-api";

export interface VaultStatus {
  exists: boolean;
  unlocked: boolean;
  owner?: Address;
  budgetAccount: string;
  chainId: number;
  pausedAll: boolean;
}

export interface SiteCard {
  origin: string;
  hostname: string;
  address?: Address;
  spent: string;
  cap: string;
  override: boolean;
  blocked?: BlockEntry;
  creator?: { registered: boolean; wallet: string };
  entries: LedgerEntry[];
}

export interface SiteRow {
  origin: string;
  spent: string;
  cap: string;
  override: boolean;
  count: number;
  lastAt: number;
  blocked: boolean;
}

export interface BudgetView {
  configured: boolean;
  owner: Address;
  budgetAccount: string;
  predicted: string;
  exists: boolean;
  ownerEth: string;
  ownerUsdg: string;
  accountUsdg: string;
  globalCap: string;
  globalSpent: string;
  epoch: number;
  ledgerTotal: string;
  ledgerToday: string;
  extensionGlobalCap: string;
  tierGlobalCap: string;
  tierSiteCap: string;
}

export interface TierView {
  configured: boolean;
  tier: number;
  limits: { agentKeys: number; globalCap: string; siteCap: string };
  token: string;
  tokenSet: boolean;
  nextTierCost: string;
}

export interface BlocklistView {
  entries: BlockEntry[];
  updatedAt: number;
  sync: SyncStatus;
  sinkhole: SinkholeSettings;
}

export interface TipsView {
  settings: TipSettings;
  history: LedgerEntry[];
  total: string;
  configured: boolean;
}

export interface RegistryView {
  hostname: string;
  domainHash: string;
  wallet: string;
  registered: boolean;
}

export interface AgentsView {
  agents: AgentView[];
  limit: number;
  live: number;
  budgetAccount: string;
}

export interface Api {
  "vault:status": { params: Record<string, never>; result: VaultStatus };
  "vault:create": { params: { password: string }; result: { mnemonic: string; owner: Address } };
  "vault:import": { params: { mnemonic: string; password: string }; result: { owner: Address } };
  "vault:unlock": { params: { password: string }; result: VaultStatus };
  "vault:lock": { params: Record<string, never>; result: VaultStatus };
  "vault:destroy": { params: Record<string, never>; result: VaultStatus };
  "settings:get": { params: Record<string, never>; result: Settings };
  "settings:set": { params: { patch: Partial<Settings> }; result: Settings };
  "site:current": { params: { url: string }; result: SiteCard };
  "site:setCap": { params: { origin: string; cap: string | null }; result: Settings };
  "sites:list": { params: Record<string, never>; result: SiteRow[] };
  "ledger:recent": { params: { limit?: number }; result: LedgerEntry[] };
  "budget:view": { params: Record<string, never>; result: BudgetView };
  "budget:createAccount": { params: Record<string, never>; result: { account: Address; txHash?: string } };
  "budget:topUp": { params: { amount: string }; result: { deposited: string; fee: string; feeSkipped?: string; txHashes: string[] } };
  "budget:withdraw": { params: { amount: string; to?: string }; result: { txHash: string } };
  "budget:setGlobalCap": { params: { cap: string }; result: { txHash: string } };
  "agents:list": { params: Record<string, never>; result: AgentsView };
  "agents:create": { params: { label: string; cap: string; expiry: number }; result: AgentView };
  "agents:export": { params: { index: number }; result: { privateKey: string; address: Address; budgetAccount: string; env: string } };
  "agents:revoke": { params: { address: string }; result: { txHash: string } };
  "agents:revokeAll": { params: Record<string, never>; result: { txHash: string } };
  "agents:label": { params: { index: number; label: string }; result: { ok: true } };
  "blocklist:view": { params: Record<string, never>; result: BlocklistView };
  "blocklist:add": { params: { domain: string; reason: BlockReason }; result: BlocklistView };
  "blocklist:remove": { params: { domain: string }; result: BlocklistView };
  "blocklist:export": { params: { format: ExportFormat }; result: { text: string } };
  "blocklist:sync": { params: Record<string, never>; result: SyncStatus };
  "registry:lookup": { params: { domain: string }; result: RegistryView };
  "tips:view": { params: Record<string, never>; result: TipsView };
  "tiers:view": { params: Record<string, never>; result: TierView };
  "tiers:unlock": { params: { tier: number }; result: { txHashes: string[] } };
  "approval:get": { params: { id: string }; result: ApprovalRequest | null };
  "approval:answer": { params: { id: string; approved: boolean }; result: { ok: boolean } };
  "activity:ping": { params: Record<string, never>; result: { ok: true } };
}

export type ApiName = keyof Api;

export interface ApiRequest<K extends ApiName = ApiName> {
  kind: typeof API_KIND;
  type: K;
  params: Api[K]["params"];
}

export type ApiResponse<K extends ApiName = ApiName> = { ok: true; result: Api[K]["result"] } | { ok: false; error: string };

export function isApiRequest(value: unknown): value is ApiRequest {
  return typeof value === "object" && value !== null && (value as { kind?: unknown }).kind === API_KIND && typeof (value as { type?: unknown }).type === "string";
}
