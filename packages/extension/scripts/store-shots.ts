/**
 * Stages the extension against a local chain and a mock paid site, then captures the raw screenshots the store
 * listing is composed from. Run from packages/extension: pnpm exec tsx scripts/store-shots.ts
 * Needs the built extension (.output/chrome-mv3), anvil on PATH, and Playwright's Chromium.
 */
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type BrowserContext, type Page } from "playwright";
import { encryptSecret } from "../lib/vault";
import type { Settings } from "../lib/settings";
import { startAnvil } from "../test/helpers/anvil";
import { CHAIN_ID, deployBudget, MERCHANT, TEST_MNEMONIC, wallet } from "../test/helpers/chain";
import { startMockX402Server } from "../test/helpers/mockServer";

declare const chrome: {
  storage: { local: { set(items: Record<string, unknown>): Promise<void> } };
  runtime: { sendMessage(message: unknown): Promise<unknown> };
};

const here = dirname(fileURLToPath(import.meta.url));
const EXTENSION_DIR = join(here, "..", ".output", "chrome-mv3");
const OUT = join(here, "..", "store", "raw");
const ANVIL_PORT = 8585;
const SERVER_PORT = 8586;
const PRICE = 20_000n;
const PASSWORD = "store-shots";
const SITE = "article.example";
const OVER = "reader.example";

async function api(page: Page, type: string, params: unknown): Promise<unknown> {
  return page.evaluate(({ t, p }) => chrome.runtime.sendMessage({ kind: "payhole-api", type: t, params: p }), { t: type, p: params });
}

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  const anvil = await startAnvil(ANVIL_PORT, CHAIN_ID);
  const deployed = await deployBudget(anvil.rpcUrl, { mint: 1_000_000_000n, deposit: 50_000_000n });
  const server = await startMockX402Server({
    publicClient: deployed.publicClient,
    relayer: wallet(deployed.relayer, anvil.rpcUrl),
    asset: deployed.usdg,
    payTo: MERCHANT,
    amount: PRICE,
    chainId: CHAIN_ID,
    version: 2,
    port: SERVER_PORT,
  });
  const userDataDir = mkdtempSync(join(tmpdir(), "payhole-store-"));
  let context: BrowserContext | undefined;
  try {
    context = await chromium.launchPersistentContext(userDataDir, {
      channel: "chromium",
      headless: true,
      deviceScaleFactor: 2,
      viewport: { width: 1200, height: 800 },
      args: [
        `--disable-extensions-except=${EXTENSION_DIR}`,
        `--load-extension=${EXTENSION_DIR}`,
        `--host-resolver-rules=MAP ${SITE} 127.0.0.1:${SERVER_PORT},MAP ${OVER} 127.0.0.1:${SERVER_PORT}`,
        "--no-sandbox",
        "--disable-gpu",
      ],
      timeout: 60_000,
    });
    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker", { timeout: 30_000 }));
    const extensionId = new URL(worker.url()).host;

    const dash = await context.newPage();
    await dash.goto(`chrome-extension://${extensionId}/dashboard.html`);
    const vault = await encryptSecret(TEST_MNEMONIC, PASSWORD, 5_000);
    await dash.evaluate(async (v) => {
      await chrome.storage.local.set({ vault: v });
    }, vault);
    const settings: Partial<Settings> = {
      rpcUrl: anvil.rpcUrl,
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
    console.log("settings", JSON.stringify(await api(dash, "settings:set", { patch: settings })).slice(0, 80));
    console.log("unlock", JSON.stringify(await api(dash, "vault:unlock", { password: PASSWORD })).slice(0, 80));

    // Two real payments from the per-site address: a navigation and a fetch from page script.
    const article = await context.newPage();
    await article.goto(`http://${SITE}/paid`);
    await article.waitForFunction(() => document.body.innerText.includes('"ok":true'), null, { timeout: 120_000 });
    console.log("navigation paid");
    const fetchPage = await context.newPage();
    await fetchPage.goto(`http://${SITE}/fetch.html`);
    await fetchPage.waitForFunction(() => !document.getElementById("out")?.textContent?.startsWith("pending"), null, { timeout: 120_000 });
    console.log("fetch paid:", await fetchPage.evaluate(() => document.getElementById("out")?.textContent));
    await fetchPage.close();

    // Popup, with the article tab active so the site card shows it.
    const popup = await context.newPage();
    await popup.setViewportSize({ width: 360, height: 640 });
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    await article.bringToFront();
    await popup.reload();
    await popup.waitForSelector("text=settled", { timeout: 30_000 });
    await popup.waitForTimeout(500);
    const popupHeight = await popup.evaluate(() => Math.ceil(document.body.getBoundingClientRect().height) + 12);
    await popup.screenshot({ path: join(OUT, "popup.png"), clip: { x: 0, y: 0, width: 360, height: Math.min(640, popupHeight) } });
    console.log("popup captured");

    // Dashboard: budget and sites.
    await dash.setViewportSize({ width: 1200, height: 800 });
    await dash.reload();
    await dash.waitForSelector("text=Account", { timeout: 30_000 });
    await dash.waitForTimeout(800);
    await dash.screenshot({ path: join(OUT, "dashboard-budget.png") });
    await dash.getByRole("button", { name: "Sites" }).click();
    await dash.waitForTimeout(800);
    await dash.screenshot({ path: join(OUT, "dashboard-sites.png") });
    console.log("dashboard captured");

    // A price above the site cap opens the approval page.
    console.log("cap", JSON.stringify(await api(dash, "site:setCap", { origin: `http://${OVER}`, cap: "10000" })).slice(0, 60));
    const approvalPromise = context.waitForEvent("page", { predicate: (p) => p.url().includes("approve.html"), timeout: 60_000 });
    const over = await context.newPage();
    await over.goto(`http://${OVER}/fetch.html`);
    const approval = await approvalPromise;
    await approval.setViewportSize({ width: 520, height: 640 });
    await approval.waitForSelector("text=Payment over cap", { timeout: 30_000 });
    await approval.waitForTimeout(500);
    await approval.screenshot({ path: join(OUT, "approve.png") });
    console.log("approve captured");
  } finally {
    await context?.close().catch(() => undefined);
    rmSync(userDataDir, { recursive: true, force: true });
    await server.close();
    await anvil.stop();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
