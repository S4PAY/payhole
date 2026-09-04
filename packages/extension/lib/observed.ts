import type { AnyPaymentRequired } from "@payhole/sdk";

export type ObservedResourceType = "main_frame" | "sub_frame" | "xmlhttprequest";

/** A 402 seen through webRequest, kept briefly so a page-side report or a navigation retry can be matched to it. */
export interface ObservedOffer {
  tabId: number;
  requestId: string;
  url: string;
  initiatorOrigin?: string;
  resourceType: ObservedResourceType;
  /** Parsed from the PAYMENT-REQUIRED header; absent when the 402 carried none (a v1 body may still follow). */
  paymentRequired?: AnyPaymentRequired;
  seenAt: number;
}

export const OBSERVATION_TTL_MS = 60_000;

export class ObservedOffers {
  private readonly byRequest = new Map<string, ObservedOffer>();

  constructor(
    private readonly now: () => number = () => Date.now(),
    private readonly ttlMs: number = OBSERVATION_TTL_MS,
  ) {}

  put(offer: ObservedOffer): void {
    this.prune();
    this.byRequest.set(offer.requestId, offer);
  }

  get(requestId: string): ObservedOffer | undefined {
    this.prune();
    return this.byRequest.get(requestId);
  }

  /** The most recent live observation for a tab and URL. */
  findByTabUrl(tabId: number, url: string): ObservedOffer | undefined {
    this.prune();
    let best: ObservedOffer | undefined;
    for (const offer of this.byRequest.values()) {
      if (offer.tabId !== tabId || offer.url !== url) continue;
      if (!best || offer.seenAt > best.seenAt) best = offer;
    }
    return best;
  }

  delete(requestId: string): void {
    this.byRequest.delete(requestId);
  }

  prune(): void {
    const cutoff = this.now() - this.ttlMs;
    for (const [id, offer] of this.byRequest) if (offer.seenAt < cutoff) this.byRequest.delete(id);
  }

  get size(): number {
    this.prune();
    return this.byRequest.size;
  }
}

/** Requests that already carried a payment, so a second 402 for the same tab and URL is never paid again. */
export class AttemptLog {
  private readonly attempts = new Map<string, number>();

  constructor(
    private readonly now: () => number = () => Date.now(),
    private readonly ttlMs: number = OBSERVATION_TTL_MS,
  ) {}

  static key(tabId: number, url: string): string {
    return `${tabId}|${url}`;
  }

  mark(tabId: number, url: string): void {
    this.prune();
    this.attempts.set(AttemptLog.key(tabId, url), this.now());
  }

  has(tabId: number, url: string): boolean {
    this.prune();
    return this.attempts.has(AttemptLog.key(tabId, url));
  }

  clear(tabId: number, url: string): void {
    this.attempts.delete(AttemptLog.key(tabId, url));
  }

  prune(): void {
    const cutoff = this.now() - this.ttlMs;
    for (const [key, at] of this.attempts) if (at < cutoff) this.attempts.delete(key);
  }
}
