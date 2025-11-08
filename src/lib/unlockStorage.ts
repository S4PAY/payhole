const STORAGE_KEY = 'payhole.unlocks';

type UnlockRecord = {
  wallet: string;
  token: string;
  expiresAt?: string | null;
  storedAt: string;
};

type UnlockStore = Record<string, UnlockRecord>;

function isBrowser(): boolean {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

function readStore(): UnlockStore {
  if (!isBrowser()) {
    return {};
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return {};
    }
    const parsed = JSON.parse(raw) as UnlockStore;
    if (parsed && typeof parsed === 'object') {
      return parsed;
    }
  } catch (error) {
    console.warn('PayHole: unable to parse unlock storage', error);
  }

  window.localStorage.removeItem(STORAGE_KEY);
  return {};
}

function writeStore(store: UnlockStore) {
  if (!isBrowser()) {
    return;
  }
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch (error) {
    console.warn('PayHole: unable to persist unlock storage', error);
  }
}

export function loadUnlock(wallet: string): UnlockRecord | null {
  if (!wallet) {
    return null;
  }
  const store = readStore();
  return store[wallet] ?? null;
}

export function saveUnlock(record: UnlockRecord) {
  if (!record.wallet || !record.token) {
    return;
  }
  const store = readStore();
  store[record.wallet] = {
    ...record,
    storedAt: record.storedAt ?? new Date().toISOString(),
  };
  writeStore(store);
}

export function clearUnlock(wallet: string) {
  if (!wallet) {
    return;
  }
  const store = readStore();
  if (store[wallet]) {
    delete store[wallet];
    writeStore(store);
  }
}


