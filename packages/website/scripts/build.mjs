// Copies static/ into dist/ and compiles src/ TypeScript into dist/js with tsc (no bundler).
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildBlog } from "./blog.mjs";
import { PAGE_CARDS, renderCards } from "./cards.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
rmSync(join(root, "dist"), { recursive: true, force: true });
mkdirSync(join(root, "dist"), { recursive: true });
cpSync(join(root, "static"), join(root, "dist"), { recursive: true });
execFileSync("tsc", ["-p", "tsconfig.build.json"], { cwd: root, stdio: "inherit" });

// Serve three.js from this origin for the aperture scene (the page's CSP allows scripts from self only).
const three = join(root, "node_modules", "three");
if (existsSync(three)) {
  const vendor = join(root, "dist", "js", "vendor", "three");
  cpSync(join(three, "build", "three.module.js"), join(vendor, "build", "three.module.js"));
  cpSync(join(three, "examples", "jsm"), join(vendor, "examples", "jsm"), { recursive: true });
}

// Publish the Chrome Web Store kit under /store so it can be fetched from any device.
const kit = join(root, "..", "extension", "store");
if (existsSync(kit)) {
  const dest = join(root, "dist", "store");
  mkdirSync(dest, { recursive: true });
  const files = readdirSync(kit).filter((f) => f.endsWith(".png") || f.endsWith(".md"));
  for (const f of files) cpSync(join(kit, f), join(dest, f));
  cpSync(join(root, "..", "extension", "public", "icon", "128.png"), join(dest, "icon-128.png"));
  if (existsSync(join(kit, "raw"))) cpSync(join(kit, "raw"), join(dest, "raw"), { recursive: true });
  const rows = ["icon-128.png", ...files]
    .map((f) => `<li><a href="/store/${f}">${f}</a></li>`)
    .join("");
  writeFileSync(
    join(dest, "index.html"),
    `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>Store kit</title><style>body{margin:0;background:#000;color:#fff;font:16px/1.6 Inter,system-ui,sans-serif;padding:32px 24px}a{color:#2BFF88}li{margin:8px 0}</style></head><body><h1 style="font-size:22px">Chrome Web Store kit</h1><p>Open an image and long-press or right-click to save it. The extension package is at <a href="/downloads/payhole-extension.zip">/downloads/payhole-extension.zip</a>.</p><ul>${rows}</ul></body></html>`,
  );
}

// Brand assets for launchpads and profiles, served under /brand.
const brand = join(root, "dist", "brand");
mkdirSync(brand, { recursive: true });
cpSync(join(root, "..", "extension", "assets", "brand", "vortex.png"), join(brand, "vortex-1245.png"));
cpSync(join(root, "..", "extension", "assets", "brand", "banner.png"), join(brand, "banner-1731x909.png"));
cpSync(join(root, "static", "logo.png"), join(brand, "logo-256.png"));

// Blog pages from blog/*.md, plus their sitemap entries.
const blogPages = buildBlog(root, join(root, "dist"));
const sitemapPath = join(root, "dist", "sitemap.xml");
writeFileSync(sitemapPath, readFileSync(sitemapPath, "utf8").replace("</urlset>", `  <url><loc>https://payhole.org/blog/</loc></url>\n${blogPages.map((p) => `  <url><loc>${p.url}</loc><lastmod>${p.date}</lastmod></url>`).join("\n")}\n</urlset>`));

// Social cards: one per fixed page under /cards, one per post next to it.
const cardItems = Object.entries(PAGE_CARDS).map(([name, c]) => ({ ...c, name, file: join(root, "dist", "cards", `${name}.png`) }));
for (const p of blogPages) cardItems.push({ kind: `Blog · ${p.tag}`, title: p.title, text: p.summary, art: p.card, footer: `${p.date} · payhole.org/blog`, file: join(root, "dist", "blog", p.slug, "card.png") });
console.log("cards rendered:", await renderCards(root, cardItems));

// Stamp stylesheet and script URLs so browsers fetch new assets after every deploy.
const stamp = Date.now().toString(36);
const htmlFiles = [...readdirSync(join(root, "dist")).filter((f) => f.endsWith(".html")), "blog/index.html", ...blogPages.map((p) => `blog/${p.url.split("/blog/")[1]}index.html`)];
for (const file of htmlFiles) {
  const path = join(root, "dist", file);
  const html = readFileSync(path, "utf8")
    .replace('href="/styles.css"', `href="/styles.css?v=${stamp}"`)
    .replace(/src="(\/js\/(?:pages\/[a-z]+|aperture)\.js)"/g, `src="$1?v=${stamp}"`);
  writeFileSync(path, html);
}
console.log("built dist/ with asset stamp", stamp);
