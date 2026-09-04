import { encodeBase64Json, paymentHeaderName } from "./headers.js";
import { buildAuthorization, signAuthorization, type TypedDataSigner } from "./eip3009.js";
import type { PaymentOffer, PaymentPayload, PaymentPayloadV1, PaymentRequirements, PreparedPayment } from "./types.js";

/**
 * Signs an authorization for `offer` and encodes the payment header. Pure with respect to the network:
 * callers decide whether to attach it to a fetch, an XHR, or a navigation.
 */
export async function preparePayment(
  signer: TypedDataSigner,
  offer: PaymentOffer,
  nowSeconds?: number,
): Promise<PreparedPayment> {
  const authorization = buildAuthorization(offer, signer.address, nowSeconds);
  const signature = await signAuthorization(signer, offer, authorization);
  const payload: PaymentPayload | PaymentPayloadV1 =
    offer.version === 2
      ? {
          x402Version: 2,
          ...(offer.resource ? { resource: offer.resource } : {}),
          accepted: offer.raw as PaymentRequirements,
          payload: { signature, authorization },
          ...(offer.extensions ? { extensions: offer.extensions } : {}),
        }
      : {
          x402Version: 1,
          scheme: offer.scheme,
          network: offer.network,
          payload: { signature, authorization },
        };
  return {
    headerName: paymentHeaderName(offer.version),
    headerValue: encodeBase64Json(payload),
    payload,
    authorization,
    signature,
    offer,
  };
}
