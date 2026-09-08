// Renders two banner sets (1200 by 675): "one scam a day", a pattern step by step with the step PayHole cuts,
// into static/brand/scam; and "before and after", the same link with and without PayHole, into static/brand/versus.
// Run from packages/website with Playwright available: node scripts/make-scam-banners.mjs
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const logo = `data:image/png;base64,${readFileSync(join(root, "static", "logo.png")).toString("base64")}`;
const FONTS = `<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">`;
const CSS = `<style>
*{box-sizing:border-box}body{margin:0;background:#000;color:#fff;font-family:Inter,system-ui,sans-serif}
.f{position:relative;width:1200px;height:675px;overflow:hidden;background:#000;padding:52px 64px 48px;display:flex;flex-direction:column;justify-content:space-between}
.glow{position:absolute;right:-260px;top:-260px;width:820px;height:820px;border-radius:50%;background:radial-gradient(circle,rgba(43,255,136,.18) 0%,rgba(43,255,136,.05) 40%,transparent 66%)}
.brand{display:flex;align-items:center;gap:12px;font:600 24px 'Space Grotesk',sans-serif;letter-spacing:-0.03em;position:relative}.brand img{width:30px;height:30px}
.eyebrow{font:500 13px 'JetBrains Mono',monospace;letter-spacing:.1em;text-transform:uppercase;color:#A1A1AA;position:relative}
h1{margin:6px 0 0;font:600 52px/1.05 'Space Grotesk',sans-serif;letter-spacing:-0.035em;position:relative}
h1 em{font-style:normal;color:#2BFF88}h1 em.red{font-style:normal;color:#FF4D4D}
.foot{display:flex;justify-content:space-between;font:500 15px 'JetBrains Mono',monospace;color:#A1A1AA;position:relative}
.steps{position:relative;display:flex;flex-direction:column;gap:8px;margin:22px 0 0;width:760px}
.step{display:flex;align-items:center;gap:16px;padding:12px 16px;border-radius:12px;border:1px solid rgba(255,255,255,.1);background:rgba(255,255,255,.03);font:400 19px Inter,sans-serif;color:#E4E4E7}
.step .n{font:500 14px 'JetBrains Mono',monospace;color:#A1A1AA;min-width:26px}
.step.cut{border-color:#2BFF88;background:rgba(43,255,136,.08)}
.step.cut .n{color:#2BFF88}
.step .tag{margin-left:auto;font:500 13px 'JetBrains Mono',monospace;color:#000;background:#2BFF88;padding:5px 10px;border-radius:999px;white-space:nowrap}
.step.dead{color:#52525B;text-decoration:line-through}
.cols{position:relative;display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-top:26px}
.col{border-radius:14px;padding:22px 24px;border:1px solid rgba(255,255,255,.1);background:rgba(255,255,255,.03);display:flex;flex-direction:column;gap:12px;min-height:300px}
.col.red{border-color:rgba(255,77,77,.5)}.col.green{border-color:rgba(43,255,136,.55);background:rgba(43,255,136,.05)}
.col .h{font:500 13px 'JetBrains Mono',monospace;letter-spacing:.1em;text-transform:uppercase}
.col.red .h{color:#FF4D4D}.col.green .h{color:#2BFF88}
.col .l{font:400 21px/1.4 Inter,sans-serif;color:#E4E4E7}
.col .end{margin-top:auto;font:600 24px 'Space Grotesk',sans-serif;letter-spacing:-0.02em}
.col.red .end{color:#FF4D4D}.col.green .end{color:#2BFF88}
</style>`;

const scams = [
  { n: 1, eyebrow: "One scam a day · the fake airdrop", h: `Sign to claim. <em class="red">The drain runs later.</em>`,
    steps: [["A DM: you are on the list, claim before it closes", false], ["The link opens a page that looks like the project", true], ["Connect wallet", false], ["Sign to claim: the signature is an approval", true], ["Hours later, everything approved is moved out", false]],
    tags: { 1: "cut: the page never loads", 3: "cut: the guard stops the approval" } },
  { n: 2, eyebrow: "One scam a day · the gasless permit", h: `No transaction, no gas, <em class="red">nothing on chain.</em> Until it is.`,
    steps: [["A mint or verify page asks for one signature", false], ["It is a Permit2 permit: a spender gets all of a token", true], ["Nothing happens yet, so nothing looks wrong", false], ["The spender pulls the tokens whenever it likes", false]],
    tags: { 1: "cut: the guard reads the permit first" } },
  { n: 3, eyebrow: "One scam a day · the counterfeit token", h: `The real name. <em class="red">A lookalike domain.</em>`,
    steps: [["A token trends; a site with its name appears", false], ["The domain trades on the brand and is three days old", true], ["Connect wallet, buy or claim, approve", false], ["The token is fake; the approval is real", false]],
    tags: { 1: "cut: brand match, fresh domain, listed within minutes" } },
  { n: 4, eyebrow: "One scam a day · the support page", h: `Verify your wallet. <em class="red">Enter your recovery phrase.</em>`,
    steps: [["A ticket, a bot, a helpful stranger in the group", false], ["A page to verify, migrate, or unlock your wallet", true], ["A form for the twelve words", true], ["The wallet is theirs the moment you press send", false]],
    tags: { 1: "cut: the page never loads", 2: "cut: a seed form confirms the report by itself" } },
];

const versus = [
  { n: 1, h: `A link in a DM. <em>Same link, two mornings.</em>`, without: ["One tap.", "A page that looks like the project.", "Connect, sign to claim."], withEnd: "Wallet drainer. Confirmed by 5 nodes.", withoutEnd: "Wallet empty by morning.", with: ["One tap.", "A wall instead of the page.", "What it is, who says so, go back."] },
  { n: 2, h: `The verify page. <em>Twelve words, or a wall.</em>`, without: ["Support says your wallet needs verifying.", "A form with twelve boxes.", "You type them in."], withoutEnd: "Nothing left to verify.", with: ["Support says your wallet needs verifying.", "The link opens a wall: phishing, on two lists.", "You report it. It pays 0.30 USDG."], withEnd: "Wallet untouched." },
  { n: 3, h: `The signature. <em>With and without the guard.</em>`, without: ["A mint page asks for one signature.", "The wallet shows a permit you do not read.", "You sign."], withoutEnd: "Drained a week later.", with: ["A mint page asks for one signature.", "PayHole reads it first: a known drainer spender.", "Stop. The wallet never opens."], withEnd: "Nothing signed." },
  { n: 4, h: `The whole house. <em>One node.</em>`, without: ["Your phone is careful.", "The tablet in the kitchen is not.", "The kid taps the free skins link."], withoutEnd: "The family wallet, gone.", with: ["A PayHole node on the Pi in the closet.", "Every device gets the same answer.", "The free skins link does not resolve."], withEnd: "Nobody had to be careful." },
];

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 675 }, deviceScaleFactor: 1 });
const render = async (file, body) => {
  await page.setContent(`<!doctype html><html><head><meta charset="utf-8">${FONTS}${CSS}</head><body><div class="f"><div class="glow"></div><div class="brand"><img src="${logo}">PayHole</div>${body}<div class="foot"><span>payhole.org</span></div></div></body></html>`, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(250);
  await page.screenshot({ path: file, clip: { x: 0, y: 0, width: 1200, height: 675 } });
  console.log("wrote", file.split("/").slice(-2).join("/"));
};

mkdirSync(join(root, "static", "brand", "scam"), { recursive: true });
for (const s of scams) {
  const steps = s.steps.map(([text, cut], i) => `<div class="step ${cut ? "cut" : ""}"><span class="n">0${i + 1}</span><span>${text}</span>${s.tags[i] ? `<span class="tag">${s.tags[i]}</span>` : ""}</div>`).join("");
  await render(join(root, "static", "brand", "scam", `${s.n}.png`), `<div style="position:relative"><div class="eyebrow">${s.eyebrow}</div><h1>${s.h}</h1><div class="steps">${steps}</div></div>`);
}
mkdirSync(join(root, "static", "brand", "versus"), { recursive: true });
for (const v of versus) {
  const col = (cls, head, lines, end) => `<div class="col ${cls}"><div class="h">${head}</div>${lines.map((l) => `<div class="l">${l}</div>`).join("")}<div class="end">${end}</div></div>`;
  await render(join(root, "static", "brand", "versus", `${v.n}.png`), `<div style="position:relative"><div class="eyebrow">Before and after</div><h1>${v.h}</h1><div class="cols">${col("red", "Without", v.without, v.withoutEnd)}${col("green", "With PayHole", v.with, v.withEnd)}</div></div>`);
}
await browser.close();
