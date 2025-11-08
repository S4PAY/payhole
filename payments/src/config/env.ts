import { config } from 'dotenv';
import { z } from 'zod';

config();

const schema = z.object({
  HELIUS_RPC_URL: z
    .string()
    .url({ message: 'HELIUS_RPC_URL must be a valid URL' }),
  JWT_SECRET: z
    .string()
    .min(32, { message: 'JWT_SECRET must be at least 32 characters' }),
  PORT: z.coerce.number().int().positive().default(4000),
  UNLOCK_DB_PATH: z.string().default('data/unlocks.json'),
  USDC_MINT_ADDRESS: z
    .string()
    .min(32)
    .default('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZeh9Bx'),
  PROXY_UNLOCK_WEBHOOK: z
    .string()
    .url()
    .optional()
    .or(z.literal(''))
    .transform((value) => (value === '' ? undefined : value)),
  ANALYTICS_BUFFER_LIMIT: z.coerce.number().int().positive().default(10000),
});

export type Env = z.infer<typeof schema>;

let cachedEnv: Env | null = null;

export function getEnv(): Env {
  if (cachedEnv) {
    return cachedEnv;
  }

  const parsed = schema.safeParse(process.env);

  if (!parsed.success) {
    const message = parsed.error.issues.map((issue) => issue.message).join(', ');
    throw new Error(`Environment validation failed: ${message}`);
  }

  cachedEnv = parsed.data;
  return cachedEnv;
}

export function resetEnvCache() {
  cachedEnv = null;
}

