import { browser } from "wxt/browser";

/** The subset of a storage area the libraries use, so tests can substitute memory. */
export interface KeyValueStore {
  get<T>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown): Promise<void>;
  remove(key: string): Promise<void>;
}

type Area = "local" | "session";

function areaStore(area: Area): KeyValueStore {
  return {
    async get<T>(key: string): Promise<T | undefined> {
      const result = await browser.storage[area].get(key);
      return result[key] as T | undefined;
    },
    async set(key, value) {
      await browser.storage[area].set({ [key]: value });
    },
    async remove(key) {
      await browser.storage[area].remove(key);
    },
  };
}

/** `browser.storage.local`: settings, encrypted vault, ledger, blocklist. Survives restarts. */
export const localStore: KeyValueStore = areaStore("local");

/** `browser.storage.session`: the unlocked mnemonic only. Cleared when the browser closes. */
export const sessionStore: KeyValueStore = areaStore("session");

/** In-memory store for tests and for running the payment core outside a browser. */
export function memoryStore(): KeyValueStore {
  const map = new Map<string, unknown>();
  return {
    get: <T>(key: string) => Promise.resolve(structuredClone(map.get(key)) as T | undefined),
    set: (key, value) => {
      map.set(key, structuredClone(value));
      return Promise.resolve();
    },
    remove: (key) => {
      map.delete(key);
      return Promise.resolve();
    },
  };
}
