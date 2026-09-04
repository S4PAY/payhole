import { getAddress, isAddress, type Address } from "viem";
import { NoAcceptableOfferError } from "../errors.js";
import type { AnyPaymentRequired, PaymentOffer, PaymentRequirements, PaymentRequirementsV1 } from "./types.js";

/** Version 1 network slugs used by facilitators on Robinhood Chain. Version 2 uses CAIP-2 identifiers. */
export const V1_NETWORK_SLUGS: Readonly<Record<string, number>> = { robinhood: 4663 };

export interface SelectionCriteria {
  chainId: number;
  /** The only asset PayHole settles in. */
  asset: Address;
}

/** Parses `eip155:<id>`; also accepts the v1 slugs above. Returns null for anything else. */
export function chainIdFromNetwork(network: string): number | null {
  const match = /^eip155:(\d+)$/.exec(network);
  if (match?.[1]) return Number(match[1]);
  return V1_NETWORK_SLUGS[network] ?? null;
}

function eip712FromExtra(extra: Record<string, unknown> | null | undefined): { name: string; version: string } | null {
  if (!extra) return null;
  const name = extra["name"];
  const version = extra["version"];
  if (typeof name !== "string" || typeof version !== "string") return null;
  return { name, version };
}

function isPlainEip3009(extra: Record<string, unknown> | null | undefined): string | null {
  const method = extra?.["assetTransferMethod"];
  if (method !== undefined && method !== "eip3009") return `assetTransferMethod ${JSON.stringify(method)} is not eip3009`;
  const flow = extra?.["paymentFlow"];
  if (flow !== undefined && flow !== "authorization") return `paymentFlow ${JSON.stringify(flow)} is not authorization`;
  return null;
}

function normalise(
  required: AnyPaymentRequired,
  entry: PaymentRequirements | PaymentRequirementsV1,
  criteria: SelectionCriteria,
): PaymentOffer | string {
  if (entry.scheme !== "exact") return `scheme ${entry.scheme} is not exact`;
  const chainId = chainIdFromNetwork(entry.network);
  if (chainId !== criteria.chainId) return `network ${entry.network} is not chain ${criteria.chainId}`;
  if (!isAddress(entry.asset) || getAddress(entry.asset) !== getAddress(criteria.asset)) {
    return `asset ${entry.asset} is not USDG`;
  }
  if (!isAddress(entry.payTo)) return `payTo ${entry.payTo} is not an address`;
  const eip712 = eip712FromExtra(entry.extra);
  if (!eip712) return "extra.name and extra.version are required for EIP-3009";
  const notPlain = isPlainEip3009(entry.extra);
  if (notPlain) return notPlain;
  const amountText = "amount" in entry ? entry.amount : entry.maxAmountRequired;
  if (!/^\d+$/.test(amountText)) return `amount ${amountText} is not an integer`;
  const base: PaymentOffer = {
    version: required.x402Version,
    scheme: entry.scheme,
    network: entry.network,
    chainId,
    asset: getAddress(entry.asset),
    amount: BigInt(amountText),
    payTo: getAddress(entry.payTo),
    maxTimeoutSeconds: entry.maxTimeoutSeconds,
    eip712,
    raw: entry,
  };
  if (required.x402Version === 2) {
    base.resource = required.resource;
    if (required.extensions) base.extensions = required.extensions;
  }
  if (required.error) base.error = required.error;
  return base;
}

/**
 * Picks the first `accepts` entry PayHole can satisfy: scheme `exact`, the configured chain, USDG as the
 * asset, plain EIP-3009 transfer authorization. Throws with every rejection reason otherwise.
 */
export function selectOffer(required: AnyPaymentRequired, criteria: SelectionCriteria): PaymentOffer {
  const reasons: string[] = [];
  for (const entry of required.accepts as (PaymentRequirements | PaymentRequirementsV1)[]) {
    const result = normalise(required, entry, criteria);
    if (typeof result === "string") reasons.push(result);
    else return result;
  }
  throw new NoAcceptableOfferError(`no acceptable payment option: ${reasons.join("; ")}`, reasons);
}
