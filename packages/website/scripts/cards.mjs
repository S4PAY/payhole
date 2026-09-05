// Renders 1200 by 630 social cards (Open Graph and X) for pages and blog posts. A hand-made PNG at
// static/cards/<name>.png overrides the rendered one, so artwork can replace any card without code.
import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { chromium } from "playwright";

const FONTS = `<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600&family=Inter:wght@400;500&family=JetBrains+Mono:wght@500&display=swap" rel="stylesheet">`;
const CSS = `<style>
*{box-sizing:border-box}body{margin:0;background:#000;color:#fff;font-family:Inter,system-ui,sans-serif}
.f{position:relative;width:1200px;height:630px;overflow:hidden;background:#000;padding:52px 60px;display:flex;flex-direction:column;justify-content:space-between}
.glow{position:absolute;right:-220px;top:-300px;width:900px;height:900px;border-radius:50%;background:radial-gradient(circle,rgba(43,255,136,.20) 0%,rgba(43,255,136,.06) 40%,transparent 66%)}
.top{display:flex;justify-content:space-between;align-items:center;position:relative}
.brand{display:flex;align-items:center;gap:12px;font:600 26px 'Space Grotesk',sans-serif;letter-spacing:-0.03em}.brand img{width:32px;height:32px}
.kind{display:inline-flex;align-items:center;gap:8px;padding:8px 14px;border-radius:999px;border:1px solid rgba(43,255,136,.5);background:rgba(43,255,136,.08);font:500 14px 'JetBrains Mono',monospace;color:#2BFF88;letter-spacing:.08em;text-transform:uppercase}
.kind i{width:8px;height:8px;border-radius:50%;background:#2BFF88;display:inline-block}
h1{margin:0;font:600 54px/1.06 'Space Grotesk',sans-serif;letter-spacing:-0.035em;position:relative}
h1 em{font-style:normal;color:#2BFF88}
p{margin:16px 0 0;font:400 21px/1.45 Inter,sans-serif;color:#A1A1AA;position:relative}
.foot{font:500 16px 'JetBrains Mono',monospace;color:#A1A1AA;position:relative;display:flex;gap:18px}
.art{position:absolute;right:60px;top:120px;bottom:52px;width:440px}
/* a single-board computer, drawn in css */
.board{position:absolute;width:360px;height:236px;border-radius:14px;background:linear-gradient(160deg,#0f1d15,#0a130e);border:1px solid rgba(43,255,136,.45);box-shadow:0 30px 60px rgba(0,0,0,.6),inset 0 0 0 1px rgba(255,255,255,.03)}
.board .hole{position:absolute;width:12px;height:12px;border-radius:50%;background:#000;border:2px solid rgba(43,255,136,.5)}
.board .gpio{position:absolute;left:24px;right:120px;top:14px;height:16px;background:repeating-linear-gradient(90deg,#d8d8d8 0 5px,transparent 5px 9px),repeating-linear-gradient(90deg,#d8d8d8 0 5px,transparent 5px 9px);background-size:100% 6px;background-position:0 0,0 10px;background-repeat:repeat-x;opacity:.9}
.board .soc{position:absolute;left:96px;top:78px;width:84px;height:84px;border-radius:8px;background:linear-gradient(145deg,#2a2f2c,#101312);border:1px solid rgba(255,255,255,.18);display:flex;align-items:center;justify-content:center;font:500 12px 'JetBrains Mono',monospace;color:#A1A1AA;letter-spacing:.08em}
.board .ram{position:absolute;left:200px;top:86px;width:56px;height:30px;border-radius:4px;background:#161a18;border:1px solid rgba(255,255,255,.14)}
.board .ram2{top:126px}
.board .usb{position:absolute;right:-8px;width:44px;height:38px;border-radius:4px;background:linear-gradient(180deg,#c9ccc9,#8f938f);border:1px solid #666}
.board .eth{position:absolute;right:-8px;bottom:22px;width:52px;height:44px;border-radius:4px;background:linear-gradient(180deg,#bfc3bf,#7f837f);border:1px solid #666}
.board .usbc{position:absolute;left:36px;bottom:-6px;width:34px;height:12px;border-radius:6px;background:#9a9e9a}
.board .hdmi{position:absolute;left:92px;bottom:-6px;width:48px;height:12px;border-radius:3px 3px 6px 6px;background:#8a8e8a}
.board .trace{position:absolute;height:2px;background:rgba(43,255,136,.35);border-radius:1px}
.board .cap{position:absolute;width:10px;height:10px;border-radius:50%;background:#1d221f;border:1px solid rgba(255,255,255,.2)}
.label{position:absolute;font:500 13px 'JetBrains Mono',monospace;color:#A1A1AA;letter-spacing:.06em}
.chips{position:absolute;left:0;right:-8px;bottom:-6px;display:flex;flex-wrap:wrap;gap:6px}
.chips span{padding:5px 10px;border-radius:999px;border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.04);font:500 12px 'JetBrains Mono',monospace;color:#D4D4D8;white-space:nowrap}
.chips span:last-child{border-color:rgba(43,255,136,.5);color:#2BFF88}
.steps{position:absolute;left:0;top:12px;width:196px;display:flex;flex-direction:column;gap:14px}
.steps span{display:flex;align-items:center;gap:10px;font:500 14px 'JetBrains Mono',monospace;color:#D4D4D8}
.steps b{display:inline-flex;width:24px;height:24px;border-radius:50%;align-items:center;justify-content:center;background:rgba(43,255,136,.12);border:1px solid rgba(43,255,136,.5);color:#2BFF88;font:600 12px 'JetBrains Mono',monospace}
/* blog stack */
.stack{position:absolute;right:0;top:0;width:440px;display:flex;flex-direction:column;gap:12px}
.postcard{padding:16px 18px;border-radius:12px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.12)}
.postcard .d{font:500 12px 'JetBrains Mono',monospace;color:#A1A1AA;letter-spacing:.06em;text-transform:uppercase}
.postcard .t{font:600 17px 'Space Grotesk',sans-serif;letter-spacing:-0.02em;margin-top:6px;line-height:1.25}
.rss{position:absolute;right:0;bottom:0;display:flex;gap:10px;align-items:center;font:500 13px 'JetBrains Mono',monospace;color:#A1A1AA}
</style>`;

function esc(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function headline(h) {
  if (h.includes("<em>")) return h;
  const words = esc(h).split(" ");
  return words.length < 3 ? esc(h) : `${words.slice(0, -2).join(" ")} <em>${words.slice(-2).join(" ")}</em>`;
}

export const BOARD_ART = `<div class="art">
  <div class="board" style="left:70px;top:0;transform:rotate(-6deg) scale(.9);opacity:.5;filter:blur(.3px)"><div class="gpio"></div><div class="soc">ARM64</div><div class="ram"></div><div class="ram ram2"></div><div class="usb" style="top:60px"></div><div class="usb" style="top:108px"></div><div class="eth"></div><div class="usbc"></div><div class="hdmi"></div></div>
  <div class="board" style="left:0;top:44px;transform:scale(.92);transform-origin:left top"><div class="hole" style="left:10px;top:10px"></div><div class="hole" style="right:10px;top:10px"></div><div class="hole" style="left:10px;bottom:10px"></div><div class="hole" style="right:10px;bottom:10px"></div><div class="gpio"></div><div class="soc">ARM64</div><div class="ram"></div><div class="ram ram2"></div><div class="usb" style="top:60px"></div><div class="usb" style="top:108px"></div><div class="eth"></div><div class="usbc"></div><div class="hdmi"></div><div class="trace" style="left:40px;top:120px;width:50px"></div><div class="trace" style="left:184px;top:104px;width:14px"></div><div class="trace" style="left:184px;top:144px;width:14px"></div><div class="trace" style="left:130px;top:170px;width:2px;height:40px"></div><div class="cap" style="left:44px;top:170px"></div><div class="cap" style="left:60px;top:170px"></div><div class="cap" style="left:270px;top:60px"></div></div>
  <div class="chips">
    <span>Raspberry Pi</span><span>Radxa Rock Pi</span><span>NVIDIA Jetson</span><span>Orange Pi</span><span>ODROID</span><span>Pine64</span><span>Banana Pi</span><span>Libre Computer</span><span>Helium hotspots</span><span>ARM NAS</span><span>any 64-bit ARM · 2 GB</span>
  </div>
</div>`;

export function extensionArt(root) {
  const popup = `data:image/png;base64,${readFileSync(join(root, "..", "extension", "store", "raw", "popup.png")).toString("base64")}`;
  return `<div class="art">
    <div style="position:absolute;right:0;top:-8px;width:224px;height:392px;border-radius:16px;overflow:hidden;border:1px solid rgba(255,255,255,.14);box-shadow:0 30px 60px rgba(0,0,0,.65);background:#000"><img src="${popup}" style="display:block;width:224px"></div>
    <div class="steps"><span><b>1</b>Download</span><span><b>2</b>Load unpacked</span><span><b>3</b>Create seed</span><span><b>4</b>Fund the pocket</span><span><b>5</b>Pay for a page</span></div>
    <div class="chips" style="bottom:-6px"><span>Chrome</span><span>Brave</span><span>Edge</span><span>Arc</span><span>Opera</span><span>Vivaldi</span><span>2 minutes · no account</span></div>
  </div>`;
}

export const BLOG_ART = `<div class="art"><div class="stack">
  <div class="postcard"><div class="d">Release · 2026-09-05</div><div class="t">Sinkhole gets a dashboard, statistics, lists, and encrypted DNS</div></div>
  <div class="postcard"><div class="d">Token · 2026-09-05</div><div class="t">PAYHOLE is on Pons, and how tiers are priced</div></div>
  <div class="postcard"><div class="d">Launch · 2026-09-04</div><div class="t">PayHole is live on Robinhood Chain</div></div>
</div><div class="rss">RSS · payhole.org/blog/feed.xml</div></div>`;

/** items: [{ file, kind, title, text, art?, name? }] where file is the absolute output path. */
export async function renderCards(root, items) {
  const logo = `data:image/png;base64,${readFileSync(join(root, "static", "logo.png")).toString("base64")}`;
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
  let rendered = 0;
  for (const it of items) {
    mkdirSync(dirname(it.file), { recursive: true });
    const override = it.name ? join(root, "static", "cards", `${it.name}.png`) : null;
    if (override && existsSync(override)) {
      copyFileSync(override, it.file);
      continue;
    }
    if (it.art === "extension") it.art = extensionArt(root);
    const wide = !it.art;
    const size = it.title.length > 64 ? 40 : it.title.length > 44 ? 46 : 54;
    await page.setContent(`<!doctype html><html><head><meta charset="utf-8">${FONTS}${CSS}</head><body><div class="f"><div class="glow"></div>
      <div class="top"><div class="brand"><img src="${logo}">PayHole</div><div class="kind"><i></i>${esc(it.kind)}</div></div>
      <div style="position:relative;max-width:${wide ? 1000 : 600}px"><h1 style="font-size:${size}px">${headline(it.title)}</h1><p>${esc(it.text)}</p></div>
      <div class="foot"><span>payhole.org</span>${it.footer ? `<span>${esc(it.footer)}</span>` : ""}</div>
      ${it.art || ""}</div></body></html>`, { waitUntil: "networkidle" });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(150);
    await page.screenshot({ path: it.file, clip: { x: 0, y: 0, width: 1200, height: 630 } });
    rendered += 1;
  }
  await browser.close();
  return rendered;
}

/** Cards for the fixed pages; keys are the page file names without .html. */
export const PAGE_CARDS = {
  sinkhole: { kind: "Tutorial", title: "Run Sinkhole on a Raspberry Pi or any ARM board.", text: "Step by step: Docker, one container, point your network at it. Blocks drainers, phishing, and trackers for every device, and learns from every other node.", art: BOARD_ART, footer: "payhole.org/sinkhole.html" },
  blog: { kind: "Blog", title: "The PayHole blog.", text: "Release notes and progress: the extension, the contracts, Sinkhole, the token. Dated, in order, with an RSS feed.", art: BLOG_ART, footer: "payhole.org/blog" },
  try: { kind: "Try it", title: "This article costs 0.01 USDG.", text: "A real page behind a real 402. With PayHole installed it pays for itself. Without it you see what every paying page starts with." },
  extension: { kind: "Tutorial", title: "How to install the PayHole extension.", text: "Two minutes from download to a funded pocket, with the real screens: load it in Chrome, create a seed, send a little USDG, pay for a page.", art: "extension", footer: "payhole.org/extension.html" },
  token: { kind: "Token", title: "Only ever bought and burned.", text: "PAYHOLE unlocks tiers: bigger pockets, more keys, the right to report into the swarm. No emissions, no rewards." },
  creators: { kind: "Creators", title: "Get paid per visit, in USDG.", text: "One DNS record with your wallet, verified on payhole.org. Visitors with tips on pay you directly, no platform in the middle." },
  developers: { kind: "Developers", title: "Accept payments with one header.", text: "Answer 402 with a price, verify and settle through any x402 facilitator on Robinhood Chain. SDK, CLI, and docs." },
  trust: { kind: "Trust", title: "Open source. Verified. Owned by a Safe.", text: "Three contracts on Robinhood Chain, all verified on Sourcify. Read them before you fund a pocket." },
  docs: { kind: "Documentation", title: "The SDK, the CLI, and x402 on your server.", text: "payholeFetch, capped session keys for agents, and the exact headers a paying page returns." },
};
