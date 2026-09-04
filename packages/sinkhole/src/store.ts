import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

/** Reads and parses a JSON file; null when the file does not exist. */
export async function readJson<T>(path: string): Promise<T | null> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  return JSON.parse(text) as T;
}

/** Writes a file through a temporary sibling and a rename so readers never see a partial file. */
export async function writeFileAtomic(path: string, data: string | Uint8Array, mode?: number): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmp, data, mode === undefined ? {} : { mode });
  if (mode !== undefined) await chmod(tmp, mode);
  await rename(tmp, path);
}

export async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  await writeFileAtomic(path, JSON.stringify(value, null, 2) + "\n");
}

/** Coalesces bursts of calls into one run of `fn` after `delayMs` of quiet; runs never overlap. */
export function debounce(fn: () => Promise<void>, delayMs: number): { trigger: () => void; flush: () => Promise<void> } {
  let timer: NodeJS.Timeout | null = null;
  let running: Promise<void> | null = null;
  let pending = false;
  const run = (): Promise<void> => {
    if (running) {
      pending = true;
      return running;
    }
    running = fn().finally(() => {
      running = null;
      if (pending) {
        pending = false;
        void run();
      }
    });
    return running;
  };
  return {
    trigger: () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        void run();
      }, delayMs);
    },
    flush: async () => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
        await run();
      } else if (running) {
        await running;
      }
    },
  };
}
