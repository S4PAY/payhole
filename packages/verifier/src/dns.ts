import { Resolver } from "node:dns/promises";
import { getAddress, isAddress, type Address } from "viem";

/** Returns the TXT record sets for a name; an empty array when the name has none. */
export type TxtResolver = (name: string) => Promise<string[][]>;

/** Resolver backed by the system DNS, or by explicit servers such as a public resolver. */
export function systemResolver(servers?: string[]): TxtResolver {
  const resolver = new Resolver();
  if (servers && servers.length > 0) resolver.setServers(servers);
  return async (name) => {
    try {
      return await resolver.resolveTxt(name);
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code === "ENOTFOUND" || code === "ENODATA" || code === "ESERVFAIL") return [];
      throw error;
    }
  };
}

/** Name of the TXT record a creator publishes: `_payhole.<hostname>`. */
export function txtRecordName(hostname: string): string {
  return `_payhole.${hostname}`;
}

export interface TxtMatch {
  found: boolean;
  /** Every wallet address found in the records, checksummed. */
  wallets: Address[];
  /** Raw record strings, for error messages. */
  seen: string[];
}

/**
 * Looks for `wallet` in the TXT records. Accepted forms, case-insensitive: `payhole=0x...`,
 * `wallet=0x...`, or a bare address. Chunked records are joined before matching.
 */
export function findWalletInTxt(records: string[][], wallet: Address): TxtMatch {
  const seen = records.map((chunks) => chunks.join(""));
  const wallets: Address[] = [];
  for (const record of seen) {
    for (const part of record.split(/[\s;,]+/)) {
      const value = part.replace(/^(payhole|wallet)=/i, "").trim().toLowerCase();
      if (isAddress(value)) wallets.push(getAddress(value));
    }
  }
  const target = getAddress(wallet);
  return { found: wallets.includes(target), wallets, seen };
}
