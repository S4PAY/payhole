import { formatUnits, parseUnits } from "viem";
import { USDG_DECIMALS } from "./chain.js";
import { PayholeError } from "./errors.js";

const DECIMAL = /^\d+(\.\d{1,6})?$/;

/** Parses a USDG amount written the way people write money ("0.50", 5, "5") into 6-decimal base units. */
export function parseUsdg(value: string | number): bigint {
  const text = typeof value === "number" ? String(value) : value.trim();
  if (!DECIMAL.test(text)) throw new PayholeError(`invalid USDG amount "${text}": use a positive decimal with at most 6 places`);
  return parseUnits(text, USDG_DECIMALS);
}

/**
 * Formats base units as a USDG decimal with at least `places` fraction digits ("5.00", "0.12"). Smaller
 * amounts keep the digits they need ("0.0001") instead of rounding to nothing.
 */
export function formatUsdg(amount: bigint, places = 2): string {
  const text = formatUnits(amount, USDG_DECIMALS);
  const [whole = "0", fraction = ""] = text.split(".");
  const trimmed = fraction.replace(/0+$/, "");
  const digits = trimmed.length > places ? trimmed : trimmed.padEnd(places, "0");
  return digits.length === 0 ? whole : `${whole}.${digits}`;
}
