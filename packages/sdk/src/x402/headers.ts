import { X402ProtocolError } from "../errors.js";
import type { AnyPaymentRequired, PaymentRequirements, PaymentRequirementsV1, SettleResponse } from "./types.js";

export const HEADER_PAYMENT_REQUIRED = "payment-required";
export const HEADER_PAYMENT_SIGNATURE = "payment-signature";
export const HEADER_PAYMENT_RESPONSE = "payment-response";
export const HEADER_X_PAYMENT = "x-payment";
export const HEADER_X_PAYMENT_RESPONSE = "x-payment-response";

const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;

/** Standard base64 (with padding, no whitespace) of the UTF-8 JSON encoding, as the reference SDK produces. */
export function encodeBase64Json(value: unknown): string {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/** Inverse of {@link encodeBase64Json}; rejects base64url, whitespace, and anything that is not JSON. */
export function decodeBase64Json<T = unknown>(text: string): T {
  const trimmed = text.trim();
  if (!BASE64.test(trimmed)) throw new X402ProtocolError("header is not standard base64");
  let binary: string;
  try {
    binary = atob(trimmed);
  } catch {
    throw new X402ProtocolError("header is not valid base64");
  }
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as T;
  } catch {
    throw new X402ProtocolError("header does not decode to JSON");
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireString(record: Record<string, unknown>, key: string, where: string): string {
  const value = record[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new X402ProtocolError(`${where}.${key} must be a non-empty string`);
  }
  return value;
}

function requireNumber(record: Record<string, unknown>, key: string, where: string): number {
  const value = record[key];
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new X402ProtocolError(`${where}.${key} must be a positive number`);
  }
  return value;
}

function validateRequirementsV2(value: unknown, index: number): PaymentRequirements {
  const where = `accepts[${index}]`;
  if (!isRecord(value)) throw new X402ProtocolError(`${where} must be an object`);
  const network = requireString(value, "network", where);
  if (!network.includes(":")) throw new X402ProtocolError(`${where}.network must be a CAIP-2 identifier`);
  const extra = value["extra"];
  if (extra !== undefined && extra !== null && !isRecord(extra)) {
    throw new X402ProtocolError(`${where}.extra must be an object`);
  }
  return {
    scheme: requireString(value, "scheme", where),
    network,
    asset: requireString(value, "asset", where),
    amount: requireString(value, "amount", where),
    payTo: requireString(value, "payTo", where),
    maxTimeoutSeconds: requireNumber(value, "maxTimeoutSeconds", where),
    ...(extra === undefined ? {} : { extra }),
  };
}

function validateRequirementsV1(value: unknown, index: number): PaymentRequirementsV1 {
  const where = `accepts[${index}]`;
  if (!isRecord(value)) throw new X402ProtocolError(`${where} must be an object`);
  const extra = value["extra"];
  if (extra !== undefined && extra !== null && !isRecord(extra)) {
    throw new X402ProtocolError(`${where}.extra must be an object`);
  }
  const outputSchema = value["outputSchema"];
  return {
    scheme: requireString(value, "scheme", where),
    network: requireString(value, "network", where),
    maxAmountRequired: requireString(value, "maxAmountRequired", where),
    resource: requireString(value, "resource", where),
    description: typeof value["description"] === "string" ? value["description"] : "",
    mimeType: typeof value["mimeType"] === "string" ? value["mimeType"] : "",
    ...(isRecord(outputSchema) ? { outputSchema } : {}),
    payTo: requireString(value, "payTo", where),
    maxTimeoutSeconds: requireNumber(value, "maxTimeoutSeconds", where),
    asset: requireString(value, "asset", where),
    ...(extra === undefined ? {} : { extra }),
  };
}

/** Structural validation of a decoded payment request of either version. */
export function validatePaymentRequired(value: unknown): AnyPaymentRequired {
  if (!isRecord(value)) throw new X402ProtocolError("payment request must be an object");
  const accepts = value["accepts"];
  if (!Array.isArray(accepts) || accepts.length === 0) {
    throw new X402ProtocolError("payment request must list at least one accepts entry");
  }
  const error = typeof value["error"] === "string" ? { error: value["error"] } : {};
  if (value["x402Version"] === 2) {
    const resource = value["resource"];
    if (!isRecord(resource) || typeof resource["url"] !== "string") {
      throw new X402ProtocolError("v2 payment request must carry resource.url");
    }
    const extensions = value["extensions"];
    return {
      x402Version: 2,
      ...error,
      resource: resource as { url: string },
      accepts: accepts.map(validateRequirementsV2),
      ...(isRecord(extensions) ? { extensions } : {}),
    };
  }
  if (value["x402Version"] === 1) {
    return { x402Version: 1, ...error, accepts: accepts.map(validateRequirementsV1) };
  }
  throw new X402ProtocolError("unsupported x402Version");
}

/**
 * Reads a payment request from a 402 response: the PAYMENT-REQUIRED header first (v2), then a JSON body
 * (v1, or v2 servers that mirror the header into the body). Returns null when the response is a plain 402.
 */
export function parsePaymentRequired(
  getHeader: (name: string) => string | null | undefined,
  body?: string | null,
): AnyPaymentRequired | null {
  const header = getHeader(HEADER_PAYMENT_REQUIRED);
  if (header) return validatePaymentRequired(decodeBase64Json(header));
  if (body) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch {
      return null;
    }
    if (isRecord(parsed) && (parsed["x402Version"] === 1 || parsed["x402Version"] === 2) && Array.isArray(parsed["accepts"])) {
      return validatePaymentRequired(parsed);
    }
  }
  return null;
}

/** Reads the settlement result from the retried response, if the server attached one. */
export function parseSettleResponse(getHeader: (name: string) => string | null | undefined): SettleResponse | null {
  const header = getHeader(HEADER_PAYMENT_RESPONSE) ?? getHeader(HEADER_X_PAYMENT_RESPONSE);
  if (!header) return null;
  const decoded = decodeBase64Json<unknown>(header);
  if (!isRecord(decoded) || typeof decoded["success"] !== "boolean") {
    throw new X402ProtocolError("settlement header is malformed");
  }
  return {
    ...decoded,
    success: decoded["success"],
    transaction: typeof decoded["transaction"] === "string" ? decoded["transaction"] : "",
    network: typeof decoded["network"] === "string" ? decoded["network"] : "",
  };
}

/** Header name that carries the signed payment for the given protocol version. */
export function paymentHeaderName(version: 1 | 2): string {
  return version === 2 ? HEADER_PAYMENT_SIGNATURE : HEADER_X_PAYMENT;
}

/** True when a request already carries a payment header of either version. */
export function hasPaymentHeader(headers: Headers): boolean {
  return headers.has(HEADER_PAYMENT_SIGNATURE) || headers.has(HEADER_X_PAYMENT);
}
