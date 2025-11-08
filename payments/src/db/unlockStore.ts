import { promises as fs } from 'fs';
import path from 'path';

export type UnlockRecord = {
  wallet: string;
  signature: string;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
};

type UnlockFileShape = {
  records: UnlockRecord[];
};

export class UnlockStore {
  private readonly filePath: string;
  private loaded = false;
  private records = new Map<string, UnlockRecord>();

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  async upsert(wallet: string, signature: string, expiresAt: Date): Promise<UnlockRecord> {
    await this.ensureLoaded();

    const now = new Date().toISOString();
    const existing = this.records.get(wallet);
    const record: UnlockRecord = {
      wallet,
      signature,
      expiresAt: expiresAt.toISOString(),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };

    this.records.set(wallet, record);
    await this.persist();
    return record;
  }

  async get(wallet: string): Promise<UnlockRecord | undefined> {
    await this.ensureLoaded();
    return this.records.get(wallet);
  }

  async all(): Promise<UnlockRecord[]> {
    await this.ensureLoaded();
    return Array.from(this.records.values()).sort((a, b) =>
      a.updatedAt < b.updatedAt ? 1 : -1
    );
  }

  async clear(): Promise<void> {
    await this.ensureLoaded();
    this.records.clear();
    await this.persist();
  }

  private async ensureLoaded() {
    if (this.loaded) {
      return;
    }

    try {
      const raw = await fs.readFile(this.filePath, 'utf-8');
      const parsed = JSON.parse(raw) as UnlockFileShape;
      if (Array.isArray(parsed.records)) {
        for (const record of parsed.records) {
          this.records.set(record.wallet, record);
        }
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }

    this.loaded = true;
  }

  private async persist() {
    const dir = path.dirname(this.filePath);
    await fs.mkdir(dir, { recursive: true });
    const payload: UnlockFileShape = {
      records: Array.from(this.records.values()),
    };

    await fs.writeFile(this.filePath, JSON.stringify(payload, null, 2), 'utf-8');
  }
}

