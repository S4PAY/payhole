// Renders the nine thread banners (1200 by 675) in the site's visual language into static/brand/thread.
// Run from packages/website with Playwright available: node scripts/make-thread-banners.mjs
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "static", "brand", "thread");
mkdirSync(out, { recursive: true });
const logo = `data:image/png;base64,${readFileSync(join(root, "static", "logo.png")).toString("base64")}`;
const FONTS = `<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">`;
const CSS = `<style>
*{box-sizing:border-box}body{margin:0;background:#000;color:#fff;font-family:Inter,system-ui,sans-serif}
.f{position:relative;width:1200px;height:675px;overflow:hidden;background:#000;padding:56px 64px;display:flex;flex-direction:column;justify-content:space-between}
.glow{position:absolute;right:-260px;top:-260px;width:820px;height:820px;border-radius:50%;background:radial-gradient(circle,rgba(43,255,136,.20) 0%,rgba(43,255,136,.06) 40%,transparent 66%)}
.top{display:flex;justify-content:space-between;align-items:center;position:relative}
.brand{display:flex;align-items:center;gap:12px;font:600 24px 'Space Grotesk',sans-serif;letter-spacing:-0.03em}.brand img{width:30px;height:30px}
.n{font:500 14px 'JetBrains Mono',monospace;color:#A1A1AA;letter-spacing:.06em}
h1{margin:0;font:600 60px/1.05 'Space Grotesk',sans-serif;letter-spacing:-0.035em;max-width:760px;position:relative}
h1 em{font-style:normal;color:#2BFF88}
p{margin:16px 0 0;font:400 22px/1.45 Inter,sans-serif;color:#A1A1AA;max-width:640px;position:relative}
.art{position:absolute;right:64px;bottom:56px;width:380px;display:flex;flex-direction:column;gap:10px}
.card{background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.12);border-radius:12px;padding:16px 18px;backdrop-filter:blur(10px)}
.mono{font:500 15px 'JetBrains Mono',monospace}.muted{color:#A1A1AA}.acc{color:#2BFF88}
.row{display:flex;justify-content:space-between;gap:12px;align-items:center;font:500 15px 'JetBrains Mono',monospace}
.chip{display:inline-block;padding:8px 14px;border-radius:999px;border:1px solid rgba(255,255,255,.14);font:500 15px 'JetBrains Mono',monospace}
.chip.on{background:#2BFF88;color:#000;border-color:#2BFF88}
.foot{display:flex;justify-content:space-between;font:500 15px 'JetBrains Mono',monospace;color:#A1A1AA;position:relative}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.node{padding:14px;border:1px solid rgba(43,255,136,.35);border-radius:10px;background:rgba(43,255,136,.06);font:500 13px 'JetBrains Mono',monospace}
.node b{display:block;font:600 15px 'Space Grotesk',sans-serif;letter-spacing:-0.02em;margin-bottom:4px;color:#fff}
.bar{height:6px;border-radius:3px;background:rgba(255,255,255,.1);overflow:hidden}.bar i{display:block;height:100%;background:#2BFF88}
</style>`;

const posts = [
  { n: 1, h: `Not an <em>ad blocker.</em>`, p: `A browser that pays for things by itself, safely, and the tools that keep that safe.`, art: `<div class="card"><div class="muted mono">what is inside</div><div class="mono" style="margin-top:8px;line-height:1.9">pocket · 402 payments<br>one address per site<br>creator tips · agent keys<br>Sinkhole · burn-only token</div></div>` },
  { n: 2, h: `A pocket <em>with a cap.</em>`, p: `USDG on Robinhood Chain. The cap lives in the contract, so nothing can take more than you allowed.`, art: `<div class="card"><div class="row"><span class="muted">pocket</span><span>24.88 USDG</span></div><div class="row" style="margin-top:8px"><span class="muted">cap</span><span>100.00 USDG</span></div><div class="bar" style="margin-top:12px"><i style="width:25%"></i></div><div class="row" style="margin-top:8px"><span class="muted">spent today</span><span class="acc">0.12 USDG</span></div></div>` },
  { n: 3, h: `Pages that <em>pay themselves.</em>`, p: `A page asks for a cent over HTTP 402. The pocket pays it, the page loads. Under your cap you never see it.`, art: `<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap"><span class="chip">402</span><span class="muted mono">&rarr;</span><span class="chip">signed</span><span class="muted mono">&rarr;</span><span class="chip">settled</span><span class="muted mono">&rarr;</span><span class="chip on">200</span></div><div class="card" style="margin-top:8px"><div class="row"><span class="muted">/article/402</span><span class="acc">0.02 paid</span></div></div>` },
  { n: 4, h: `One address <em>per site.</em>`, p: `Derived from your seed for that site alone. A site sees what it was paid and nothing else.`, art: `<div class="card"><div class="row"><span>example.com</span><span class="muted">0x759B…8E5e</span></div><div class="row" style="margin-top:10px"><span>api.naven.network</span><span class="muted">0xF67F…4B61</span></div><div class="row" style="margin-top:10px"><span>payhole.org</span><span class="muted">0x9c1e…4a2f</span></div></div>` },
  { n: 5, h: `Creators get paid <em>per visit.</em>`, p: `One DNS record with your wallet, verified on payhole.org. Visitors with tips on pay you directly, no platform in the middle.`, art: `<div class="card mono"><span class="muted">_payhole.yourdomain</span>&nbsp; TXT<br><span class="acc">"payhole=0xYourWallet"</span></div><div class="card"><div class="row"><span class="muted">tip per visit</span><span>0.01 USDG</span></div></div>` },
  { n: 6, h: `Agents and scripts, <em>capped.</em>`, p: `The same pocket hands out session keys to tools and bots. They pay for APIs on their own, never above their cap, never holding your seed.`, art: `<div class="card mono" style="line-height:1.9"><span class="muted">$</span> payhole key create --cap 5<br><span class="acc">created</span> 0x9c1e…4a2f &nbsp;cap 5.00 USDG<br><span class="muted">$</span> payhole pay https://api.example/report<br><span class="acc">paid</span> 0.02 USDG &nbsp;tx 0x8e2c…91ab</div>` },
  { n: 7, h: `Trackers and drainers <em>die at DNS.</em>`, p: `Sinkhole runs on a Raspberry Pi, a Rock Pi, an old Helium hotspot, or a server, and every node learns from every other node.`, art: `<div class="grid"><div class="node"><b>worker-1</b>3 peers · blocking</div><div class="node"><b>worker-2</b>3 peers · blocking</div><div class="node"><b>worker-3</b>3 peers · blocking</div><div class="node"><b>jetson</b>3 peers · blocking</div></div>` },
  { n: 8, h: `Only ever bought <em>and burned.</em>`, p: `PAYHOLE unlocks tiers: bigger pockets, more keys, the right to report into the swarm. Nobody is paid, nothing is emitted.`, art: `<div class="card"><div class="row"><span>tier 1</span><span class="muted">50 USDG pocket · 5 keys</span></div><div class="row" style="margin-top:10px"><span>tier 2</span><span class="muted">500 USDG · 50 keys</span></div><div class="row" style="margin-top:10px"><span>tier 3</span><span class="muted">5,000 USDG · unlimited</span></div><div class="row" style="margin-top:12px"><span class="muted">every unlock</span><span class="acc">burned</span></div></div>` },
  { n: 9, h: `Open source. Verified. <em>Try it now.</em>`, p: `MIT license, contracts verified on chain and owned by a Safe. A real paid page is waiting at payhole.org/try.html.`, art: `<div class="card mono" style="line-height:1.9"><span class="muted">code</span> github.com/S4PAY/payhole<br><span class="muted">try</span> payhole.org/try.html<br><span class="muted">node</span> payhole.org/sinkhole.html<br><span class="muted">npm</span> @payhole/sdk</div>` },
];

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 675 }, deviceScaleFactor: 1 });
for (const post of posts) {
  const html = `<!doctype html><html><head><meta charset="utf-8">${FONTS}${CSS}</head><body><div class="f"><div class="glow"></div>
  <div class="top"><div class="brand"><img src="${logo}">PayHole</div><div class="n">${post.n} / ${posts.length}</div></div>
  <div style="position:relative;max-width:760px"><h1>${post.h}</h1><p>${post.p}</p></div>
  <div class="foot"><span>payhole.org · Robinhood Chain · USDG</span></div>
  <div class="art">${post.art}</div></div></body></html>`;
  await page.setContent(html, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(250);
  const file = join(out, `${post.n}.png`);
  await page.screenshot({ path: file, clip: { x: 0, y: 0, width: 1200, height: 675 } });
  console.log("wrote", file.split("/").slice(-2).join("/"));
}
await browser.close();
