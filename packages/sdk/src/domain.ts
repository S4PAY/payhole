import { keccak256, stringToBytes, type Hex } from "viem";

/**
 * Lowercase ASCII hostname without a trailing dot, the form CreatorRegistry hashes. Accepts a bare host
 * or a URL; internationalised names are converted to punycode by the URL parser.
 */
export function normalizeHostname(input: string): string {
  const candidate = input.includes("://") ? input : `https://${input}`;
  const hostname = new URL(candidate).hostname.toLowerCase();
  return hostname.endsWith(".") ? hostname.slice(0, -1) : hostname;
}

/** `keccak256(bytes(hostname))`, the `domainHash` used by CreatorRegistry. */
export function domainHash(hostnameOrUrl: string): Hex {
  return keccak256(stringToBytes(normalizeHostname(hostnameOrUrl)));
}
