import { isIP } from "node:net";
import { isAddress, type Address, type Hex } from "viem";
import { chainConfig, deployments } from "@payhole/sdk";
import { isUpstream } from "./render/dnsmasq.js";
import { CATEGORIES, parseCategory, type Category } from "./category.js";

/** The curated allowlist every node fetches unless ALLOWLIST_URLS says otherwise. */
export const DEFAULT_ALLOWLIST_URL = "https://raw.githubusercontent.com/S4PAY/payhole/main/packages/sinkhole/lists/allow.txt";

export interface SinkholeConfig {
  dns: { listen: string; port: number; upstream: string[]; cacheSize: number; user: string | undefined; binary: string };
  admin: { listen: string; port: number; token: string | undefined };
  dataDir: string;
  extension: { url: string | undefined; pullMinutes: number };
  manualFile: string | undefined;
  flags: { threshold: number; ttlDays: number; reannounceMinutes: number; fastLaneThreshold: number; fastLaneCategories: Category[] };
  swarm: { enabled: boolean; listen: string[]; bootstrap: string[]; mdns: boolean };
  membership: {
    minTier: number;
    rpcUrl: string;
    chainId: number;
    vault: Address | undefined;
    operatorKey: Hex | undefined;
    operatorAddress: Address | undefined;
    proofJson: string | undefined;
  };
  probe: { allowPrivate: boolean };
  reports: { delegates: boolean; evidence: boolean; minHoldUsd: number; ponsFactory: string | undefined; priceUrl: string | undefined; priceJsonPath: string | undefined };
  queryLog: { enabled: boolean };
  lists: { urls: string[]; refreshHours: number };
  /** Names never blocked: fetched rule lists plus an optional local file. Refreshed with the blocklists. */
  allow: { urls: string[]; file: string | undefined };
  /** DNS over HTTPS on plain HTTP, meant to sit behind a TLS-terminating reverse proxy. */
  doh: { enabled: boolean; listen: string; port: number };
  /** DNS over TLS with the node's own certificate files. */
  dot: { enabled: boolean; listen: string; port: number; certFile: string | undefined; keyFile: string | undefined };
  /** Queries per minute per client address, shared by both encrypted transports. */
  dnsRateLimitPerMinute: number;
}

function integer(value: string | undefined, fallback: number, name: string, min = 1): number {
  if (value === undefined || value === "") return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < min) throw new Error(`${name} must be an integer of at least ${min}`);
  return n;
}

function flag(value: string | undefined, fallback = false): boolean {
  if (value === undefined || value === "") return fallback;
  return value === "1" || value.toLowerCase() === "true" || value.toLowerCase() === "yes";
}

function categories(value: string): Category[] {
  const out: Category[] = [];
  for (const raw of value.split(",")) {
    const item = raw.trim();
    if (item.length === 0) continue;
    const category = parseCategory(item);
    if (!category) throw new Error(`FAST_LANE_CATEGORIES has ${JSON.stringify(item)}; valid: ${CATEGORIES.join(", ")}`);
    out.push(category);
  }
  return out;
}

function list(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function optional(value: string | undefined): string | undefined {
  return value === undefined || value.trim() === "" ? undefined : value.trim();
}

/** BurnVault address from the SDK deployment record, if the record has one. */
export function defaultBurnVault(): Address | undefined {
  const entry = (deployments.contracts as Record<string, { address?: string } | undefined>)["BurnVault"];
  return entry?.address !== undefined && isAddress(entry.address) ? entry.address : undefined;
}

/** Reads the service configuration from the environment. Secrets never come from anywhere else. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): SinkholeConfig {
  const listen = env["DNS_LISTEN"] ?? "0.0.0.0";
  if (isIP(listen) === 0) throw new Error("DNS_LISTEN must be an IP address");
  const upstream = list(env["UPSTREAM_DNS"] ?? "1.1.1.1,9.9.9.9");
  if (upstream.length === 0) throw new Error("UPSTREAM_DNS must list at least one resolver");
  for (const server of upstream) {
    if (!isUpstream(server)) throw new Error(`UPSTREAM_DNS entry ${JSON.stringify(server)} must be ip or ip#port`);
  }
  const adminListen = env["ADMIN_LISTEN"] ?? "0.0.0.0";
  if (isIP(adminListen) === 0) throw new Error("ADMIN_LISTEN must be an IP address");

  const operatorKey = optional(env["NODE_OPERATOR_KEY"]);
  if (operatorKey !== undefined && !/^0x[0-9a-fA-F]{64}$/.test(operatorKey)) {
    throw new Error("NODE_OPERATOR_KEY must be a 32-byte hex private key");
  }
  const operatorAddress = optional(env["NODE_OPERATOR_ADDRESS"]);
  if (operatorAddress !== undefined && !isAddress(operatorAddress)) throw new Error("NODE_OPERATOR_ADDRESS must be an EVM address");
  const vault = optional(env["BURN_VAULT_ADDRESS"]);
  if (vault !== undefined && !isAddress(vault)) throw new Error("BURN_VAULT_ADDRESS must be an EVM address");

  const dohListen = env["DOH_LISTEN"] ?? "0.0.0.0";
  if (isIP(dohListen) === 0) throw new Error("DOH_LISTEN must be an IP address");
  const dotListen = env["DOT_LISTEN"] ?? "0.0.0.0";
  if (isIP(dotListen) === 0) throw new Error("DOT_LISTEN must be an IP address");
  const dotEnabled = flag(env["DOT_ENABLED"]);
  const certFile = optional(env["DOT_CERT_FILE"]);
  const keyFile = optional(env["DOT_KEY_FILE"]);
  if (dotEnabled && (!certFile || !keyFile)) throw new Error("DOT_ENABLED=1 needs DOT_CERT_FILE and DOT_KEY_FILE");

  const extensionUrl = optional(env["EXTENSION_BLOCKLIST_URL"]);
  if (extensionUrl !== undefined && !/^https?:\/\//i.test(extensionUrl)) throw new Error("EXTENSION_BLOCKLIST_URL must be an http(s) URL");

  return {
    dns: {
      listen,
      port: integer(env["DNS_PORT"], 53, "DNS_PORT"),
      upstream,
      cacheSize: integer(env["DNS_CACHE_SIZE"], 10_000, "DNS_CACHE_SIZE", 0),
      user: optional(env["DNSMASQ_USER"]),
      binary: optional(env["DNSMASQ_BINARY"]) ?? "dnsmasq",
    },
    admin: {
      listen: adminListen,
      port: integer(env["ADMIN_PORT"], 8053, "ADMIN_PORT"),
      token: optional(env["ADMIN_TOKEN"]),
    },
    dataDir: optional(env["DATA_DIR"]) ?? "/data",
    extension: { url: extensionUrl, pullMinutes: integer(env["EXTENSION_PULL_MINUTES"], 15, "EXTENSION_PULL_MINUTES") },
    manualFile: optional(env["MANUAL_BLOCKLIST_FILE"]),
    flags: {
      threshold: integer(env["FLAG_THRESHOLD"], 5, "FLAG_THRESHOLD"),
      ttlDays: integer(env["FLAG_TTL_DAYS"], 30, "FLAG_TTL_DAYS"),
      reannounceMinutes: integer(env["FLAG_REANNOUNCE_MINUTES"], 30, "FLAG_REANNOUNCE_MINUTES"),
      fastLaneThreshold: integer(env["FAST_LANE_THRESHOLD"], 2, "FAST_LANE_THRESHOLD"),
      fastLaneCategories: categories(env["FAST_LANE_CATEGORIES"] ?? "infra,drainer"),
    },
    swarm: {
      enabled: flag(env["SWARM_ENABLED"], true),
      listen: list(env["SWARM_LISTEN"] ?? "/ip4/0.0.0.0/tcp/4001"),
      bootstrap: list(env["SWARM_BOOTSTRAP"]),
      mdns: flag(env["SWARM_MDNS"]),
    },
    membership: {
      minTier: integer(env["MIN_TIER"], 1, "MIN_TIER", 0),
      rpcUrl: optional(env["RPC_URL"]) ?? chainConfig.rpc,
      chainId: integer(env["CHAIN_ID"], chainConfig.chainId, "CHAIN_ID"),
      vault: vault ?? defaultBurnVault(),
      operatorKey: operatorKey as Hex | undefined,
      operatorAddress,
      proofJson: optional(env["NODE_PROOF_JSON"]),
    },
    probe: { allowPrivate: flag(env["PROBE_ALLOW_PRIVATE"]) },
    reports: {
      delegates: flag(env["REPORT_DELEGATES"]),
      evidence: flag(env["EVIDENCE_ENABLED"]),
      minHoldUsd: integer(env["MIN_HOLD_USD"], 10, "MIN_HOLD_USD", 0),
      ponsFactory: optional(env["PONS_FACTORY"]),
      priceUrl: optional(env["PRICE_URL"]),
      priceJsonPath: optional(env["PRICE_JSON_PATH"]),
    },
    queryLog: { enabled: flag(env["QUERY_LOG_ENABLED"], true) },
    lists: { urls: list(env["BLOCKLIST_URLS"]), refreshHours: integer(env["BLOCKLIST_REFRESH_HOURS"], 24, "BLOCKLIST_REFRESH_HOURS") },
    allow: {
      urls: env["ALLOWLIST_URLS"] === undefined ? [DEFAULT_ALLOWLIST_URL] : list(env["ALLOWLIST_URLS"]),
      file: optional(env["MANUAL_ALLOWLIST_FILE"]),
    },
    doh: { enabled: flag(env["DOH_ENABLED"]), listen: dohListen, port: integer(env["DOH_PORT"], 8054, "DOH_PORT") },
    dot: { enabled: dotEnabled, listen: dotListen, port: integer(env["DOT_PORT"], 853, "DOT_PORT"), certFile, keyFile },
    dnsRateLimitPerMinute: integer(env["DNS_RATE_LIMIT_PER_MINUTE"], 300, "DNS_RATE_LIMIT_PER_MINUTE"),
  };
}
