import type { Address, Hex } from "viem";

/** Version 2 resource description carried in a 402. */
export interface ResourceInfo {
  url: string;
  description?: string;
  mimeType?: string;
  [key: string]: unknown;
}

/** Version 2 `accepts` entry. */
export interface PaymentRequirements {
  scheme: string;
  network: string;
  asset: string;
  amount: string;
  payTo: string;
  maxTimeoutSeconds: number;
  extra?: Record<string, unknown> | null;
}

/** Version 2 payment request, carried base64-encoded in the PAYMENT-REQUIRED header. */
export interface PaymentRequired {
  x402Version: 2;
  error?: string;
  resource: ResourceInfo;
  accepts: PaymentRequirements[];
  extensions?: Record<string, unknown>;
}

/** Version 1 `accepts` entry. */
export interface PaymentRequirementsV1 {
  scheme: string;
  network: string;
  maxAmountRequired: string;
  resource: string;
  description: string;
  mimeType: string;
  outputSchema?: Record<string, unknown> | null;
  payTo: string;
  maxTimeoutSeconds: number;
  asset: string;
  extra?: Record<string, unknown> | null;
}

/** Version 1 payment request, carried as the JSON body of the 402. */
export interface PaymentRequiredV1 {
  x402Version: 1;
  error?: string;
  accepts: PaymentRequirementsV1[];
}

export type AnyPaymentRequired = PaymentRequired | PaymentRequiredV1;

/** EIP-3009 authorization message signed by the payer. Numbers are decimal strings. */
export interface Eip3009Authorization {
  from: Address;
  to: Address;
  value: string;
  validAfter: string;
  validBefore: string;
  nonce: Hex;
}

export interface ExactEip3009Payload {
  signature: Hex;
  authorization: Eip3009Authorization;
}

export interface PaymentPayload {
  x402Version: 2;
  resource?: ResourceInfo;
  accepted: PaymentRequirements;
  payload: ExactEip3009Payload;
  extensions?: Record<string, unknown>;
}

export interface PaymentPayloadV1 {
  x402Version: 1;
  scheme: string;
  network: string;
  payload: ExactEip3009Payload;
}

/** Settlement result carried in PAYMENT-RESPONSE (v2) or X-PAYMENT-RESPONSE (v1). */
export interface SettleResponse {
  success: boolean;
  errorReason?: string;
  errorMessage?: string;
  payer?: string;
  transaction: string;
  network: string;
  amount?: string;
  [key: string]: unknown;
}

/** One acceptable way to pay, normalised across protocol versions. */
export interface PaymentOffer {
  version: 1 | 2;
  scheme: string;
  /** Network exactly as the server wrote it, echoed back in the payload. */
  network: string;
  chainId: number;
  asset: Address;
  amount: bigint;
  payTo: Address;
  maxTimeoutSeconds: number;
  eip712: { name: string; version: string };
  /** The `accepts` entry exactly as received; echoed verbatim for v2. */
  raw: PaymentRequirements | PaymentRequirementsV1;
  resource?: ResourceInfo;
  extensions?: Record<string, unknown>;
  error?: string;
}

/** Everything a caller needs to attach a payment to the retried request. */
export interface PreparedPayment {
  headerName: string;
  headerValue: string;
  payload: PaymentPayload | PaymentPayloadV1;
  authorization: Eip3009Authorization;
  signature: Hex;
  offer: PaymentOffer;
}

export interface PaymentReceipt {
  url: string;
  offer: PaymentOffer;
  authorization: Eip3009Authorization;
  signature: Hex;
  status: number;
  settlement: SettleResponse | null;
}
