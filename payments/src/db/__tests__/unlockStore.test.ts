import { promises as fs } from 'fs';
import path from 'path';
import { UnlockStore } from '@/db/unlockStore';

describe('UnlockStore', () => {
  const filePath = path.join(process.cwd(), 'tmp-test', 'unlock-store.test.json');
  let store: UnlockStore;

  beforeEach(() => {
    store = new UnlockStore(filePath);
  });

  afterAll(async () => {
    await fs.rm(filePath, { force: true });
  });

  it('persists and retrieves unlock records', async () => {
    const expiresAt = new Date('2030-01-01T00:00:00.000Z');
    await store.upsert('wallet-abc', 'sig-123', expiresAt);

    const stored = await store.get('wallet-abc');

    expect(stored).toBeDefined();
    expect(stored?.signature).toBe('sig-123');
    expect(stored?.expiresAt).toBe(expiresAt.toISOString());
    expect(stored?.createdAt).toBeTruthy();
    expect(stored?.updatedAt).toBeTruthy();
  });

  it('updates existing records while preserving creation timestamp', async () => {
    const initialExpiry = new Date('2030-01-01T00:00:00.000Z');
    const updatedExpiry = new Date('2030-02-01T00:00:00.000Z');

    const first = await store.upsert('wallet-xyz', 'sig-initial', initialExpiry);
    await new Promise((resolve) => setTimeout(resolve, 10));
    const second = await store.upsert('wallet-xyz', 'sig-updated', updatedExpiry);

    expect(second.createdAt).toBe(first.createdAt);
    expect(second.updatedAt).not.toBe(first.updatedAt);
    expect(second.signature).toBe('sig-updated');
    expect(second.expiresAt).toBe(updatedExpiry.toISOString());
  });
});

