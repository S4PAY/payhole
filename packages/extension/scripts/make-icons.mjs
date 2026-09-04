// Renders the toolbar icons and the in-page logo from assets/brand/vortex.png: the vortex is
// cropped to its glow, clipped to a circle, and downscaled in halving steps. Run with `pnpm icons`;
// the PNGs are committed so a build needs no browser.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const source = readFileSync(join(root, "assets", "brand", "vortex.png"));
const ICON_SIZES = [16, 32, 48, 128];
const LOGO_SIZE = 256;

const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  await page.setContent("<!doctype html><title>icons</title>");
  const rendered = await page.evaluate(
    async ({ dataUrl, sizes }) => {
      const img = new Image();
      img.src = dataUrl;
      await img.decode();
      const probe = document.createElement("canvas");
      probe.width = img.width;
      probe.height = img.height;
      const pctx = probe.getContext("2d");
      pctx.drawImage(img, 0, 0);
      const { data } = pctx.getImageData(0, 0, img.width, img.height);
      let minX = img.width, minY = img.height, maxX = 0, maxY = 0;
      for (let y = 0; y < img.height; y++) {
        for (let x = 0; x < img.width; x++) {
          const i = (y * img.width + x) * 4;
          if (Math.max(data[i], data[i + 1], data[i + 2]) > 24) {
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
          }
        }
      }
      const cx = (minX + maxX) / 2;
      const cy = (minY + maxY) / 2;
      const r = (Math.max(maxX - minX, maxY - minY) / 2) * 1.03;
      // Square crop at 1024 first, then halve down so small sizes stay crisp.
      const base = document.createElement("canvas");
      base.width = base.height = 1024;
      const bctx = base.getContext("2d");
      bctx.imageSmoothingQuality = "high";
      bctx.drawImage(img, cx - r, cy - r, 2 * r, 2 * r, 0, 0, 1024, 1024);
      const out = {};
      for (const size of sizes) {
        let current = base;
        while (current.width / 2 >= size) {
          const next = document.createElement("canvas");
          next.width = next.height = current.width / 2;
          const nctx = next.getContext("2d");
          nctx.imageSmoothingQuality = "high";
          nctx.drawImage(current, 0, 0, next.width, next.height);
          current = next;
        }
        const target = document.createElement("canvas");
        target.width = target.height = size;
        const tctx = target.getContext("2d");
        tctx.imageSmoothingQuality = "high";
        tctx.beginPath();
        tctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
        tctx.closePath();
        tctx.clip();
        tctx.drawImage(current, 0, 0, size, size);
        out[size] = target.toDataURL("image/png");
      }
      return { out, crop: { minX, minY, maxX, maxY, cx, cy, r } };
    },
    { dataUrl: `data:image/png;base64,${source.toString("base64")}`, sizes: [...ICON_SIZES, LOGO_SIZE] },
  );
  mkdirSync(join(root, "public", "icon"), { recursive: true });
  const write = (path, dataUrl) => writeFileSync(path, Buffer.from(dataUrl.split(",")[1], "base64"));
  for (const size of ICON_SIZES) write(join(root, "public", "icon", `${size}.png`), rendered.out[size]);
  write(join(root, "public", "logo.png"), rendered.out[LOGO_SIZE]);
  console.log(`crop ${JSON.stringify(rendered.crop)}; wrote icons ${ICON_SIZES.join(", ")} and logo ${LOGO_SIZE}`);
} finally {
  await browser.close();
}
