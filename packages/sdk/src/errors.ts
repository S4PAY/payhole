/** Base class for every error raised by the SDK. */
export class PayholeError extends Error {
  override name = "PayholeError";
}

/** The 402 response could not be parsed as an x402 payment request. */
export class X402ProtocolError extends PayholeError {
  override name = "X402ProtocolError";
}

/** No entry in `accepts` matches the configured chain, asset, and scheme. */
export class NoAcceptableOfferError extends PayholeError {
  override name = "NoAcceptableOfferError";
  constructor(
    message: string,
    readonly reasons: string[],
  ) {
    super(message);
  }
}

/** The payment was refused before anything was signed: cap exceeded, policy, or key not live. */
export class PaymentRefusedError extends PayholeError {
  override name = "PaymentRefusedError";
  constructor(
    message: string,
    readonly reason: string,
    readonly amount: bigint,
  ) {
    super(message);
  }
}

/** The signer never gets a second chance: a request that already carries a payment header is not retried. */
export class PaymentAlreadyAttemptedError extends PayholeError {
  override name = "PaymentAlreadyAttemptedError";
}
