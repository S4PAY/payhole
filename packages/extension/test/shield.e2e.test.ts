/**
 * End-to-end for the shield and the wallet guard: loads `.output/chrome-mv3` into headless Chromium through
 * Playwright, points the extension at a mock resolver, and walks a clean site, a listed site, the wall, "open
 * once", the in-page rules, and a fake wallet's requests. Skipped with a reason when the build output is missing
 * or Chromium cannot start here (see README, "End-to-end test").
 */
import { createServer, type Server } from "node:http";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type * as Playwright from "playwright";
import type { BrowserContext, Page } from "playwright";

const here = dirname(fileURLToPath(import.meta.url));
const EXTENSION_DIR = join(here, "..", ".output", "chrome-mv3");
const PORT = 8595;
const DRAINER = "0x101ce0cedd142f199c9ef61739ae59b6611a0fc0";
const TOKEN = "0x5fc5360d0400a0fd4f2af552add042d716f1d168";
const ROUTER = "0x" + "9".repeat(40);

declare const chrome: {
  storage: { local: { get(key: string): Promise<Record<string, unknown>>; set(items: Record<string, unknown>): Promise<void> } };
  declarativeNetRequest: { getDynamicRules(): Promise<{ id: number; condition: { urlFilter?: string } }[]> };
};

declare global {
  interface Window {
    ethereum: { request(args: unknown): Promise<unknown> };
    calls: unknown[];
  }
}

let skipReason: string | null = existsSync(join(EXTENSION_DIR, "manifest.json")) ? null : `no build at ${EXTENSION_DIR}; run "pnpm build" first`;
let context: BrowserContext | undefined;
let server: Server | undefined;
let extensionId = "";
let userDataDir = "";
const seen: string[] = [];

const listed = { domain: "drain.evil", blocked: true, allowlisted: false, category: "drainer", sources: ["list", "swarm"], reasons: ["ScamSniffer"], reporters: 3, confirmed: true };

function startResolver(): Promise<void> {
  server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", `http://127.0.0.1:${PORT}`);
    seen.push(`${req.method} ${url.pathname}${url.search}`);
    res.setHeader("content-type", "application/json");
    if (url.pathname === "/verdict") {
      const name = url.searchParams.get("name") ?? "";
      res.end(JSON.stringify(name === "drain.evil" ? { ...listed, checkedAt: Date.now() } : { domain: name, blocked: false, allowlisted: false, category: null, sources: [], reasons: [], reporters: 0, confirmed: false, checkedAt: Date.now() }));
      return;
    }
    if (url.pathname === "/address") {
      const address = (url.searchParams.get("address") ?? "").toLowerCase();
      const bad = address === DRAINER;
      res.end(JSON.stringify({ address, flagged: bad, category: bad ? "drainer" : null, sources: bad ? ["list"] : [], label: bad ? "ScamSniffer" : null, checkedAt: Date.now() }));
      return;
    }
    if (url.pathname === "/lists/payhole.txt") {
      res.setHeader("content-type", "text/plain");
      res.end("infra.evil\n");
      return;
    }
    if (url.pathname === "/report") {
      let body = "";
      req.on("data", (chunk: Buffer) => (body += chunk.toString()));
      req.on("end", () => {
        const parsed = JSON.parse(body) as { name?: string; address?: string; key?: string; signature?: string };
        seen.push(`report ${parsed.name ?? parsed.address ?? "?"} signed=${typeof parsed.signature === "string" && typeof parsed.key === "string"}`);
        res.end(JSON.stringify({ status: "hinted", domain: parsed.name ?? parsed.address, hints: 1 }));
      });
      return;
    }
    res.statusCode = 404;
    res.end("{}");
  });
  return new Promise((resolve) => server?.listen(PORT, "127.0.0.1", resolve));
}

async function launch(): Promise<void> {
  let playwright: typeof Playwright;
  try {
    playwright = await import("playwright");
  } catch (error) {
    skipReason = `playwright is not installed: ${error instanceof Error ? error.message : String(error)}`;
    return;
  }
  userDataDir = mkdtempSync(join(tmpdir(), "payhole-shield-"));
  try {
    context = await playwright.chromium.launchPersistentContext(userDataDir, {
      channel: "chromium",
      headless: true,
      viewport: { width: 1100, height: 600 },
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
  await context.route(/^http:\/\/(drain\.evil|fine\.example|infra\.evil)\//, (route) => route.fulfill({ status: 200, contentType: "text/html", body: `<title>${new URL(route.request().url()).host}</title>` }));
  await context.route(/^http:\/\/dapp\.example\//, (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/html",
      body: `<title>dapp</title><script>window.calls = []; window.ethereum = { request: (args) => { window.calls.push(args); return Promise.resolve("0xtx"); } };</script><img id="beacon" src="http://infra.evil/pixel.png">`,
    }),
  );
  const setup = await context.newPage();
  await setup.goto(`chrome-extension://${extensionId}/dashboard.html`);
  await setup.evaluate(async (resolver) => {
    const got = await chrome.storage.local.get("settings");
    const current = got["settings"];
    const base = typeof current === "object" && current !== null ? current : {};
    await chrome.storage.local.set({ settings: { ...base, shield: { enabled: true, resolver } } });
  }, `http://127.0.0.1:${PORT}`);
  await setup.waitForTimeout(800);
  await setup.close();
}

beforeAll(async () => {
  if (skipReason) return;
  await startResolver();
  await launch();
});

afterAll(async () => {
  await context?.close().catch(() => undefined);
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  if (userDataDir) rmSync(userDataDir, { recursive: true, force: true });
});

function page(): Promise<Page> {
  if (!context) throw new Error("no browser");
  return context.newPage();
}

describe("the shield in Chromium", () => {
  it("lets a clean site load and walls a listed one, first through the resolver and then through a rule", async (ctx) => {
    if (skipReason) return ctx.skip();
    const tab = await page();
    await tab.goto("http://fine.example/");
    expect(tab.url()).toBe("http://fine.example/");

    // The redirect to the wall aborts the navigation in flight; the URL is what counts.
    await tab.goto("http://drain.evil/claim?x=1&y=2").catch(() => undefined);
    await expect.poll(() => tab.url(), { timeout: 15_000 }).toMatch(/check\.html/);
    expect(tab.url()).toBe(`chrome-extension://${extensionId}/check.html?u=http://drain.evil/claim?x=1&y=2`);
    await tab.getByRole("button", { name: "Go back" }).waitFor();
    expect(await tab.locator(".subject").innerText()).toBe("drain.evil");

    const again = await page();
    await again.goto("http://drain.evil/again").catch(() => undefined);
    await expect.poll(() => again.url(), { timeout: 15_000 }).toContain("check.html?u=http://drain.evil/again");
    await again.close();

    await tab.getByRole("button", { name: "Open once, 10 minutes" }).click();
    await expect.poll(() => tab.url(), { timeout: 15_000 }).toMatch(/^http:\/\/drain\.evil\//);
    await expect.poll(() => tab.title()).toBe("drain.evil");
    await tab.close();
  });

  it("drops requests inside pages to names on the PayHole list", async (ctx) => {
    if (skipReason) return ctx.skip();
    const setup = await page();
    await setup.goto(`chrome-extension://${extensionId}/dashboard.html`);
    await setup.waitForFunction(async () => (await chrome.declarativeNetRequest.getDynamicRules()).some((rule) => rule.condition.urlFilter === "||infra.evil^"), undefined, { timeout: 15_000 });
    await setup.close();
    const tab = await page();
    await tab.goto("http://dapp.example/");
    const failed = await tab.evaluate(() => new Promise<boolean>((resolve) => {
      const img = document.getElementById("beacon") as HTMLImageElement;
      if (img.complete) return resolve(img.naturalWidth === 0);
      img.addEventListener("error", () => resolve(true));
      img.addEventListener("load", () => resolve(false));
    }));
    expect(failed).toBe(true);
    await tab.close();
  });

  it("stops a send to a listed address, lets a clean one through, and warns once on an unlimited approval", async (ctx) => {
    if (skipReason) return ctx.skip();
    const dapp = await page();
    await dapp.goto("http://dapp.example/");
    await dapp.waitForTimeout(700);
    const call = (params: unknown) => dapp.evaluate((p) => window.ethereum.request({ method: "eth_sendTransaction", params: p }).then(() => "resolved", (e: { code?: number }) => `rejected:${e.code}`), params);

    const stopping = call([{ to: DRAINER, value: "0x1" }]);
    await dapp.getByRole("button", { name: "Stop" }).click();
    expect(await stopping).toBe("rejected:4001");
    expect(await call([{ to: TOKEN, value: "0x1" }])).toBe("resolved");

    const approval = `0x095ea7b3${ROUTER.slice(2).padStart(64, "0")}${"f".repeat(64)}`;
    const warning = call([{ to: TOKEN, data: approval }]);
    await dapp.getByRole("button", { name: "Continue", exact: true }).click();
    expect(await warning).toBe("resolved");
    expect(await call([{ to: TOKEN, data: approval }])).toBe("resolved");
    expect(await dapp.evaluate(() => window.calls.length)).toBe(3);
    await dapp.close();
  });

  it("checks and reports from the popup with a signed hint", async (ctx) => {
    if (skipReason) return ctx.skip();
    const popup = await page();
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    await popup.fill("input[type=text]", "fine.example");
    await popup.getByRole("button", { name: "Check", exact: true }).click();
    await popup.waitForSelector("text=Not on any list");
    await popup.getByRole("button", { name: "Send report" }).click();
    await popup.waitForSelector("text=Counted");
    expect(seen.some((line) => line === "report fine.example signed=true")).toBe(true);
    await popup.close();
  });
});
