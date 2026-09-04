/**
 * End-to-end: loads `.output/chrome-mv3` into headless Chromium through Playwright and pays a mock x402 server
 * from a page (navigation, fetch, XHR) with the per-site address funded from a BudgetAccount on anvil.
 *
 * Skipped with a reason when the build output is missing or Chromium cannot start here (see README, "End-to-end
 * test" for the manual procedure and the PLAYWRIGHT_BROWSERS_PATH=0 install).
 */
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PublicClient } from "viem";
import type * as Playwright from "playwright";
import type { BrowserContext, Page } from "playwright";
import { encryptSecret } from "../lib/vault";
import type { Settings } from "../lib/settings";
import { originAccount, seedFromMnemonic } from "../lib/keys";
import { startAnvil, type AnvilHandle } from "./helpers/anvil";
import { balanceOf, CHAIN_ID, deployBudget, MERCHANT, TEST_MNEMONIC, wallet, type Deployed } from "./helpers/chain";
import { startMockX402Server, type MockServer } from "./helpers/mockServer";

const here = dirname(fileURLToPath(import.meta.url));
const EXTENSION_DIR = join(here, "..", ".output", "chrome-mv3");
const ANVIL_PORT = 8575;
const SERVER_PORT = 8576;
const PRICE = 250_000n;
const PASSWORD = "e2e-password";

type PlaywrightModule = typeof Playwright;

/** Globals available to the callbacks `page.evaluate` runs inside extension pages. */
declare const chrome: {
  storage: { local: { set(items: Record<string, unknown>): Promise<void> } };
  runtime: { sendMessage(message: unknown): Promise<unknown> };
};

let skipReason: string | null = existsSync(join(EXTENSION_DIR, "manifest.json")) ? null : `no build at ${EXTENSION_DIR}; run "pnpm build" first`;
let anvil: AnvilHandle | undefined;
let deployed: Deployed;
let publicClient: PublicClient;
let server: MockServer | undefined;
let context: BrowserContext | undefined;
let extensionId = "";
let userDataDir = "";
const browserLogs: string[] = [];

async function launch(): Promise<void> {
  let playwright: PlaywrightModule;
  try {
    playwright = await import("playwright");
  } catch (error) {
    skipReason = `playwright is not installed: ${error instanceof Error ? error.message : String(error)}`;
    return;
  }
  userDataDir = mkdtempSync(join(tmpdir(), "payhole-e2e-"));
  try {
    context = await playwright.chromium.launchPersistentContext(userDataDir, {
      channel: "chromium",
      headless: true,
      args: [`--disable-extensions-except=${EXTENSION_DIR}`, `--load-extension=${EXTENSION_DIR}`, "--no-sandbox", "--disable-gpu"],
      env: { ...process.env },
      timeout: 60_000,
    });
  } catch (error) {
    skipReason = `Chromium could not start here: ${error instanceof Error ? error.message.split("\n")[0] : String(error)}`;
    return;
  }
  let worker = context.serviceWorkers()[0];
  worker ??= await context.waitForEvent("serviceworker", { timeout: 30_000 });
  extensionId = new URL(worker.url()).host;
  worker.on("console", (message) => browserLogs.push(`[worker] ${message.text()}`));
  context.on("page", (page) => {
    page.on("console", (message) => browserLogs.push(`[page ${page.url()}] ${message.text()}`));
    page.on("pageerror", (error) => browserLogs.push(`[page ${page.url()}] ${error.message}`));
  });
}

async function seedExtension(): Promise<Page> {
  if (!context) throw new Error("no browser");
  const vault = await encryptSecret(TEST_MNEMONIC, PASSWORD, 5_000);
  const settings: Partial<Settings> = {
    rpcUrl: anvil!.rpcUrl,
    chainId: CHAIN_ID,
    usdg: deployed.usdg,
    budgetAccountFactory: deployed.factory,
    budgetAccount: deployed.budgetAccount,
    burnVault: "",
    creatorRegistry: "",
    defaultSiteCap: "1000000",
    topUpChunk: "500000",
    feePercent: 0,
  };
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/dashboard.html`);
  await page.evaluate(async (v) => {
    await chrome.storage.local.set({ vault: v });
  }, vault);
  const saved = await page.evaluate((patch) => chrome.runtime.sendMessage({ kind: "payhole-api", type: "settings:set", params: { patch } }), settings);
  expect(saved).toMatchObject({ ok: true, result: { usdg: deployed.usdg, budgetAccount: deployed.budgetAccount } });
  const status = await page.evaluate((password) => chrome.runtime.sendMessage({ kind: "payhole-api", type: "vault:unlock", params: { password } }), PASSWORD);
  expect(status).toMatchObject({ ok: true, result: { unlocked: true, owner: deployed.owner.address } });
  return page;
}

async function setSiteCap(page: Page, origin: string, cap: string | null): Promise<void> {
  const result = await page.evaluate(({ origin: o, cap: c }) => chrome.runtime.sendMessage({ kind: "payhole-api", type: "site:setCap", params: { origin: o, cap: c } }), { origin, cap });
  expect(result).toMatchObject({ ok: true });
}

beforeAll(async () => {
  if (skipReason) return;
  anvil = await startAnvil(ANVIL_PORT, CHAIN_ID);
  deployed = await deployBudget(anvil.rpcUrl, { mint: 1_000_000_000n, deposit: 50_000_000n });
  publicClient = deployed.publicClient;
  server = await startMockX402Server({
    publicClient,
    relayer: wallet(deployed.relayer, anvil.rpcUrl),
    asset: deployed.usdg,
    payTo: MERCHANT,
    amount: PRICE,
    chainId: CHAIN_ID,
    version: 2,
    port: SERVER_PORT,
  });
  await launch();
});

afterAll(async () => {
  if (browserLogs.length) console.log(browserLogs.join("\n"));
  await context?.close().catch(() => undefined);
  if (userDataDir) rmSync(userDataDir, { recursive: true, force: true });
  await server?.close();
  await anvil?.stop();
});

describe("extension in Chromium", () => {
  it("pays a top-level navigation, a fetch, and an XHR from the per-site address", async (ctx) => {
    if (skipReason) {
      console.warn(`[e2e] skipped: ${skipReason}`);
      ctx.skip();
      return;
    }
    const dashboard = await seedExtension();
    const origin = new URL(server!.url).origin;
    const merchantBefore = await balanceOf(publicClient, deployed.usdg, MERCHANT);

    // navigation: the tab lands on a 402, the extension pays and reloads with the header
    const nav = await context!.newPage();
    await nav.goto(`${server!.url}/paid`);
    await nav.waitForFunction(() => document.body.innerText.includes('"ok":true'), null, { timeout: 90_000 });
    expect(await nav.evaluate(() => document.body.innerText)).toContain(`"paid":"${PRICE}"`);
    expect(server!.stats.settled).toBe(1);

    // fetch from page script, with a JSON body that must survive the retry
    const fetchPage = await context!.newPage();
    await fetchPage.goto(`${server!.url}/fetch.html`);
    await fetchPage.waitForFunction(() => !document.getElementById("out")?.textContent?.startsWith("pending"), null, { timeout: 90_000 });
    expect(await fetchPage.evaluate(() => document.getElementById("out")?.textContent)).toBe(`200 {"ok":true,"paid":"${PRICE}"}`);
    expect(server!.stats.settled).toBe(2);

    // XMLHttpRequest from page script: the page sees one request that ends at readyState 4 with the paid body
    const xhrPage = await context!.newPage();
    await xhrPage.goto(`${server!.url}/xhr.html`);
    await xhrPage.waitForFunction(() => !document.getElementById("out")?.textContent?.startsWith("pending"), null, { timeout: 90_000 });
    const xhrText = await xhrPage.evaluate(() => document.getElementById("out")?.textContent ?? "");
    expect(xhrText).toContain(`200 {"ok":true,"paid":"${PRICE}"}`);
    expect(xhrText).toMatch(/states=1,2(,3)+,4$/);
    expect(server!.stats.settled).toBe(3);

    expect(await balanceOf(publicClient, deployed.usdg, MERCHANT)).toBe(merchantBefore + 3n * PRICE);
    const site = await originAccount(await seedFromMnemonic(TEST_MNEMONIC), origin);
    expect(await balanceOf(publicClient, deployed.usdg, site.address)).toBe(500_000n * 2n - 3n * PRICE);

    // over cap: the approval window opens; denying leaves the page with the original 402
    await setSiteCap(dashboard, origin, "800000");
    const approvalPromise = context!.waitForEvent("page", { predicate: (p) => p.url().includes("approve.html"), timeout: 60_000 });
    const overPage = await context!.newPage();
    await overPage.goto(`${server!.url}/fetch.html`);
    const approval = await approvalPromise;
    await approval.waitForSelector("text=Payment over cap");
    // the background closes the approval window as soon as the answer lands, which can interrupt the click action
    await approval.click("text=Deny", { noWaitAfter: true }).catch(() => undefined);
    await approval.waitForEvent("close", { timeout: 30_000 }).catch(() => undefined);
    await overPage.waitForFunction(() => !document.getElementById("out")?.textContent?.startsWith("pending"), null, { timeout: 60_000 });
    expect(await overPage.evaluate(() => document.getElementById("out")?.textContent)).toBe("402 {}");
    expect(server!.stats.settled).toBe(3);
  });
});
