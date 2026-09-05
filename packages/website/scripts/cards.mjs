// Renders 1200 by 630 social cards (Open Graph and X) for pages and blog posts, in the thread-banner style.
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { chromium } from "playwright";

const FONTS = `<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600&family=Inter:wght@400;500&family=JetBrains+Mono:wght@500&display=swap" rel="stylesheet">`;
const CSS = `<style>
*{box-sizing:border-box}body{margin:0;background:#000;color:#fff;font-family:Inter,system-ui,sans-serif}
.f{position:relative;width:1200px;height:630px;overflow:hidden;background:#000;padding:56px 64px;display:flex;flex-direction:column;justify-content:space-between}
.glow{position:absolute;right:-260px;top:-280px;width:860px;height:860px;border-radius:50%;background:radial-gradient(circle,rgba(43,255,136,.22) 0%,rgba(43,255,136,.07) 40%,transparent 66%)}
.top{display:flex;justify-content:space-between;align-items:center;position:relative}
.brand{display:flex;align-items:center;gap:12px;font:600 26px 'Space Grotesk',sans-serif;letter-spacing:-0.03em}.brand img{width:32px;height:32px}
.tag{font:500 15px 'JetBrains Mono',monospace;color:#A1A1AA;letter-spacing:.06em;text-transform:uppercase}
h1{margin:0;font:600 58px/1.06 'Space Grotesk',sans-serif;letter-spacing:-0.035em;max-width:1000px;position:relative}
h1 em{font-style:normal;color:#2BFF88}
p{margin:18px 0 0;font:400 23px/1.45 Inter,sans-serif;color:#A1A1AA;max-width:880px;position:relative}
.foot{font:500 16px 'JetBrains Mono',monospace;color:#A1A1AA;position:relative}
</style>`;

function esc(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Wraps the last two words in the accent color when the headline has no explicit marker. */
function headline(h) {
  if (h.includes("<em>")) return h;
  const words = esc(h).split(" ");
  if (words.length < 3) return esc(h);
  return `${words.slice(0, -2).join(" ")} <em>${words.slice(-2).join(" ")}</em>`;
}

/** items: [{ file, tag, title, text }] where file is the absolute output path. */
export async function renderCards(root, items) {
  const logo = `data:image/png;base64,${readFileSync(join(root, "static", "logo.png")).toString("base64")}`;
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
  for (const it of items) {
    mkdirSync(dirname(it.file), { recursive: true });
    const size = it.title.length > 60 ? 48 : it.title.length > 40 ? 54 : 58;
    await page.setContent(`<!doctype html><html><head><meta charset="utf-8">${FONTS}${CSS}</head><body><div class="f"><div class="glow"></div>
      <div class="top"><div class="brand"><img src="${logo}">PayHole</div><div class="tag">${esc(it.tag)}</div></div>
      <div style="position:relative"><h1 style="font-size:${size}px">${headline(it.title)}</h1><p>${esc(it.text)}</p></div>
      <div class="foot">payhole.org</div></div></body></html>`, { waitUntil: "networkidle" });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(150);
    await page.screenshot({ path: it.file, clip: { x: 0, y: 0, width: 1200, height: 630 } });
  }
  await browser.close();
  return items.length;
}

/** Cards for the fixed pages; keys are the page file names without .html. */
export const PAGE_CARDS = {
  sinkhole: { tag: "Sinkhole", title: "Run a node. Trackers and drainers die at DNS.", text: "A self-hosted resolver with a swarm. Any 64-bit ARM board with 2 GB, one container, every device on your network." },
  try: { tag: "Try it", title: "This article costs 0.01 USDG.", text: "A real page behind a real 402. With PayHole installed it pays for itself. Without it you see what every paying page starts with." },
  extension: { tag: "Extension", title: "A capped USDG pocket for your browser.", text: "Pages that ask for a cent get paid from an address that exists only for that site, never past your cap." },
  token: { tag: "Token", title: "Only ever bought and burned.", text: "PAYHOLE unlocks tiers: bigger pockets, more keys, the right to report into the swarm. No emissions, no rewards." },
  creators: { tag: "Creators", title: "Get paid per visit, in USDG.", text: "One DNS record with your wallet, verified on payhole.org. Visitors with tips on pay you directly, no platform in the middle." },
  developers: { tag: "Developers", title: "Accept payments with one header.", text: "Answer 402 with a price, verify and settle through any x402 facilitator on Robinhood Chain. SDK, CLI, and docs." },
  trust: { tag: "Trust", title: "Open source. Verified. Owned by a Safe.", text: "Three contracts on Robinhood Chain, all verified on Sourcify. Read them before you fund a pocket." },
  docs: { tag: "Documentation", title: "The SDK, the CLI, and x402 on your server.", text: "payholeFetch, capped session keys for agents, and the exact headers a paying page returns." },
  blog: { tag: "Blog", title: "Release notes and progress.", text: "What shipped, what changed, and why. From the extension and the contracts to Sinkhole and the token." },
};
