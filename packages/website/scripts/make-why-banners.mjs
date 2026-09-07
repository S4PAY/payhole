// Renders the four "why PayHole" banners (1200 by 675) into static/brand/why: the problem, why names, why we built
// it, what it is not. Run from packages/website with Playwright available: node scripts/make-why-banners.mjs
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "static", "brand", "why");
mkdirSync(out, { recursive: true });
const logo = `data:image/png;base64,${readFileSync(join(root, "static", "logo.png")).toString("base64")}`;
const FONTS = `<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">`;
const CSS = `<style>
*{box-sizing:border-box}body{margin:0;background:#000;color:#fff;font-family:Inter,system-ui,sans-serif}
.f{position:relative;width:1200px;height:675px;overflow:hidden;background:#000;padding:56px 64px;display:flex;flex-direction:column;justify-content:space-between}
.glow{position:absolute;right:-260px;top:-260px;width:820px;height:820px;border-radius:50%;background:radial-gradient(circle,rgba(43,255,136,.20) 0%,rgba(43,255,136,.06) 40%,transparent 66%)}
.glow.red{background:radial-gradient(circle,rgba(255,77,77,.16) 0%,rgba(255,77,77,.05) 40%,transparent 66%)}
.top{display:flex;justify-content:space-between;align-items:center;position:relative}
.brand{display:flex;align-items:center;gap:12px;font:600 24px 'Space Grotesk',sans-serif;letter-spacing:-0.03em}.brand img{width:30px;height:30px}
h1{margin:0;font:600 58px/1.05 'Space Grotesk',sans-serif;letter-spacing:-0.035em;max-width:640px;position:relative}
h1 em{font-style:normal;color:#2BFF88}h1 em.red{color:#FF4D4D}
p{margin:16px 0 0;font:400 22px/1.45 Inter,sans-serif;color:#A1A1AA;max-width:600px;position:relative}
.art{position:absolute;right:64px;bottom:56px;width:400px;display:flex;flex-direction:column;gap:10px}
.card{background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.12);border-radius:12px;padding:16px 18px;backdrop-filter:blur(10px)}
.card.red{border-color:rgba(255,77,77,.45)}
.mono{font:500 15px 'JetBrains Mono',monospace}.muted{color:#A1A1AA}.acc{color:#2BFF88}.red{color:#FF4D4D}
.row{display:flex;justify-content:space-between;gap:12px;align-items:center;font:500 15px 'JetBrains Mono',monospace}
.chips{display:flex;gap:8px;flex-wrap:wrap}
.chip{display:inline-block;padding:7px 12px;border-radius:999px;border:1px solid rgba(255,255,255,.14);font:500 14px 'JetBrains Mono',monospace}
.chip.on{background:#2BFF88;color:#000;border-color:#2BFF88}
.chip.off{color:#52525B;text-decoration:line-through}
.foot{display:flex;justify-content:space-between;font:500 15px 'JetBrains Mono',monospace;color:#A1A1AA;position:relative}
.bubble{background:rgba(255,255,255,.06);border-radius:14px 14px 14px 4px;padding:14px 16px;font:400 16px/1.45 Inter,sans-serif;max-width:360px}
.bubble a{color:#7DD3FC;text-decoration:underline}
.line{display:flex;align-items:center;gap:10px;font:500 15px 'JetBrains Mono',monospace}
.ok{display:inline-flex;width:18px;height:18px;border-radius:50%;background:#2BFF88;align-items:center;justify-content:center}
.ok svg{width:12px;height:12px}
</style>`;
const CHECK = `<span class="ok"><svg viewBox="0 0 24 24"><path d="M6 12.5l3.5 3.5L18 8" fill="none" stroke="#000" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg></span>`;

const posts = [
  { n: 1, red: true, h: `Wallets are not hacked. They are <em class="red">handed over.</em>`, p: `A link in a DM, a fake airdrop, a page that looks like the real one, one signature. The wallet warns you after the page has done its work.`,
    art: `<div class="bubble">gm, you are on the list. claim before it closes<br><a>claim-airdrop.example/connect</a></div><div class="card red"><div class="row"><span class="red">claim-airdrop.example</span><span class="muted">wallet drainer</span></div></div>` },
  { n: 2, h: `Every scam has <em>a name.</em>`, p: `Block the name and nothing loads. Not on the phone, not in the browser, not on any device in the house. DNS is the one door every scam walks through.`,
    art: `<div class="card"><div class="row"><span>claim-airdrop.example</span><span class="acc">0.0.0.0</span></div><div class="row" style="margin-top:10px"><span>wallet-verify.example</span><span class="acc">0.0.0.0</span></div><div class="row" style="margin-top:10px"><span>payhole.org</span><span class="muted">69.48.228.170</span></div></div><div class="chips"><span class="chip on">phone</span><span class="chip on">browser</span><span class="chip on">router</span></div>` },
  { n: 3, h: `The lists exist. <em>Nobody's phone reads them.</em>`, p: `906,000 drainer and phishing names sit in repos on GitHub. PayHole puts them where the damage happens, and adds what the lists miss: your reports, confirmed, paid.`,
    art: `<div class="card"><div class="row"><span class="muted">lists</span><span>906,000 names</span></div><div class="row" style="margin-top:10px"><span class="muted">refreshed</span><span>every 6 hours</span></div></div><div class="card"><div class="line">report <span class="muted">&rarr;</span> confirm <span class="muted">&rarr;</span> <span class="acc">paid 0.30 USDG</span></div></div>` },
  { n: 4, h: `No account. No log. <em>No token rewards.</em>`, p: `Bounties in USDG, never in the token, which is only ever bought and burned. Open source. The resolver keeps nothing about you.`,
    art: `<div class="card" style="display:flex;flex-direction:column;gap:12px"><div class="line">${CHECK} open source, MIT</div><div class="line">${CHECK} resolver keeps no query log</div><div class="line">${CHECK} bounties paid in USDG</div><div class="line">${CHECK} token only bought and burned</div><div class="line"><span class="chip off">account</span><span class="chip off">analytics</span><span class="chip off">emissions</span></div></div>` },
];

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 675 }, deviceScaleFactor: 1 });
for (const post of posts) {
  const html = `<!doctype html><html><head><meta charset="utf-8">${FONTS}${CSS}</head><body><div class="f"><div class="glow ${post.red ? "red" : ""}"></div>
  <div class="top"><div class="brand"><img src="${logo}">PayHole</div></div>
  <div style="position:relative;max-width:640px"><h1>${post.h}</h1><p>${post.p}</p></div>
  <div class="foot"><span>payhole.org</span></div>
  <div class="art">${post.art}</div></div></body></html>`;
  await page.setContent(html, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(250);
  await page.screenshot({ path: join(out, `${post.n}.png`), clip: { x: 0, y: 0, width: 1200, height: 675 } });
  console.log("wrote why/" + post.n + ".png");
}
await browser.close();
