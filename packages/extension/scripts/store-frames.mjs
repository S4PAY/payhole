// Composes the Chrome Web Store images from the raw captures in store/raw and the banner artwork.
// Run from packages/extension after scripts/store-shots.ts: node scripts/store-frames.mjs
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const raw = join(root, "store", "raw");
const out = join(root, "store");
mkdirSync(out, { recursive: true });
const data = (file) => `data:image/${file.endsWith(".jpg") ? "jpeg" : "png"};base64,${readFileSync(file).toString("base64")}`;
const FONTS = `<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@600&family=Inter:wght@400;500&family=JetBrains+Mono:wght@400&display=swap" rel="stylesheet">`;
const BASE = `<style>
*{box-sizing:border-box}body{margin:0;background:#000;color:#fff;font-family:Inter,system-ui,sans-serif;overflow:hidden}
.frame{position:relative;width:1280px;height:800px;background:#000;overflow:hidden}
.glow{position:absolute;right:-220px;bottom:-320px;width:900px;height:900px;border-radius:50%;background:radial-gradient(circle,rgba(43,255,136,.22) 0%,rgba(43,255,136,.08) 35%,transparent 65%)}
.shot{position:absolute;border:1px solid rgba(255,255,255,.12);border-radius:14px;box-shadow:0 30px 80px rgba(0,0,0,.7);overflow:hidden;background:#000}
.shot img{display:block}
h1{margin:0;font:600 46px/1.08 'Space Grotesk',sans-serif;letter-spacing:-0.03em}
p{margin:14px 0 0;font:400 19px/1.5 Inter,sans-serif;color:#A1A1AA;max-width:520px}
.brand{position:absolute;left:64px;top:52px;display:flex;align-items:center;gap:10px;font:600 22px 'Space Grotesk',sans-serif;letter-spacing:-0.03em}
.brand img{width:26px;height:26px}
</style>`;
const logo = data(join(root, "public", "logo.png"));

const shots = [
  { file: "popup.png", name: "1-pages-pay-themselves.png", side: true, h1: "Pages pay themselves.", p: "A site answers 402, the pocket settles it in USDG, the page loads. Under the cap you never see it." },
  { file: "dashboard-budget.png", name: "2-one-pocket-capped.png", side: false, h1: "One pocket, capped.", p: "Fund a BudgetAccount with USDG. Every site gets its own address, topped up in small chunks from the pocket." },
  { file: "dashboard-sites.png", name: "3-per-site-caps.png", side: false, h1: "Per-site caps you control.", p: "Set a cap per site, block a site, read the ledger. Nothing spends past what you allowed." },
  { file: "approve.png", name: "4-over-the-cap-one-prompt.png", side: true, h1: "Over the cap? One prompt.", p: "A price above the site cap asks you first. Pay once, or deny. Caps stay where you put them." },
];

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
for (const s of shots) {
  const img = data(join(raw, s.file));
  const body = s.side
    ? `<div class="frame"><div class="glow"></div><div class="brand"><img src="${logo}">PayHole</div>
       <div style="position:absolute;left:64px;top:280px;width:520px"><h1>${s.h1}</h1><p>${s.p}</p></div>
       <div class="shot" style="right:88px;top:80px;height:640px"><img src="${img}" style="height:640px"></div></div>`
    : `<div class="frame"><div class="glow"></div><div class="brand"><img src="${logo}">PayHole</div>
       <div style="position:absolute;left:64px;top:110px;width:1100px;display:flex;align-items:flex-end;gap:40px"><h1 style="max-width:520px">${s.h1}</h1><p style="margin:0 0 6px">${s.p}</p></div>
       <div class="shot" style="left:64px;right:64px;top:300px;height:560px;border-bottom:0;border-radius:14px 14px 0 0"><img src="${img}" style="width:1152px"></div></div>`;
  await page.setContent(`<!doctype html><html><head><meta charset="utf-8">${FONTS}${BASE}</head><body>${body}</body></html>`, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(out, s.name), clip: { x: 0, y: 0, width: 1280, height: 800 } });
  console.log("wrote", s.name);
}

// Promo tile 440x280 and marquee 1400x560 from the banner artwork.
const banner = data(join(root, "assets", "brand", "banner.png"));
for (const [name, w, h, pos] of [["promo-small-440x280.png", 440, 280, "38% 50%"], ["promo-marquee-1400x560.png", 1400, 560, "50% 45%"]]) {
  await page.setViewportSize({ width: w, height: h });
  await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0;background:#000}img{display:block;width:${w}px;height:${h}px;object-fit:cover;object-position:${pos}}</style></head><body><img src="${banner}"></body></html>`);
  await page.waitForTimeout(200);
  await page.screenshot({ path: join(out, name), clip: { x: 0, y: 0, width: w, height: h } });
  console.log("wrote", name);
}
await browser.close();
