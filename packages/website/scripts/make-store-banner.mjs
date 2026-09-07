// Renders the "on the Chrome Web Store" banner (1200 by 675) in the site's visual language into static/brand.
// The Chrome mark is drawn here as plain geometry, three wedges and a blue centre, to say where the extension is.
// Run from packages/website with Playwright available: node scripts/make-store-banner.mjs
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "static", "brand", "chrome-web-store.png");
const data = (file) => `data:image/png;base64,${readFileSync(file).toString("base64")}`;
const logo = data(join(root, "static", "logo.png"));
const FONTS = `<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">`;
const html = `<!doctype html><html><head><meta charset="utf-8">${FONTS}<style>
*{box-sizing:border-box}body{margin:0;background:#000;color:#fff;font-family:Inter,system-ui,sans-serif}
.f{position:relative;width:1200px;height:675px;overflow:hidden;background:#000;padding:56px 64px;display:flex;flex-direction:column;justify-content:space-between}
.glow{position:absolute;right:-260px;top:-260px;width:820px;height:820px;border-radius:50%;background:radial-gradient(circle,rgba(43,255,136,.20) 0%,rgba(43,255,136,.06) 40%,transparent 66%)}
.brand{display:flex;align-items:center;gap:12px;font:600 24px 'Space Grotesk',sans-serif;letter-spacing:-0.03em;position:relative}.brand img{width:30px;height:30px}
h1{margin:0;font:600 62px/1.05 'Space Grotesk',sans-serif;letter-spacing:-0.035em;max-width:700px;position:relative}
h1 em{font-style:normal;color:#2BFF88}
p{margin:18px 0 0;font:400 22px/1.45 Inter,sans-serif;color:#A1A1AA;max-width:640px;position:relative}
.foot{display:flex;justify-content:space-between;align-items:flex-end;font:500 15px 'JetBrains Mono',monospace;color:#A1A1AA;position:relative}
.store{position:absolute;right:64px;bottom:56px;display:flex;align-items:center;gap:22px;padding:22px 30px 22px 24px;border-radius:18px;border:1px solid rgba(255,255,255,.16);background:rgba(255,255,255,.05);backdrop-filter:blur(10px)}
.store svg{display:block;flex:none}
.store .t{display:flex;flex-direction:column;gap:4px}
.store .s{font:500 13px 'JetBrains Mono',monospace;color:#A1A1AA;letter-spacing:.08em;text-transform:uppercase}
.store .b{font:600 30px/1.1 'Space Grotesk',sans-serif;letter-spacing:-0.03em;color:#fff}
.chips{display:flex;gap:10px;margin-top:26px;position:relative}
.chip{display:inline-block;padding:9px 14px;border-radius:999px;border:1px solid rgba(255,255,255,.14);font:500 15px 'JetBrains Mono',monospace;color:#fff}
.chip.on{background:#2BFF88;color:#000;border-color:#2BFF88}
</style></head><body><div class="f"><div class="glow"></div>
<div class="brand"><img src="${logo}">PayHole</div>
<div style="position:relative"><h1>Now on the <em>Chrome Web Store.</em></h1><p>Scam links stop loading. Drainers stop before your wallet opens. The same protection as the Android app, in Chrome, Brave, Edge, and every Chromium browser.</p>
<div class="chips"><span class="chip on">shield</span><span class="chip">wallet guard</span><span class="chip">check any link</span><span class="chip">reports that pay</span></div></div>
<div class="foot"><span>payhole.org/extension.html</span></div>
<div class="store"><svg viewBox="0 0 100 100" width="132" height="132" xmlns="http://www.w3.org/2000/svg"><path d="M50 50 L6.70 25.00 A50 50 0 0 1 93.30 25.00 Z" fill="#EA4335"/><path d="M50 50 L93.30 25.00 A50 50 0 0 1 50.00 100.00 Z" fill="#FBBC04"/><path d="M50 50 L50.00 100.00 A50 50 0 0 1 6.70 25.00 Z" fill="#34A853"/><circle cx="50" cy="50" r="27" fill="#fff"/><circle cx="50" cy="50" r="20.5" fill="#4285F4"/></svg><div class="t"><span class="s">Available in the</span><span class="b">Chrome Web Store</span></div></div></div></body></html>`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 675 }, deviceScaleFactor: 1 });
await page.setContent(html, { waitUntil: "networkidle" });
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(250);
await page.screenshot({ path: out, clip: { x: 0, y: 0, width: 1200, height: 675 } });
await browser.close();
console.log("wrote", out.split("/").slice(-3).join("/"));
