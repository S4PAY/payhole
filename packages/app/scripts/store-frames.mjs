// Composes the Play Store images from the emulator captures in store/raw: five 1080x1920 phone
// screenshots with a caption, the 1024x500 feature graphic, and the 512x512 icon.
// Run from packages/app: node scripts/store-frames.mjs
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const { chromium } = createRequire(join(root, "..", "website", "package.json"))("playwright");
const raw = join(root, "store", "raw");
const out = join(root, "store");
mkdirSync(out, { recursive: true });
const data = (file) => `data:image/png;base64,${readFileSync(file).toString("base64")}`;
const logo = data(join(root, "assets", "logo.png"));
const icon = data(join(root, "assets", "icon.png"));
const FONTS = `<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@600&family=Inter:wght@400;500&family=JetBrains+Mono:wght@400&display=swap" rel="stylesheet">`;
const CSS = `<style>
*{box-sizing:border-box}body{margin:0;background:#000;color:#fff;font-family:Inter,system-ui,sans-serif;overflow:hidden}
.frame{position:relative;width:1080px;height:1920px;background:#000;overflow:hidden}
.glow{position:absolute;left:50%;top:1150px;width:1400px;height:1400px;margin-left:-700px;border-radius:50%;background:radial-gradient(circle,rgba(43,255,136,.20) 0%,rgba(43,255,136,.07) 35%,transparent 65%)}
.brand{position:absolute;left:72px;top:72px;display:flex;align-items:center;gap:14px;font:600 34px 'Space Grotesk',sans-serif;letter-spacing:-0.03em}
.brand img{width:40px;height:40px}
h1{position:absolute;left:72px;right:72px;top:190px;margin:0;font:600 78px/1.06 'Space Grotesk',sans-serif;letter-spacing:-0.035em}
h1 em{font-style:normal;color:#2BFF88}
p{position:absolute;left:72px;right:72px;top:420px;margin:0;font:400 31px/1.45 Inter,sans-serif;color:#A1A1AA}
.shot{position:absolute;left:50%;top:600px;width:640px;margin-left:-320px;border-radius:38px;border:2px solid rgba(255,255,255,.14);box-shadow:0 40px 100px rgba(0,0,0,.75),0 0 120px rgba(43,255,136,.15);overflow:hidden;background:#000}
.shot img{display:block;width:640px}
</style>`;

const shots = [
  { file: "home-on.png", name: "1-one-tap.png", h1: "One tap. <em>Every app covered.</em>", p: "A DNS-only tunnel sends every lookup on the phone, encrypted, to a resolver that drops wallet drainers, phishing pages, and trackers." },
  { file: "check.png", name: "2-share-to-check.png", h1: "Share a link. <em>Get the verdict.</em>", p: "From any app, share to PayHole: blocked or not, what kind of threat, and who confirmed it. Share the answer back." },
  { file: "notification.png", name: "3-drainer-stopped.png", h1: "A stopped drainer <em>gets a notification.</em>", p: "Trackers go quietly. When PayHole stops a wallet drainer or a phishing page, it tells you what it was." },
  { file: "blocked.png", name: "4-every-block-named.png", h1: "Every block, <em>named.</em>", p: "The last names it stopped, each with its category. Tap one for the full verdict and a way to report a mistake." },
  { file: "radar.png", name: "5-radar.png", h1: "What the network <em>learned today.</em>", p: "Swarm confirmations, list growth, and the brands the new names impersonate. Never built from your lookups." },
];

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
for (const s of shots) {
  await page.setContent(`<!doctype html><html><head><meta charset="utf-8">${FONTS}${CSS}</head><body><div class="frame"><div class="glow"></div>
    <div class="brand"><img src="${logo}">PayHole</div><h1>${s.h1}</h1><p>${s.p}</p>
    <div class="shot"><img src="${data(join(raw, s.file))}"></div></div></body></html>`, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(150);
  await page.screenshot({ path: join(out, s.name), clip: { x: 0, y: 0, width: 1080, height: 1920 } });
}

const feature = await browser.newPage({ viewport: { width: 1024, height: 500 }, deviceScaleFactor: 1 });
await feature.setContent(`<!doctype html><html><head><meta charset="utf-8">${FONTS}<style>
*{box-sizing:border-box}body{margin:0;background:#000;color:#fff;overflow:hidden}
.f{position:relative;width:1024px;height:500px;background:#000;overflow:hidden}
.glow{position:absolute;right:-260px;top:-260px;width:820px;height:820px;border-radius:50%;background:radial-gradient(circle,rgba(43,255,136,.26) 0%,rgba(43,255,136,.08) 35%,transparent 65%)}
.brand{position:absolute;left:64px;top:56px;display:flex;align-items:center;gap:12px;font:600 26px 'Space Grotesk',sans-serif;letter-spacing:-0.03em}
.brand img{width:32px;height:32px}
h1{position:absolute;left:64px;top:150px;margin:0;font:600 64px/1.05 'Space Grotesk',sans-serif;letter-spacing:-0.035em;width:620px}
h1 em{font-style:normal;color:#2BFF88}
p{position:absolute;left:64px;top:320px;margin:0;font:400 22px/1.45 Inter,sans-serif;color:#A1A1AA;width:600px}
.icon{position:absolute;right:88px;top:118px;width:264px;height:264px;border-radius:58px;overflow:hidden;box-shadow:0 30px 80px rgba(0,0,0,.7),0 0 100px rgba(43,255,136,.2)}
.icon img{display:block;width:264px;height:264px}
</style></head><body><div class="f"><div class="glow"></div><div class="brand"><img src="${logo}">PayHole</div>
<h1>Drainers die <em>at DNS.</em></h1><p>Encrypted DNS for every app on the phone. Share any link for a verdict. No account, no analytics.</p>
<div class="icon"><img src="${icon}"></div></div></body></html>`, { waitUntil: "networkidle" });
await feature.evaluate(() => document.fonts.ready);
await feature.waitForTimeout(150);
await feature.screenshot({ path: join(out, "feature-graphic-1024x500.png"), clip: { x: 0, y: 0, width: 1024, height: 500 } });

const iconPage = await browser.newPage({ viewport: { width: 512, height: 512 }, deviceScaleFactor: 1 });
await iconPage.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0;background:#000}img{display:block;width:512px;height:512px}</style></head><body><img src="${icon}"></body></html>`);
await iconPage.screenshot({ path: join(out, "icon-512.png"), clip: { x: 0, y: 0, width: 512, height: 512 } });
await browser.close();
writeFileSync(join(out, ".gitkeep"), "");
console.log("store images written");
