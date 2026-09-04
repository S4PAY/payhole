/** The background service worker's state machine: vault, chain access, observation, payment, tips, agents. */
import { browser, type Browser } from "wxt/browser";
import { getAddress, isAddress, toHex, type Address, type Hex, type PublicClient } from "viem";
import type { HDAccount, PrivateKeyAccount } from "viem/accounts";
import { chainConfig, parsePaymentRequired, type AnyPaymentRequired } from "@payhole/sdk";
import { AgentStore, countLive, exportEnv, readAgentViews } from "./agents";
import { BlocklistStore, pushToSinkhole } from "./blocklist";
import { type BridgeRequest, type BridgeSender, type PageReply, validateBridgeSender } from "./bridge";
import { BudgetError, createAccount, createSiteFunder, predictAccount, readAccountState, revokeAll, revokeSessionKey, setGlobalCap, setSessionKey, withdraw, isAccount, type OwnerContext } from "./budget";
import { publicClientFor, walletClientFor } from "./chain";
import { allocateRuleId, isNavigationRuleId, navigationRule, NAVIGATION_RULE_TTL_MS } from "./dnr";
import { errorText, toBigint } from "./format";
import { agentAccount, isValidMnemonic, newMnemonic, normalizeMnemonic, normalizeOrigin, originAccount, ownerAccount, seedFromMnemonic } from "./keys";
import { Ledger } from "./ledger";
import type { Api, ApiName, ApiRequest, ApiResponse, BudgetView, SiteCard, VaultStatus } from "./messages";
import { AttemptLog, ObservedOffers, type ObservedResourceType } from "./observed";
import { PaymentCore, type ApprovalRequest } from "./payments";
import { lookupCreator } from "./registry";
import { DEFAULT_SETTINGS, loadSettings, mergeSettings, saveSettings, SETTINGS_KEY, siteCapFor, validateSettings, type Settings } from "./settings";
import { localStore, sessionStore } from "./storage";
import { limitsForTier, readTierState, unlockTier, ZERO_ADDRESS, type TierLimits } from "./tiers";
import { createTipSender, TipScheduler } from "./tips";
import { topUp } from "./topup";
import { VaultStore } from "./vault";

export const AUTOLOCK_ALARM = "payhole-autolock";
export const SYNC_ALARM = "payhole-blocklist-sync";
export const APPROVAL_TIMEOUT_MS = 180_000;
const TIER_CACHE_MS = 5 * 60 * 1000;

interface Unlocked {
  mnemonic: string;
  seed: Uint8Array;
  owner: HDAccount;
  signers: Map<string, PrivateKeyAccount>;
}

interface NavigationRetry {
  ruleId: number;
  tabId: number;
  url: string;
  ledgerId: string;
  timer: ReturnType<typeof setTimeout>;
}

interface PageRetry {
  ledgerId: string;
  at: number;
}

interface PendingApproval {
  request: ApprovalRequest;
  resolve(approved: boolean): void;
  windowId?: number | undefined;
}

type HeadersDetails = Browser.webRequest.OnHeadersReceivedDetails;

function headerGetter(headers: Browser.webRequest.HttpHeader[] | undefined): (name: string) => string | null {
  return (name) => {
    const wanted = name.toLowerCase();
    const found = headers?.find((h) => h.name.toLowerCase() === wanted);
    return found?.value ?? null;
  };
}

function isHttpUrl(url: string): boolean {
  return url.startsWith("http://") || url.startsWith("https://");
}

export class BackgroundApp {
  private settings: Settings = structuredClone(DEFAULT_SETTINGS);
  private readonly vault = new VaultStore(localStore, sessionStore);
  private readonly ledger = new Ledger(localStore);
  private readonly blocklist = new BlocklistStore(localStore);
  private readonly agents = new AgentStore(localStore);
  private readonly tips: TipScheduler;
  private unlocked: Unlocked | null = null;
  private core: PaymentCore | null = null;
  private readonly observed = new ObservedOffers();
  private readonly navigationRetries = new Map<string, NavigationRetry>();
  private readonly pageRetries = new Map<string, PageRetry>();
  private readonly pendingApprovals = new Map<string, PendingApproval>();
  private readonly clients = new Map<string, PublicClient>();
  private tierCache: { at: number; owner: Address; limits: TierLimits; tier: number } | null = null;
  readonly ready: Promise<void>;

  constructor() {
    this.tips = new TipScheduler({
      lookup: async (hostname) => {
        const registry = this.registryAddress();
        if (!registry) return ZERO_ADDRESS;
        return (await lookupCreator(this.publicClient(), registry, hostname)).wallet;
      },
      send: (hostname, hash, amount, wallet) => {
        const registry = this.registryAddress();
        if (!registry) throw new Error("the CreatorRegistry address is not set");
        return createTipSender(this.ownerContext(), { registry, float: toBigint(this.settings.tips.float) })(hostname, hash, amount, wallet);
      },
      ledger: this.ledger,
      store: localStore,
      policy: () => ({
        enabled: this.settings.tips.enabled && this.unlocked !== null && this.registryAddress() !== null && this.budgetAccountAddress() !== null,
        amount: toBigint(this.settings.tips.amount),
        intervalMs: Math.max(1, this.settings.tips.intervalHours) * 3_600_000,
      }),
    });
    this.ready = this.init();
    browser.storage.onChanged.addListener((changes, area) => {
      const change = changes[SETTINGS_KEY];
      if (area !== "local" || !change) return;
      void this.ready.then(() => this.adoptSettings(mergeSettings(change.newValue)));
    });
  }

  /** Settings written by another context (an extension page, a test harness) take effect without a restart. */
  private adoptSettings(next: Settings): void {
    if (JSON.stringify(next) === JSON.stringify(this.settings)) return;
    const chainChanged = next.chainId !== this.settings.chainId || next.rpcUrl !== this.settings.rpcUrl || next.usdg !== this.settings.usdg;
    this.settings = next;
    if (chainChanged) {
      this.clients.clear();
      this.tierCache = null;
      this.rebuildCore();
    }
  }

  private async init(): Promise<void> {
    this.settings = await loadSettings(localStore);
    await Promise.all([this.ledger.load(), this.blocklist.load(), this.agents.load(), this.tips.load()]);
    try {
      await browser.storage.session.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });
    } catch {
      // not available in every runtime; the default is already trusted contexts only
    }
    const mnemonic = await this.vault.restore();
    if (mnemonic) await this.setUnlocked(mnemonic);
    try {
      await browser.alarms.create(SYNC_ALARM, { periodInMinutes: 15 });
    } catch {
      // alarms are optional for the core flow
    }
    await this.cleanupStaleRules();
  }

  // ------------------------------------------------------------------ helpers

  private log(message: string): void {
    console.log(`[payhole] ${message}`);
  }

  private publicClient(): PublicClient {
    const key = `${this.settings.chainId}|${this.settings.rpcUrl}`;
    let client = this.clients.get(key);
    if (!client) {
      client = publicClientFor(this.settings);
      this.clients.clear();
      this.clients.set(key, client);
    }
    return client;
  }

  private requireUnlocked(): Unlocked {
    if (!this.unlocked) throw new Error("the wallet is locked");
    return this.unlocked;
  }

  private budgetAccountAddress(): Address | null {
    return isAddress(this.settings.budgetAccount) ? getAddress(this.settings.budgetAccount) : null;
  }

  private registryAddress(): Address | null {
    return isAddress(this.settings.creatorRegistry) ? getAddress(this.settings.creatorRegistry) : null;
  }

  private vaultAddress(): Address | null {
    return isAddress(this.settings.burnVault) ? getAddress(this.settings.burnVault) : null;
  }

  private factoryAddress(): Address | null {
    return isAddress(this.settings.budgetAccountFactory) ? getAddress(this.settings.budgetAccountFactory) : null;
  }

  private ownerContext(): OwnerContext {
    const unlocked = this.requireUnlocked();
    const budgetAccount = this.budgetAccountAddress();
    if (!budgetAccount) throw new BudgetError("not-configured", "create the BudgetAccount first (Dashboard, Budget)");
    return {
      publicClient: this.publicClient(),
      walletClient: walletClientFor(this.settings, unlocked.owner),
      usdg: this.settings.usdg,
      budgetAccount,
    };
  }

  private async signerFor(origin: string): Promise<PrivateKeyAccount> {
    const unlocked = this.requireUnlocked();
    let signer = unlocked.signers.get(origin);
    if (!signer) {
      signer = await originAccount(unlocked.seed, origin);
      unlocked.signers.set(origin, signer);
    }
    return signer;
  }

  private async tierLimits(): Promise<{ tier: number; limits: TierLimits }> {
    const vault = this.vaultAddress();
    const owner = this.unlocked?.owner.address;
    if (!vault || !owner) return { tier: 0, limits: limitsForTier(0) };
    if (this.tierCache?.owner === owner && Date.now() - this.tierCache.at < TIER_CACHE_MS) {
      return { tier: this.tierCache.tier, limits: this.tierCache.limits };
    }
    try {
      const state = await readTierState(this.publicClient(), vault, owner);
      this.tierCache = { at: Date.now(), owner, limits: state.limits, tier: state.tier };
      return { tier: state.tier, limits: state.limits };
    } catch {
      return { tier: 0, limits: limitsForTier(0) };
    }
  }

  private async setUnlocked(mnemonic: string): Promise<void> {
    const seed = await seedFromMnemonic(mnemonic);
    this.unlocked = { mnemonic, seed, owner: ownerAccount(mnemonic), signers: new Map() };
    this.rebuildCore();
    await this.touch();
  }

  private rebuildCore(): void {
    if (!this.unlocked) {
      this.core = null;
      return;
    }
    this.core = new PaymentCore({
      chainId: this.settings.chainId,
      usdg: this.settings.usdg,
      signerFor: (origin) => this.signerFor(origin),
      funder: {
        ensure: (site, amount, cap) => createSiteFunder(this.ownerContext(), { topUpChunk: toBigint(this.settings.topUpChunk) }).ensure(site, amount, cap),
      },
      ledger: this.ledger,
      policy: () => ({
        paused: this.settings.pausedAll,
        globalCap: toBigint(this.settings.globalCap),
        siteCap: (origin) => siteCapFor(this.settings, origin),
        isBlocked: (hostname) => this.blocklist.isBlocked(hostname) !== undefined,
      }),
      prompt: (request) => this.prompt(request),
      log: (message) => this.log(message),
    });
  }

  async lock(): Promise<void> {
    this.unlocked = null;
    this.core = null;
    this.tierCache = null;
    await this.vault.lock();
    try {
      await browser.alarms.clear(AUTOLOCK_ALARM);
    } catch {
      // ignore
    }
  }

  /** Resets the auto-lock timer; called on every user interaction with the extension. */
  private async touch(): Promise<void> {
    if (!this.unlocked) return;
    try {
      await browser.alarms.create(AUTOLOCK_ALARM, { delayInMinutes: Math.max(1, this.settings.autoLockMinutes) });
    } catch {
      // ignore
    }
  }

  private status(): Promise<VaultStatus> {
    return this.vault.exists().then((exists) => ({
      exists,
      unlocked: this.unlocked !== null,
      ...(this.unlocked ? { owner: this.unlocked.owner.address } : {}),
      budgetAccount: this.settings.budgetAccount,
      chainId: this.settings.chainId,
      pausedAll: this.settings.pausedAll,
    }));
  }

  private async cleanupStaleRules(): Promise<void> {
    try {
      const rules = await browser.declarativeNetRequest.getSessionRules();
      const ids = rules.map((r) => r.id).filter(isNavigationRuleId);
      if (ids.length) await browser.declarativeNetRequest.updateSessionRules({ removeRuleIds: ids });
    } catch {
      // no declarativeNetRequest in this runtime
    }
  }

  // ------------------------------------------------------------- approvals

  private prompt(request: ApprovalRequest): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      const pending: PendingApproval = { request, resolve: () => undefined };
      const timer = setTimeout(() => finish(false), APPROVAL_TIMEOUT_MS);
      const finish = (approved: boolean): void => {
        if (!this.pendingApprovals.has(request.id)) return;
        clearTimeout(timer);
        this.pendingApprovals.delete(request.id);
        if (pending.windowId !== undefined) browser.windows.remove(pending.windowId).catch(() => undefined);
        resolve(approved);
      };
      pending.resolve = finish;
      this.pendingApprovals.set(request.id, pending);
      const url = `${browser.runtime.getURL("/approve.html")}?id=${encodeURIComponent(request.id)}`;
      browser.windows
        .create({ type: "popup", url, width: 440, height: 600, focused: true })
        .then((window) => {
          if (window?.id !== undefined) pending.windowId = window.id;
        })
        .catch((error: unknown) => {
          this.log(`approval window failed: ${errorText(error)}`);
          finish(false);
        });
    });
  }

  onWindowRemoved(windowId: number): void {
    for (const pending of this.pendingApprovals.values()) {
      if (pending.windowId === windowId) {
        pending.windowId = undefined;
        pending.resolve(false);
      }
    }
  }

  // --------------------------------------------------------------- webRequest

  async onHeadersReceived(details: HeadersDetails): Promise<void> {
    await this.ready;
    if (details.tabId < 0 || !isHttpUrl(details.url)) return;
    const getHeader = headerGetter(details.responseHeaders);
    const key = AttemptLog.key(details.tabId, details.url);

    if (details.type === "main_frame") {
      const retry = this.navigationRetries.get(key);
      if (retry) {
        await this.core?.recordSettlement(retry.ledgerId, getHeader, details.statusCode);
        await this.removeNavigationRule(key);
        return;
      }
    } else if (details.type === "xmlhttprequest") {
      const retry = this.pageRetries.get(key);
      if (retry) {
        this.pageRetries.delete(key);
        await this.core?.recordSettlement(retry.ledgerId, getHeader, details.statusCode);
        return;
      }
    }

    if (details.statusCode !== 402) return;
    let paymentRequired: AnyPaymentRequired | undefined;
    try {
      paymentRequired = parsePaymentRequired(getHeader) ?? undefined;
    } catch (error) {
      this.log(`${details.url}: malformed PAYMENT-REQUIRED header: ${errorText(error)}`);
      paymentRequired = undefined;
    }
    const resourceType = details.type as ObservedResourceType;
    this.observed.put({
      tabId: details.tabId,
      requestId: details.requestId,
      url: details.url,
      ...(details.initiator ? { initiatorOrigin: details.initiator.toLowerCase() } : {}),
      resourceType,
      ...(paymentRequired ? { paymentRequired } : {}),
      seenAt: Date.now(),
    });
    this.log(`observed 402 for ${details.url} (${resourceType}${paymentRequired ? "" : ", no PAYMENT-REQUIRED header"})`);
    if (resourceType === "main_frame" && paymentRequired) await this.payNavigation(details.tabId, details.requestId, details.url, paymentRequired);
  }

  onRequestFinished(details: Browser.webRequest.OnCompletedDetails | Browser.webRequest.OnErrorOccurredDetails): void {
    if (details.type !== "main_frame") return;
    void this.removeNavigationRule(AttemptLog.key(details.tabId, details.url));
  }

  async onTabRemoved(tabId: number): Promise<void> {
    for (const [key, retry] of this.navigationRetries) if (retry.tabId === tabId) await this.removeNavigationRule(key);
    for (const key of this.pageRetries.keys()) if (key.startsWith(`${tabId}|`)) this.pageRetries.delete(key);
  }

  private async payNavigation(tabId: number, requestId: string, url: string, paymentRequired: AnyPaymentRequired): Promise<void> {
    if (!this.core) {
      this.log(`${url}: 402 seen while locked`);
      return;
    }
    let origin: string;
    try {
      origin = normalizeOrigin(url);
    } catch {
      return;
    }
    const outcome = await this.core.handle({ requestId, tabId, url, origin, paymentRequired });
    if (outcome.kind !== "pay") return;
    const key = AttemptLog.key(tabId, url);
    await this.removeNavigationRule(key);
    const ruleId = allocateRuleId();
    try {
      await browser.declarativeNetRequest.updateSessionRules({
        addRules: [navigationRule(ruleId, url, tabId, outcome.headerName, outcome.headerValue)],
        removeRuleIds: [ruleId],
      });
    } catch (error) {
      this.log(`${url}: could not add the retry rule: ${errorText(error)}`);
      await this.ledger.settle(outcome.ledgerId, { success: false, note: "retry rule failed" });
      return;
    }
    this.navigationRetries.set(key, {
      ruleId,
      tabId,
      url,
      ledgerId: outcome.ledgerId,
      timer: setTimeout(() => void this.removeNavigationRule(key), NAVIGATION_RULE_TTL_MS),
    });
    this.log(`retrying navigation to ${url} with ${outcome.headerName}`);
    try {
      await browser.tabs.update(tabId, { url });
    } catch (error) {
      this.log(`${url}: could not reload the tab: ${errorText(error)}`);
      await this.removeNavigationRule(key);
    }
  }

  private async removeNavigationRule(key: string): Promise<void> {
    const retry = this.navigationRetries.get(key);
    if (!retry) return;
    this.navigationRetries.delete(key);
    clearTimeout(retry.timer);
    try {
      await browser.declarativeNetRequest.updateSessionRules({ removeRuleIds: [retry.ruleId] });
    } catch {
      // already gone
    }
  }

  // ------------------------------------------------------------------ bridge

  async handleBridge(request: BridgeRequest, sender: Browser.runtime.MessageSender): Promise<PageReply | { ok: boolean }> {
    await this.ready;
    const validSender = validateBridgeSender(sender, browser.runtime.id);
    if (!validSender) return { kind: "refused", reason: "unexpected sender" };
    if (request.type === "settled") {
      await this.recordPageSettlement(validSender, request.url, request.status, request.paymentResponseHeader);
      return { ok: true };
    }
    return this.payPageRequest(validSender, request);
  }

  private async recordPageSettlement(sender: BridgeSender, url: string, status: number, header: string | undefined): Promise<void> {
    const key = AttemptLog.key(sender.tabId, url);
    const retry = this.pageRetries.get(key);
    if (!retry || !this.core) return;
    this.pageRetries.delete(key);
    await this.core.recordSettlement(retry.ledgerId, (name) => (name.toLowerCase() === "payment-response" ? (header ?? null) : null), status);
  }

  private async payPageRequest(sender: BridgeSender, request: Extract<BridgeRequest, { type: "402" }>): Promise<PageReply> {
    if (!this.core) return { kind: "refused", reason: "the wallet is locked" };
    const observed = this.observed.findByTabUrl(sender.tabId, request.url);
    let paymentRequired = observed?.paymentRequired;
    if (!paymentRequired) {
      try {
        paymentRequired = parsePaymentRequired(() => request.paymentRequiredHeader ?? null, request.bodyText) ?? undefined;
      } catch (error) {
        return { kind: "refused", reason: `malformed payment request: ${errorText(error)}` };
      }
    }
    if (!observed && !paymentRequired) return { kind: "refused", reason: "no 402 was observed for this request" };
    if (!paymentRequired) return { kind: "refused", reason: "the 402 carries no x402 payment request" };
    const requestId = observed?.requestId ?? `page:${sender.tabId}:${request.id}`;
    const outcome = await this.core.handle({ requestId, tabId: sender.tabId, url: request.url, origin: sender.origin, paymentRequired });
    if (outcome.kind !== "pay") return { kind: "refused", reason: outcome.reason };
    this.pageRetries.set(AttemptLog.key(sender.tabId, request.url), { ledgerId: outcome.ledgerId, at: Date.now() });
    return { kind: "pay", headerName: outcome.headerName, headerValue: outcome.headerValue };
  }

  // ------------------------------------------------------------ navigation

  async onNavigationCommitted(details: Browser.webNavigation.WebNavigationTransitionCallbackDetails): Promise<void> {
    await this.ready;
    if (details.frameId !== 0 || !isHttpUrl(details.url)) return;
    const result = await this.tips.onNavigation(details.url);
    if (result.kind === "tipped") this.log(`tipped ${result.hostname} ${result.amount.toString()} base units in ${result.txHash}`);
    else if (result.kind === "failed") this.log(`tip to ${result.hostname} failed: ${result.error}`);
  }

  // ------------------------------------------------------------------ alarms

  async onAlarm(name: string): Promise<void> {
    await this.ready;
    if (name === AUTOLOCK_ALARM) {
      await this.lock();
      this.log("auto-locked");
    } else if (name === SYNC_ALARM) {
      await this.syncBlocklist();
    }
  }

  private async syncBlocklist(): Promise<void> {
    if (this.settings.sinkhole.url.trim() === "") return;
    const status = await pushToSinkhole({
      url: this.settings.sinkhole.url,
      token: this.settings.sinkhole.token,
      entries: this.blocklist.list(),
      updatedAt: this.blocklist.updatedAt(),
    });
    await this.blocklist.setSyncStatus(status);
  }

  // --------------------------------------------------------------------- API

  async handleApi(request: ApiRequest, sender: Browser.runtime.MessageSender): Promise<ApiResponse> {
    await this.ready;
    const prefix = browser.runtime.getURL("/");
    if (sender.id !== browser.runtime.id || !sender.url?.startsWith(prefix)) return { ok: false, error: "unexpected sender" };
    try {
      const handler = this.handlers[request.type] as (params: unknown) => Promise<unknown>;
      const result = (await handler(request.params)) as Api[ApiName]["result"];
      if (request.type !== "activity:ping") await this.touch();
      return { ok: true, result };
    } catch (error) {
      return { ok: false, error: errorText(error) };
    }
  }

  private async siteCard(url: string): Promise<SiteCard> {
    const origin = normalizeOrigin(url);
    const hostname = new URL(origin).hostname;
    const blocked = this.blocklist.isBlocked(hostname);
    let creator: SiteCard["creator"];
    if (this.registryAddress()) {
      try {
        const wallet = await this.tips.walletFor(hostname);
        creator = { registered: wallet !== ZERO_ADDRESS, wallet };
      } catch {
        creator = undefined;
      }
    }
    const address = this.unlocked ? (await this.signerFor(origin)).address : undefined;
    return {
      origin,
      hostname,
      ...(address ? { address } : {}),
      spent: this.ledger.spentFor(origin).toString(),
      cap: siteCapFor(this.settings, origin).toString(),
      override: origin in this.settings.siteCaps,
      ...(blocked ? { blocked } : {}),
      ...(creator ? { creator } : {}),
      entries: this.ledger.entriesFor(origin, 10),
    };
  }

  private async budgetView(): Promise<BudgetView> {
    const unlocked = this.requireUnlocked();
    const owner = unlocked.owner.address;
    const { limits } = await this.tierLimits();
    const factory = this.factoryAddress();
    const client = this.publicClient();
    const budgetAccount = this.budgetAccountAddress();
    const base = {
      owner,
      budgetAccount: this.settings.budgetAccount,
      ledgerTotal: this.ledger.totalSpent().toString(),
      ledgerToday: this.ledger.dailyTotal().toString(),
      extensionGlobalCap: this.settings.globalCap,
      tierGlobalCap: limits.globalCap.toString(),
      tierSiteCap: limits.siteCap.toString(),
    };
    if (!budgetAccount) {
      const predicted = factory ? await predictAccount(client, factory, owner).catch(() => "") : "";
      const [ownerEth, ownerUsdg] = await Promise.all([
        client.getBalance({ address: owner }).catch(() => 0n),
        client.readContract({ address: this.settings.usdg, abi: [{ type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "a", type: "address" }], outputs: [{ type: "uint256" }] }] as const, functionName: "balanceOf", args: [owner] }).catch(() => 0n),
      ]);
      return { ...base, configured: false, predicted, exists: false, ownerEth: ownerEth.toString(), ownerUsdg: ownerUsdg.toString(), accountUsdg: "0", globalCap: "0", globalSpent: "0", epoch: 0 };
    }
    const state = await readAccountState({ publicClient: client, usdg: this.settings.usdg, budgetAccount }, owner);
    const exists = factory ? await isAccount(client, factory, budgetAccount).catch(() => true) : true;
    return {
      ...base,
      configured: true,
      predicted: budgetAccount,
      exists,
      ownerEth: state.ownerEth.toString(),
      ownerUsdg: state.ownerUsdg.toString(),
      accountUsdg: state.accountUsdg.toString(),
      globalCap: state.globalCap.toString(),
      globalSpent: state.globalSpent.toString(),
      epoch: state.epoch,
    };
  }

  private async applySettings(patch: Partial<Settings>): Promise<Settings> {
    const next = await saveSettings(localStore, patch);
    const problems = validateSettings(next);
    if (problems.length) {
      await saveSettings(localStore, this.settings);
      throw new Error(problems.map((p) => `${p.field} ${p.message}`).join("; "));
    }
    const chainChanged = next.chainId !== this.settings.chainId || next.rpcUrl !== this.settings.rpcUrl || next.usdg !== this.settings.usdg;
    const sinkholeChanged = next.sinkhole.url !== this.settings.sinkhole.url || next.sinkhole.token !== this.settings.sinkhole.token;
    this.settings = next;
    if (chainChanged) {
      this.clients.clear();
      this.tierCache = null;
      this.rebuildCore();
    }
    if (sinkholeChanged) void this.syncBlocklist();
    return next;
  }

  private readonly handlers: { [K in ApiName]: (params: Api[K]["params"]) => Promise<Api[K]["result"]> } = {
    "vault:status": () => this.status(),
    "vault:create": async ({ password }) => {
      const mnemonic = newMnemonic();
      await this.vault.create(mnemonic, password);
      await this.setUnlocked(mnemonic);
      return { mnemonic, owner: this.requireUnlocked().owner.address };
    },
    "vault:import": async ({ mnemonic, password }) => {
      const normalized = normalizeMnemonic(mnemonic);
      if (!isValidMnemonic(normalized)) throw new Error("that is not a valid BIP-39 mnemonic");
      await this.vault.create(normalized, password);
      await this.setUnlocked(normalized);
      return { owner: this.requireUnlocked().owner.address };
    },
    "vault:unlock": async ({ password }) => {
      const mnemonic = await this.vault.unlock(password);
      await this.setUnlocked(mnemonic);
      return this.status();
    },
    "vault:lock": async () => {
      await this.lock();
      return this.status();
    },
    "vault:destroy": async () => {
      if (this.unlocked) throw new Error("lock the wallet before removing the seed");
      await this.vault.destroy();
      await this.applySettings({ budgetAccount: "" });
      return this.status();
    },
    "settings:get": () => Promise.resolve(structuredClone(this.settings)),
    "settings:set": async ({ patch }) => {
      const { limits } = await this.tierLimits();
      if (patch.defaultSiteCap !== undefined && toBigint(patch.defaultSiteCap) > limits.siteCap) throw new Error(`the per-site cap is limited to ${limits.siteCap.toString()} base units at your tier`);
      if (patch.globalCap !== undefined && toBigint(patch.globalCap) > limits.globalCap) throw new Error(`the global cap is limited to ${limits.globalCap.toString()} base units at your tier`);
      const next = await this.applySettings(patch);
      if (patch.autoLockMinutes !== undefined) await this.touch();
      return next;
    },
    "site:current": ({ url }) => this.siteCard(url),
    "site:setCap": async ({ origin, cap }) => {
      const normalized = normalizeOrigin(origin);
      const siteCaps = { ...this.settings.siteCaps };
      if (cap === null) {
        delete siteCaps[normalized];
      } else {
        if (!/^\d+$/.test(cap)) throw new Error("cap must be an amount");
        const { limits } = await this.tierLimits();
        if (toBigint(cap) > limits.siteCap) throw new Error(`the per-site cap is limited to ${limits.siteCap.toString()} base units at your tier`);
        siteCaps[normalized] = cap;
      }
      return this.applySettings({ siteCaps });
    },
    "sites:list": () => {
      const rows = new Map<string, { origin: string; spent: bigint; count: number; lastAt: number }>();
      for (const summary of this.ledger.origins()) rows.set(summary.origin, summary);
      for (const origin of Object.keys(this.settings.siteCaps)) {
        if (!rows.has(origin)) rows.set(origin, { origin, spent: 0n, count: 0, lastAt: 0 });
      }
      return Promise.resolve(
        [...rows.values()].map((row) => ({
          origin: row.origin,
          spent: row.spent.toString(),
          cap: siteCapFor(this.settings, row.origin).toString(),
          override: row.origin in this.settings.siteCaps,
          count: row.count,
          lastAt: row.lastAt,
          blocked: this.blocklist.isBlocked(new URL(row.origin).hostname) !== undefined,
        })),
      );
    },
    "ledger:recent": ({ limit }) => Promise.resolve(this.ledger.recent(limit ?? 20)),
    "budget:view": () => this.budgetView(),
    "budget:createAccount": async () => {
      const unlocked = this.requireUnlocked();
      const factory = this.factoryAddress();
      if (!factory) throw new Error("the BudgetAccountFactory address is not set (Settings)");
      const result = await createAccount({ publicClient: this.publicClient(), walletClient: walletClientFor(this.settings, unlocked.owner) }, factory);
      await this.applySettings({ budgetAccount: result.account });
      return { account: result.account, ...(result.txHash ? { txHash: result.txHash } : {}) };
    },
    "budget:topUp": async ({ amount }) => {
      const result = await topUp({
        ...this.ownerContext(),
        burnVault: this.settings.burnVault,
        quoter: chainConfig.uniswapV4.quoter,
        amount: toBigint(amount),
        feePercent: this.settings.feePercent,
      });
      return { deposited: result.deposited.toString(), fee: result.fee.toString(), ...(result.feeSkipped ? { feeSkipped: result.feeSkipped } : {}), txHashes: result.txHashes };
    },
    "budget:withdraw": async ({ amount, to }) => {
      const ctx = this.ownerContext();
      const target = to && to.trim() !== "" ? to.trim() : ctx.walletClient.account.address;
      if (!isAddress(target)) throw new Error("the recipient is not an address");
      return { txHash: await withdraw(ctx, getAddress(target), toBigint(amount)) };
    },
    "budget:setGlobalCap": async ({ cap }) => {
      const { limits } = await this.tierLimits();
      const value = toBigint(cap);
      if (value > limits.globalCap) throw new Error(`the global cap is limited to ${limits.globalCap.toString()} base units at your tier`);
      return { txHash: await setGlobalCap(this.ownerContext(), value) };
    },
    "agents:list": async () => {
      const { limits } = await this.tierLimits();
      const budgetAccount = this.budgetAccountAddress();
      const records = this.agents.list();
      const agents = budgetAccount
        ? await readAgentViews(this.publicClient(), budgetAccount, records)
        : records.map((r) => ({ ...r, live: false, cap: "0", spent: "0", remaining: "0", expiry: 0 }));
      return { agents, limit: limits.agentKeys, live: countLive(agents), budgetAccount: this.settings.budgetAccount };
    },
    "agents:create": async ({ label, cap, expiry }) => {
      const unlocked = this.requireUnlocked();
      const ctx = this.ownerContext();
      const { limits } = await this.tierLimits();
      const capValue = toBigint(cap);
      if (capValue <= 0n) throw new Error("cap must be positive");
      if (capValue > limits.globalCap) throw new Error(`a key cap is limited to ${limits.globalCap.toString()} base units at your tier`);
      if (!Number.isInteger(expiry) || expiry <= Math.floor(Date.now() / 1000)) throw new Error("expiry must be in the future");
      const views = await readAgentViews(ctx.publicClient, ctx.budgetAccount, this.agents.list());
      if (countLive(views) >= limits.agentKeys) throw new Error(`your tier allows ${limits.agentKeys} live agent keys`);
      const index = this.agents.nextIndex();
      const account = agentAccount(unlocked.mnemonic, index);
      await setSessionKey(ctx, account.address, capValue, BigInt(expiry));
      const record = { index, address: account.address, label: label.trim() || `agent-${index}`, createdAt: Date.now() };
      await this.agents.add(record);
      const [view] = await readAgentViews(ctx.publicClient, ctx.budgetAccount, [record]);
      if (!view) throw new Error("could not read the new key");
      return view;
    },
    "agents:export": ({ index }) => {
      const unlocked = this.requireUnlocked();
      const record = this.agents.list().find((r) => r.index === index);
      if (!record) throw new Error("unknown agent key");
      const account = agentAccount(unlocked.mnemonic, index);
      const privateKeyBytes = account.getHdKey().privateKey;
      if (!privateKeyBytes) throw new Error("could not derive the key");
      const privateKey: Hex = toHex(privateKeyBytes);
      return Promise.resolve({ privateKey, address: account.address, budgetAccount: this.settings.budgetAccount, env: exportEnv(privateKey, this.settings.budgetAccount) });
    },
    "agents:revoke": async ({ address }) => {
      if (!isAddress(address)) throw new Error("not an address");
      const txHash = await revokeSessionKey(this.ownerContext(), getAddress(address));
      const record = this.agents.find(getAddress(address));
      if (record) await this.agents.update(record.index, { revokedAt: Date.now() });
      return { txHash };
    },
    "agents:revokeAll": async () => {
      const txHash = await revokeAll(this.ownerContext());
      await this.agents.markAllRevoked(Date.now());
      return { txHash };
    },
    "agents:label": async ({ index, label }) => {
      await this.agents.update(index, { label: label.trim() });
      return { ok: true };
    },
    "blocklist:view": () => Promise.resolve(this.blocklistView()),
    "blocklist:add": async ({ domain, reason }) => {
      await this.blocklist.add(domain, reason);
      void this.syncBlocklist();
      return this.blocklistView();
    },
    "blocklist:remove": async ({ domain }) => {
      await this.blocklist.remove(domain);
      void this.syncBlocklist();
      return this.blocklistView();
    },
    "blocklist:export": ({ format }) => Promise.resolve({ text: this.blocklist.export(format) }),
    "blocklist:sync": async () => {
      if (this.settings.sinkhole.url.trim() === "") throw new Error("set the Sinkhole URL first");
      await this.syncBlocklist();
      return this.blocklist.syncStatus();
    },
    "registry:lookup": async ({ domain }) => {
      const registry = this.registryAddress();
      if (!registry) throw new Error("the CreatorRegistry address is not set (Settings)");
      return lookupCreator(this.publicClient(), registry, domain);
    },
    "tips:view": () =>
      Promise.resolve({
        settings: structuredClone(this.settings.tips),
        history: this.tips.history(),
        total: this.ledger.tipsTotal().toString(),
        configured: this.registryAddress() !== null && this.budgetAccountAddress() !== null,
      }),
    "tiers:view": async () => {
      const vault = this.vaultAddress();
      const owner = this.unlocked?.owner.address;
      if (!vault || !owner) {
        const limits = limitsForTier(0);
        return { configured: false, tier: 0, limits: { agentKeys: limits.agentKeys, globalCap: limits.globalCap.toString(), siteCap: limits.siteCap.toString() }, token: "", tokenSet: false, nextTierCost: "0" };
      }
      const state = await readTierState(this.publicClient(), vault, owner);
      this.tierCache = { at: Date.now(), owner, limits: state.limits, tier: state.tier };
      return {
        configured: true,
        tier: state.tier,
        limits: { agentKeys: state.limits.agentKeys, globalCap: state.limits.globalCap.toString(), siteCap: state.limits.siteCap.toString() },
        token: state.token,
        tokenSet: state.tokenSet,
        nextTierCost: state.nextTierCost.toString(),
      };
    },
    "tiers:unlock": async ({ tier }) => {
      const unlocked = this.requireUnlocked();
      const vault = this.vaultAddress();
      if (!vault) throw new Error("the BurnVault address is not set (Settings)");
      const txHashes = await unlockTier({ publicClient: this.publicClient(), walletClient: walletClientFor(this.settings, unlocked.owner), vault, tier });
      this.tierCache = null;
      return { txHashes };
    },
    "approval:get": ({ id }) => Promise.resolve(this.pendingApprovals.get(id)?.request ?? null),
    "approval:answer": ({ id, approved }) => {
      const pending = this.pendingApprovals.get(id);
      if (!pending) return Promise.resolve({ ok: false });
      pending.resolve(approved);
      return Promise.resolve({ ok: true });
    },
    "activity:ping": async () => {
      await this.touch();
      return { ok: true };
    },
  };

  private blocklistView() {
    return { entries: this.blocklist.list(), updatedAt: this.blocklist.updatedAt(), sync: this.blocklist.syncStatus(), sinkhole: structuredClone(this.settings.sinkhole) };
  }
}
