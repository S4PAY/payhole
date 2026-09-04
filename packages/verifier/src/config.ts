import { isAddress, type Address, type Hex } from "viem";
import { chainConfig } from "@payhole/sdk";

export interface VerifierConfig {
  host: string;
  port: number;
  chainId: number;
  rpcUrl: string;
  registry: Address;
  verifierKey: Hex;
  attestationTtlSeconds: number;
  rateLimitPerMinute: number;
  trustProxy: boolean;
  dnsServers: string[] | undefined;
  /** Paid demo article; absent when DEMO_PAY_TO is not set. */
  demo: DemoSettings | undefined;
}

export interface DemoSettings {
  payTo: Address;
  price: bigint;
  facilitators: string[];
  resourceUrl: string;
  timeoutMs: number;
}

function integer(value: string | undefined, fallback: number, name: string): number {
  if (value === undefined || value === "") return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) throw new Error(`${name} must be a positive integer`);
  return n;
}

/** Reads the service configuration from the environment. Secrets never come from anywhere else. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): VerifierConfig {
  const key = env["VERIFIER_PRIVATE_KEY"];
  if (!key || !/^0x[0-9a-fA-F]{64}$/.test(key)) throw new Error("VERIFIER_PRIVATE_KEY must be a 32-byte hex private key");
  const registry = env["REGISTRY_ADDRESS"];
  if (!registry || !isAddress(registry)) throw new Error("REGISTRY_ADDRESS must be the CreatorRegistry address");
  const dns = env["DNS_SERVERS"];
  const payTo = env["DEMO_PAY_TO"];
  if (payTo && !isAddress(payTo)) throw new Error("DEMO_PAY_TO must be a wallet address");
  const facilitators = (env["FACILITATOR_URLS"] ?? "https://facilitator.naven.network,https://x402.primer.systems")
    .split(",")
    .map((s) => s.trim().replace(/\/+$/, ""))
    .filter(Boolean);
  return {
    host: env["HOST"] ?? "0.0.0.0",
    port: integer(env["PORT"], 8787, "PORT"),
    chainId: integer(env["CHAIN_ID"], chainConfig.chainId, "CHAIN_ID"),
    rpcUrl: env["RPC_URL"] ?? chainConfig.rpc,
    registry,
    verifierKey: key as Hex,
    attestationTtlSeconds: integer(env["ATTESTATION_TTL_SECONDS"], 3600, "ATTESTATION_TTL_SECONDS"),
    rateLimitPerMinute: integer(env["RATE_LIMIT_PER_MINUTE"], 10, "RATE_LIMIT_PER_MINUTE"),
    trustProxy: env["TRUST_PROXY"] === "1" || env["TRUST_PROXY"] === "true",
    dnsServers: dns ? dns.split(",").map((s) => s.trim()).filter(Boolean) : undefined,
    demo: payTo
      ? {
          payTo: payTo as Address,
          price: BigInt(integer(env["DEMO_PRICE"], 10_000, "DEMO_PRICE")),
          facilitators,
          resourceUrl: env["DEMO_RESOURCE_URL"] ?? "https://payhole.org/api/demo/article",
          timeoutMs: integer(env["FACILITATOR_TIMEOUT_MS"], 30_000, "FACILITATOR_TIMEOUT_MS"),
        }
      : undefined,
  };
}
