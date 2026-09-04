import type { Address } from "viem";
import {
  NoAcceptableOfferError,
  parseSettleResponse,
  preparePayment,
  selectOffer,
  type AnyPaymentRequired,
  type PaymentOffer,
  type SettleResponse,
  type TypedDataSigner,
} from "@payhole/sdk";
import type { FundingResult, SiteFunder } from "./budget";
import type { Ledger } from "./ledger";
import { AttemptLog } from "./observed";
import { decide, describeRefusal } from "./policy";

export interface PaymentRequest {
  /** Stable id of the observed offer: the webRequest requestId, or a page-generated id. */
  requestId: string;
  tabId: number;
  url: string;
  /** Origin charged: the page that made the request, or the destination of a navigation. */
  origin: string;
  paymentRequired: AnyPaymentRequired;
}

/** What the approval window shows; amounts are base-unit strings so the object can cross a message port. */
export interface ApprovalRequest {
  id: string;
  requestId: string;
  origin: string;
  url: string;
  amount: string;
  payTo: string;
  siteCap: string;
  siteSpent: string;
  globalCap: string;
  globalSpent: string;
  createdAt: number;
}

export interface PolicyContext {
  paused: boolean;
  globalCap: bigint;
  siteCap(origin: string): bigint;
  isBlocked(hostname: string): boolean;
}

export interface PaymentCoreDeps {
  chainId: number;
  usdg: Address;
  signerFor(origin: string): Promise<TypedDataSigner>;
  funder: SiteFunder;
  ledger: Ledger;
  policy(): Promise<PolicyContext> | PolicyContext;
  prompt(request: ApprovalRequest): Promise<boolean>;
  now?: () => number;
  log?: (message: string) => void;
}

export type PaymentOutcome =
  | {
      kind: "pay";
      headerName: string;
      headerValue: string;
      ledgerId: string;
      offer: PaymentOffer;
      payer: Address;
      funding: FundingResult;
    }
  | { kind: "refused"; reason: string };

/**
 * The payment decision and signing path, free of browser APIs: select the offer, apply the policy, prompt when
 * over cap, fund the per-site address, sign. The background feeds it observed 402s; the retry itself is done by
 * the caller (declarativeNetRequest for navigations, the page wrapper for fetch and XHR).
 */
export class PaymentCore {
  private readonly prompted = new Set<string>();
  private readonly inFlight = new Map<string, Promise<PaymentOutcome>>();
  readonly attempts: AttemptLog;
  private readonly now: () => number;

  constructor(private readonly deps: PaymentCoreDeps) {
    this.now = deps.now ?? (() => Date.now());
    this.attempts = new AttemptLog(this.now);
  }

  /** One outcome per requestId, however many times the same observation is reported. */
  handle(request: PaymentRequest): Promise<PaymentOutcome> {
    const existing = this.inFlight.get(request.requestId);
    if (existing) return existing;
    const promise = this.run(request).finally(() => {
      setTimeout(() => this.inFlight.delete(request.requestId), 60_000);
    });
    this.inFlight.set(request.requestId, promise);
    return promise;
  }

  private async run(request: PaymentRequest): Promise<PaymentOutcome> {
    const log = this.deps.log ?? (() => undefined);
    let offer: PaymentOffer;
    try {
      offer = selectOffer(request.paymentRequired, { chainId: this.deps.chainId, asset: this.deps.usdg });
    } catch (error) {
      const reason = error instanceof NoAcceptableOfferError ? `no acceptable offer: ${error.reasons.join("; ")}` : describeRefusal("no-offer");
      log(`${request.url}: ${reason}`);
      return { kind: "refused", reason };
    }

    const policy = await this.deps.policy();
    const hostname = new URL(request.origin).hostname;
    const siteCap = policy.siteCap(request.origin);
    const siteSpent = this.deps.ledger.spentFor(request.origin);
    const globalSpent = this.deps.ledger.totalSpent();
    const decision = decide({
      amount: offer.amount,
      paused: policy.paused,
      blocked: policy.isBlocked(hostname),
      siteCap,
      siteSpent,
      globalCap: policy.globalCap,
      globalSpent,
      alreadyPrompted: this.prompted.has(request.requestId),
      alreadyAttempted: this.attempts.has(request.tabId, request.url),
    });

    if (decision.kind === "refuse") {
      const reason = describeRefusal(decision.reason);
      await this.deps.ledger.record({ origin: request.origin, url: request.url, amount: offer.amount.toString(), payTo: offer.payTo, status: "refused", note: reason });
      log(`${request.url}: refused, ${reason}`);
      return { kind: "refused", reason };
    }

    if (decision.kind === "prompt") {
      this.prompted.add(request.requestId);
      const approved = await this.deps.prompt({
        id: globalThis.crypto.randomUUID(),
        requestId: request.requestId,
        origin: request.origin,
        url: request.url,
        amount: offer.amount.toString(),
        payTo: offer.payTo,
        siteCap: siteCap.toString(),
        siteSpent: siteSpent.toString(),
        globalCap: policy.globalCap.toString(),
        globalSpent: globalSpent.toString(),
        createdAt: this.now(),
      });
      if (!approved) {
        await this.deps.ledger.record({ origin: request.origin, url: request.url, amount: offer.amount.toString(), payTo: offer.payTo, status: "refused", note: "declined by the user" });
        return { kind: "refused", reason: "declined by the user" };
      }
    }

    const signer = await this.deps.signerFor(request.origin);
    let funding: FundingResult;
    try {
      funding = await this.deps.funder.ensure(signer.address, offer.amount, siteCap);
    } catch (error) {
      const reason = `funding failed: ${error instanceof Error ? error.message : String(error)}`;
      await this.deps.ledger.record({ origin: request.origin, url: request.url, amount: offer.amount.toString(), payTo: offer.payTo, status: "refused", note: reason });
      log(`${request.url}: ${reason}`);
      return { kind: "refused", reason };
    }

    const payment = await preparePayment(signer, offer, Math.floor(this.now() / 1000));
    this.attempts.mark(request.tabId, request.url);
    const entry = await this.deps.ledger.record({
      origin: request.origin,
      url: request.url,
      amount: offer.amount.toString(),
      payTo: offer.payTo,
      status: "signed",
    });
    log(`${request.url}: signed ${offer.amount.toString()} base units from ${signer.address}`);
    return {
      kind: "pay",
      headerName: payment.headerName,
      headerValue: payment.headerValue,
      ledgerId: entry.id,
      offer,
      payer: signer.address,
      funding,
    };
  }

  /**
   * Records what the retried response said. A settlement header is authoritative; without one, a 2xx counts as
   * settled and a second 402 as failed.
   */
  async recordSettlement(ledgerId: string, getHeader: (name: string) => string | null | undefined, status: number): Promise<SettleResponse | null> {
    let settlement: SettleResponse | null;
    try {
      settlement = parseSettleResponse(getHeader);
    } catch {
      settlement = null;
    }
    if (settlement) {
      await this.deps.ledger.settle(ledgerId, {
        success: settlement.success,
        ...(settlement.transaction ? { txHash: settlement.transaction } : {}),
        ...(settlement.errorReason ? { note: settlement.errorReason } : {}),
      });
    } else if (status >= 200 && status < 300) {
      await this.deps.ledger.settle(ledgerId, { success: true, note: "no settlement header" });
    } else if (status === 402) {
      await this.deps.ledger.settle(ledgerId, { success: false, note: "payment rejected" });
    }
    return settlement;
  }
}
