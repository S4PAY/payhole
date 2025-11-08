import fs from 'fs';
import path from 'path';
import { resetEnvCache } from '@/config/env';

const originalFetch = global.fetch;

const tmpDir = path.join(process.cwd(), 'tmp-test');
const defaultDbPath = path.join(tmpDir, 'unlocks.json');

beforeAll(() => {
  if (!fs.existsSync(tmpDir)) {
    fs.mkdirSync(tmpDir, { recursive: true });
  }
});

beforeEach(() => {
  process.env.HELIUS_RPC_URL = process.env.HELIUS_RPC_URL ?? 'https://helius.test.rpc';
  process.env.JWT_SECRET = process.env.JWT_SECRET ?? 'test-secret-key-32-characters-long!!';
  process.env.UNLOCK_DB_PATH = defaultDbPath;
  process.env.USDC_MINT_ADDRESS =
    process.env.USDC_MINT_ADDRESS ?? 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZeh9Bx';
  resetEnvCache();
  if (fs.existsSync(defaultDbPath)) {
    fs.rmSync(defaultDbPath);
  }
});

afterAll(() => {
  if (fs.existsSync(defaultDbPath)) {
    fs.rmSync(defaultDbPath);
  }
  if (fs.existsSync(tmpDir)) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

afterEach(() => {
  jest.restoreAllMocks();
  if (originalFetch) {
    global.fetch = originalFetch;
  } else {
    delete (global as unknown as { fetch?: typeof fetch }).fetch;
  }
  resetEnvCache();
});

