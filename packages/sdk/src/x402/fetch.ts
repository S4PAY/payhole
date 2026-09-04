import type { Address } from "viem";
import { PaymentAlreadyAttemptedError, PaymentRefusedError } from "../errors.js";
import { hasPaymentHeader, parsePaymentRequired, parseSettleResponse } from "./headers.js";
import type { TypedDataSigner } from "./eip3009.js";
import { preparePayment } from "./payment.js";
import { selectOffer } from "./select.js";
import type { PaymentOffer, PaymentReceipt, SettleResponse } from "./types.js";

export type SpendDecision = { allow: true } | { allow: false; reason: string };

export interface X402FetchOptions {
  /** Signs the EIP-3009 authorization; its address is the payer. */
  signer: TypedDataSigner;
  chainId: number;
  asset: Address;
  fetch?: typeof globalThis.fetch;
  /**
   * Decides whether to pay an offer. This is where caps live: return `allow: false` to refuse before
   * anything is signed. May do work of its own, such as topping the payer up from a BudgetAccount.
   */
  authorize?: (offer: PaymentOffer, url: URL) => Promise<SpendDecision> | SpendDecision;
  /** Called after the retried request returns, whatever its status. */
  onPaid?: (receipt: PaymentReceipt) => Promise<void> | void;
  nowSeconds?: () => number;
}

/**
 * Wraps `fetch` with x402 handling: a 402 is parsed, an acceptable offer is selected and authorized,
 * a payment is signed and the request is retried once with the payment header. Anything other than a
 * payable 402 is returned untouched. A refused payment throws {@link PaymentRefusedError}.
 */
export function createX402Fetch(options: X402FetchOptions): typeof globalThis.fetch {
  const baseFetch = options.fetch ?? globalThis.fetch.bind(globalThis);
  return async (input, init) => {
    const request = new Request(input, init);
    if (hasPaymentHeader(request.headers)) throw new PaymentAlreadyAttemptedError("request already carries a payment header");
    const first = await baseFetch(request.clone());
    if (first.status !== 402) return first;

    const body = await first.clone().text();
    const required = parsePaymentRequired((name) => first.headers.get(name), body);
    if (!required) return first;

    const offer = selectOffer(required, { chainId: options.chainId, asset: options.asset });
    const url = new URL(request.url);
    const decision = options.authorize ? await options.authorize(offer, url) : { allow: true as const };
    if (!decision.allow) {
      throw new PaymentRefusedError(`payment of ${offer.amount.toString()} refused: ${decision.reason}`, decision.reason, offer.amount);
    }

    const payment = await preparePayment(options.signer, offer, options.nowSeconds?.());
    const retry = new Request(request, { headers: new Headers(request.headers) });
    retry.headers.set(payment.headerName, payment.headerValue);
    const second = await baseFetch(retry);

    let settlement: SettleResponse | null;
    try {
      settlement = parseSettleResponse((name) => second.headers.get(name));
    } catch {
      settlement = null;
    }
    await options.onPaid?.({
      url: request.url,
      offer,
      authorization: payment.authorization,
      signature: payment.signature,
      status: second.status,
      settlement,
    });
    return second;
  };
}
