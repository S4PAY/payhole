// Copies static/ into dist/ and compiles src/ TypeScript into dist/js with tsc (no bundler).
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
rmSync(join(root, "dist"), { recursive: true, force: true });
mkdirSync(join(root, "dist"), { recursive: true });
cpSync(join(root, "static"), join(root, "dist"), { recursive: true });
execFileSync("tsc", ["-p", "tsconfig.build.json"], { cwd: root, stdio: "inherit" });

// Stamp stylesheet and script URLs so browsers fetch new assets after every deploy.
const stamp = Date.now().toString(36);
for (const file of readdirSync(join(root, "dist")).filter((f) => f.endsWith(".html"))) {
  const path = join(root, "dist", file);
  const html = readFileSync(path, "utf8")
    .replace('href="/styles.css"', `href="/styles.css?v=${stamp}"`)
    .replace(/src="(\/js\/pages\/[a-z]+\.js)"/g, `src="$1?v=${stamp}"`);
  writeFileSync(path, html);
}
console.log("built dist/ with asset stamp", stamp);
