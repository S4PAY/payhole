// Copies static/ into dist/ and compiles src/ TypeScript into dist/js with tsc (no bundler).
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
rmSync(join(root, "dist"), { recursive: true, force: true });
mkdirSync(join(root, "dist"), { recursive: true });
cpSync(join(root, "static"), join(root, "dist"), { recursive: true });
execFileSync("tsc", ["-p", "tsconfig.build.json"], { cwd: root, stdio: "inherit" });
console.log("built dist/");
