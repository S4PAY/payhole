// Renders the comparison sheet (1200 by 675): PayHole beside the DNS blockers people already know, marked
// honestly. A hollow mark means "with lists you add yourself" or "partly". Output: static/brand/compare.png
// Run from packages/website with Playwright available: node scripts/make-compare-banner.mjs
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "static", "brand", "compare.png");
const logo = `data:image/png;base64,${readFileSync(join(root, "static", "logo.png")).toString("base64")}`;
const FONTS = `<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">`;

const YES = `<svg viewBox="0 0 24 24" width="22" height="22"><circle cx="12" cy="12" r="11" fill="#2BFF88"/><path d="M7 12.5l3.2 3.2L17 9" fill="none" stroke="#000" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const PART = `<svg viewBox="0 0 24 24" width="22" height="22"><circle cx="12" cy="12" r="10" fill="none" stroke="#2BFF88" stroke-width="2"/><circle cx="12" cy="12" r="4" fill="#2BFF88"/></svg>`;
const NO = `<svg viewBox="0 0 24 24" width="22" height="22"><path d="M7 12h10" stroke="#52525B" stroke-width="2.6" stroke-linecap="round"/></svg>`;
const M = { y: YES, p: PART, n: NO };

const columns = ["PayHole", "Pi-hole", "AdGuard Home", "NextDNS", "Quad9"];
const rows = [
  ["Blocks ads and trackers", "y", "y", "y", "y", "n"],
  ["Blocks wallet drainers and crypto phishing", "y", "p", "p", "p", "p"],
  ["Runs on your own box at home", "y", "y", "y", "n", "n"],
  ["Public encrypted resolver, zero setup on a phone", "y", "n", "n", "y", "y"],
  ["Nodes confirm each other's finds", "y", "n", "n", "n", "n"],
  ["Every block named: drainer, phishing, counterfeit", "y", "n", "n", "p", "n"],
  ["Report a link from your phone, paid if confirmed", "y", "n", "n", "n", "n"],
  ["Stops drainers in the browser before the wallet opens", "y", "n", "n", "n", "n"],
  ["Open source", "y", "y", "y", "n", "n"],
];

const html = `<!doctype html><html><head><meta charset="utf-8">${FONTS}<style>
*{box-sizing:border-box}body{margin:0;background:#000;color:#fff;font-family:Inter,system-ui,sans-serif}
.f{position:relative;width:1200px;height:675px;overflow:hidden;background:#000;padding:44px 56px 40px}
.glow{position:absolute;right:-260px;top:-260px;width:820px;height:820px;border-radius:50%;background:radial-gradient(circle,rgba(43,255,136,.18) 0%,rgba(43,255,136,.05) 40%,transparent 66%)}
.top{display:flex;justify-content:space-between;align-items:flex-end;position:relative;margin-bottom:22px}
.brand{display:flex;align-items:center;gap:12px;font:600 24px 'Space Grotesk',sans-serif;letter-spacing:-0.03em}.brand img{width:30px;height:30px}
h1{margin:0;font:600 40px/1.05 'Space Grotesk',sans-serif;letter-spacing:-0.035em}
h1 em{font-style:normal;color:#2BFF88}
table{position:relative;width:100%;border-collapse:collapse;font:400 17px Inter,sans-serif}
th{font:500 12px 'JetBrains Mono',monospace;letter-spacing:.08em;text-transform:uppercase;color:#A1A1AA;padding:0 0 10px;text-align:center;font-weight:500}
th:first-child{text-align:left}
th.ph{color:#2BFF88}
td{padding:9px 0;border-top:1px solid rgba(255,255,255,.08);text-align:center;vertical-align:middle}
td:first-child{text-align:left;color:#E4E4E7;padding-right:16px}
td svg{display:inline-block;vertical-align:middle}
td.ph{background:rgba(43,255,136,.06)}
th.ph{background:rgba(43,255,136,.06);border-radius:10px 10px 0 0;padding-top:8px}
tr:last-child td.ph{border-radius:0 0 10px 10px}
.foot{display:flex;justify-content:space-between;align-items:center;margin-top:16px;font:500 13px 'JetBrains Mono',monospace;color:#A1A1AA;position:relative}
.legend{display:flex;gap:18px;align-items:center}.legend span{display:inline-flex;align-items:center;gap:6px}
.legend svg{width:16px;height:16px}
</style></head><body><div class="f"><div class="glow"></div>
<div class="top"><div><div class="brand" style="margin-bottom:12px"><img src="${logo}">PayHole</div><h1>The DNS blockers, <em>side by side.</em></h1></div></div>
<table><thead><tr><th></th>${columns.map((c, i) => `<th class="${i === 0 ? "ph" : ""}">${c}</th>`).join("")}</tr></thead>
<tbody>${rows.map((r) => `<tr><td>${r[0]}</td>${r.slice(1).map((m, i) => `<td class="${i === 0 ? "ph" : ""}">${M[m]}</td>`).join("")}</tr>`).join("")}</tbody></table>
<div class="foot"><div class="legend"><span>${YES} yes</span><span>${PART} partly, or with lists you add yourself</span><span>${NO} no</span></div><span>payhole.org · September 2026</span></div>
</div></body></html>`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 675 }, deviceScaleFactor: 1 });
await page.setContent(html, { waitUntil: "networkidle" });
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(250);
await page.screenshot({ path: out, clip: { x: 0, y: 0, width: 1200, height: 675 } });
await browser.close();
console.log("wrote", out.split("/").slice(-3).join("/"));
