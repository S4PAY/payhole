import { formatUnits, isAddress, parseUnits } from "viem";

export const USDG_DECIMALS = 6;

/** "1.25 USDG" from base units. */
export function formatUsdg(amount: bigint): string {
  return `${formatUnits(amount, USDG_DECIMALS)} USDG`;
}

/** Plain decimal text of base units, without the unit suffix. */
export function formatAmount(amount: bigint): string {
  return formatUnits(amount, USDG_DECIMALS);
}

/** Base units from user input such as "0.5". Throws on anything that is not a decimal number. */
export function parseUsdg(text: string): bigint {
  const trimmed = text.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) throw new Error(`"${text}" is not a decimal amount`);
  return parseUnits(trimmed, USDG_DECIMALS);
}

/** Parses a decimal string of base units as stored in settings and the ledger. */
export function toBigint(text: string | undefined, fallback = 0n): bigint {
  if (text === undefined || !/^\d+$/.test(text)) return fallback;
  return BigInt(text);
}

export function shortAddress(address: string): string {
  return address.length > 12 ? `${address.slice(0, 6)}...${address.slice(-4)}` : address;
}

/** UTC day bucket used for daily totals. */
export function dayKey(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 10);
}

export function isAddressText(text: string): boolean {
  return isAddress(text);
}

export function formatTimestamp(timestamp: number): string {
  return new Date(timestamp).toLocaleString();
}

/** Error text for the UI: the first line of a viem error, or the message. */
export function errorText(error: unknown): string {
  if (error instanceof Error) {
    const line = error.message.split("\n").find((l) => l.trim().length > 0);
    return line ?? error.name;
  }
  return String(error);
}
