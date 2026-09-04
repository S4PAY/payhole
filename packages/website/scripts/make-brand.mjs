// Derives the site's favicon and touch icon from static/logo.png (the circular vortex mark) with a headless browser canvas,
// because no image library is installed. Run: node scripts/make-brand.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = "data:image/png;base64," + readFileSync(join(root, "static", "logo.png")).toString("base64");
const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent(`<img id="src" src="${source}">`);
await page.waitForFunction(() => document.getElementById("src").complete);
for (const [name, size] of [["favicon.png", 64], ["apple-touch-icon.png", 180]]) {
  const dataUrl = await page.evaluate((px) => {
    const img = document.getElementById("src");
    let current = img;
    let width = img.naturalWidth;
    // halve in steps for a clean downscale, then draw at the final size
    while (width / 2 >= px) {
      const c = document.createElement("canvas");
      c.width = c.height = width / 2;
      c.getContext("2d").drawImage(current, 0, 0, c.width, c.height);
      current = c;
      width = c.width;
    }
    const out = document.createElement("canvas");
    out.width = out.height = px;
    out.getContext("2d").drawImage(current, 0, 0, px, px);
    return out.toDataURL("image/png");
  }, size);
  writeFileSync(join(root, "static", name), Buffer.from(dataUrl.split(",")[1], "base64"));
  console.log("wrote", name, size + "px");
}
await browser.close();
