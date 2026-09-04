import { getAddress, isAddress, type Address } from "viem";
import {
  HEADER_PAYMENT_REQUIRED,
  HEADER_PAYMENT_RESPONSE,
  decodeBase64Json,
  encodeBase64Json,
  formatUsdg,
  type PaymentPayload,
  type PaymentRequired,
  type PaymentRequirements,
  type SettleResponse,
} from "@payhole/sdk";

/** A paid resource that shows the x402 loop end to end: 402, signed retry, facilitator settlement, 200. */
export interface DemoConfig {
  /** Wallet that receives every payment. */
  payTo: Address;
  /** Price in USDG base units (6 decimals). */
  price: bigint;
  /** USDG contract on the chain the demo runs on. */
  asset: Address;
  /** CAIP-2 network id, for example eip155:4663. */
  network: string;
  /** Public URL of the resource, echoed in the payment request. */
  resourceUrl: string;
  /** Facilitator base URLs, tried in order for verification. */
  facilitators: string[];
  /** Timeout for each facilitator call. */
  timeoutMs: number;
}

export interface DemoDeps {
  config: DemoConfig;
  fetch?: typeof fetch;
}

export interface DemoResponse {
  status: number;
  headers: Record<string, string>;
  body: unknown;
}

/** A payment that was received but cannot be accepted; the reason goes back to the client. */
export class DemoPaymentError extends Error {
  override name = "DemoPaymentError";
  constructor(
    readonly reason: string,
    message: string,
  ) {
    super(message);
  }
}

/** No facilitator could answer; the server reports an outage rather than a bad payment. */
export class DemoFacilitatorError extends Error {
  override name = "DemoFacilitatorError";
}

export const ARTICLE = {
  title: "The page that paid for itself",
  paragraphs: [
    "You did not log in, enter a card, or click through a paywall. This page asked for a hundredth of a dollar, your PayHole pocket paid it from an address that exists only for payhole.org, and the article loaded. That is the whole idea.",
    "Under the hood it was one HTTP round trip more than usual. The server answered the first request with status 402 and a header describing the price, the token, and the wallet to pay. The extension signed a transfer authorization for exactly that amount, never more, and sent the request again with the signature attached.",
    "A facilitator, a service any site can use, checked the signature and settled the transfer on Robinhood Chain. Settlement took a few seconds and cost you nothing beyond the price. The server then served the article and attached the transaction hash, which the page shows below.",
    "The address that paid is derived from your seed for this site alone. It holds a small float topped up from your pocket, and it cannot spend past the cap you set for payhole.org. The site never learns your other addresses, your balance, or what you paid anywhere else.",
    "Every load of this article pays again. That is deliberate: it is the smallest honest demonstration of a page that charges per read, and it is what any site or API can do with a 402 and a header, with no PayHole code on their side.",
  ],
};

export function requirementsFor(config: DemoConfig): PaymentRequirements {
  return {
    scheme: "exact",
    network: config.network,
    asset: config.asset,
    amount: config.price.toString(),
    payTo: config.payTo,
    maxTimeoutSeconds: 300,
    extra: { name: "Global Dollar", version: "1" },
  };
}

export function paymentRequiredFor(config: DemoConfig): PaymentRequired {
  return {
    x402Version: 2,
    resource: { url: config.resourceUrl, description: "One article, paid per load", mimeType: "application/json" },
    accepts: [requirementsFor(config)],
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sameAddress(a: unknown, b: string): boolean {
  return typeof a === "string" && isAddress(a) && getAddress(a) === getAddress(b);
}

/** Decodes the PAYMENT-SIGNATURE header into a version 2 payload, or explains why it cannot be used. */
export function decodePaymentPayload(header: string): PaymentPayload {
  let value: unknown;
  try {
    value = decodeBase64Json(header);
  } catch {
    throw new DemoPaymentError("malformed_payment", "PAYMENT-SIGNATURE is not base64 JSON");
  }
  if (!isRecord(value) || value["x402Version"] !== 2) throw new DemoPaymentError("unsupported_version", "only x402 version 2 payloads are accepted");
  const accepted = value["accepted"];
  const payload = value["payload"];
  if (!isRecord(accepted) || !isRecord(payload) || !isRecord(payload["authorization"]) || typeof payload["signature"] !== "string") {
    throw new DemoPaymentError("malformed_payment", "payload lacks accepted requirements, an authorization, or a signature");
  }
  return value as unknown as PaymentPayload;
}

/** The first field on which the client's payload disagrees with the offer, or null when it matches. */
export function mismatch(payload: PaymentPayload, requirements: PaymentRequirements): string | null {
  const a = payload.accepted;
  if (a.scheme !== requirements.scheme) return "scheme";
  if (a.network !== requirements.network) return "network";
  if (!sameAddress(a.asset, requirements.asset)) return "asset";
  if (!sameAddress(a.payTo, requirements.payTo)) return "payTo";
  if (a.amount !== requirements.amount) return "amount";
  const auth = payload.payload.authorization;
  if (!sameAddress(auth.to, requirements.payTo)) return "authorization.to";
  if (auth.value !== requirements.amount) return "authorization.value";
  return null;
}

async function post(fetchImpl: typeof fetch, url: string, body: unknown, timeoutMs: number): Promise<{ status: number; json: unknown }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await res.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    return { status: res.status, json };
  } finally {
    clearTimeout(timer);
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function text(value: unknown, fallback: string): string {
  return typeof value === "string" && value !== "" ? value : fallback;
}

/**
 * Verifies with the first facilitator that answers, then settles with that same facilitator.
 * A facilitator that cannot be reached for verification is skipped; a settlement that cannot be
 * reached is not retried elsewhere, because the first facilitator may already have broadcast it.
 */
export async function verifyAndSettle(deps: DemoDeps, payload: PaymentPayload, requirements: PaymentRequirements): Promise<{ facilitator: string; settlement: SettleResponse }> {
  const fetchImpl = deps.fetch ?? fetch;
  const body = { x402Version: 2, paymentPayload: payload, paymentRequirements: requirements };
  const failures: string[] = [];
  for (const base of deps.config.facilitators) {
    let verify: { status: number; json: unknown };
    try {
      verify = await post(fetchImpl, `${base}/verify`, body, deps.config.timeoutMs);
    } catch (error) {
      failures.push(`${base}: ${describe(error)}`);
      continue;
    }
    const v = verify.json;
    if (!isRecord(v) || typeof v["isValid"] !== "boolean") {
      failures.push(`${base}: verify answered ${verify.status} without a result`);
      continue;
    }
    if (!v["isValid"]) {
      throw new DemoPaymentError(text(v["invalidReason"], "invalid_payment"), text(v["invalidMessage"], `${base} rejected the payment`));
    }
    let settle: { status: number; json: unknown };
    try {
      settle = await post(fetchImpl, `${base}/settle`, body, deps.config.timeoutMs);
    } catch (error) {
      throw new DemoFacilitatorError(`${base}: settlement status unknown: ${describe(error)}`);
    }
    const s = settle.json;
    if (!isRecord(s) || typeof s["success"] !== "boolean") throw new DemoFacilitatorError(`${base}: settle answered ${settle.status} without a result`);
    if (!s["success"]) {
      throw new DemoPaymentError(text(s["errorReason"], "settlement_failed"), text(s["errorMessage"], `${base} could not settle the payment`));
    }
    const settlement: SettleResponse = {
      success: true,
      transaction: typeof s["transaction"] === "string" ? s["transaction"] : "",
      network: typeof s["network"] === "string" ? s["network"] : requirements.network,
      ...(typeof s["payer"] === "string" ? { payer: s["payer"] } : {}),
      ...(typeof s["amount"] === "string" ? { amount: s["amount"] } : {}),
    };
    return { facilitator: base, settlement };
  }
  throw new DemoFacilitatorError(`no facilitator answered: ${failures.join("; ")}`);
}

/** Answers one request for the article, given the PAYMENT-SIGNATURE header if the client sent one. */
export async function demoResponse(deps: DemoDeps, paymentHeader: string | undefined): Promise<DemoResponse> {
  const requirements = requirementsFor(deps.config);
  const required = paymentRequiredFor(deps.config);
  const price = `${formatUsdg(deps.config.price)} USDG`;
  const challenge = (extra: Record<string, unknown>, settlement?: SettleResponse): DemoResponse => ({
    status: 402,
    headers: {
      [HEADER_PAYMENT_REQUIRED]: encodeBase64Json(required),
      ...(settlement ? { [HEADER_PAYMENT_RESPONSE]: encodeBase64Json(settlement) } : {}),
    },
    body: { error: "payment_required", price, payTo: deps.config.payTo, network: deps.config.network, ...extra, accepts: required.accepts },
  });

  if (!paymentHeader) return challenge({ message: `This article costs ${price}. Install PayHole and load it again.` });

  let payload: PaymentPayload;
  try {
    payload = decodePaymentPayload(paymentHeader);
  } catch (error) {
    if (error instanceof DemoPaymentError) return challenge({ reason: error.reason, message: error.message });
    throw error;
  }
  const why = mismatch(payload, requirements);
  if (why) return challenge({ reason: "requirements_mismatch", message: `the payment does not match the offer: ${why}` });

  try {
    const { settlement } = await verifyAndSettle(deps, payload, requirements);
    return {
      status: 200,
      headers: { [HEADER_PAYMENT_RESPONSE]: encodeBase64Json(settlement) },
      body: {
        ...ARTICLE,
        paid: { amount: requirements.amount, price, asset: requirements.asset, payTo: requirements.payTo, network: settlement.network, transaction: settlement.transaction, ...(settlement.payer ? { payer: settlement.payer } : {}) },
      },
    };
  } catch (error) {
    if (error instanceof DemoPaymentError) {
      return challenge({ reason: error.reason, message: error.message }, { success: false, errorReason: error.reason, errorMessage: error.message, transaction: "", network: requirements.network });
    }
    throw error;
  }
}
