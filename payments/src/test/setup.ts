import fs from 'fs';
import os from 'os';
import path from 'path';
import { resetEnvCache } from '@/config/env';

const tmpDir = path.join(os.tmpdir(), 'payhole-test-data');
const defaultDbPath = path.join(tmpDir, 'unlocks.json');

beforeAll(() => {
  fs.mkdirSync(tmpDir, { recursive: true });
});

beforeEach(() => {
  process.env.HELIUS_RPC_URL = process.env.HELIUS_RPC_URL ?? 'https://helius.test.rpc';
  process.env.JWT_SECRET = process.env.JWT_SECRET ?? 'test-secret-key-32-characters-long!!';
  process.env.UNLOCK_DB_PATH = defaultDbPath;
  process.env.USDC_MINT_ADDRESS =
    process.env.USDC_MINT_ADDRESS ?? 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
  process.env.TREASURY_WALLET =
    process.env.TREASURY_WALLET ?? 'PayholeTreasury11111111111111111111111111111';
  process.env.MIN_PAYMENT_USDC = process.env.MIN_PAYMENT_USDC ?? '5';
  resetEnvCache();
  if (fs.existsSync(defaultDbPath)) {
    fs.rmSync(defaultDbPath);
  }
});

afterAll(() => {
  if (fs.existsSync(tmpDir)) {
    fs.rmSync(tmpDir, { recursive: true });
  }
});
