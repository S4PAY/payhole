import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { verifyTypedData, type Account, type Address, type Chain, type PublicClient, type Transport, type WalletClient } from "viem";
import {
  authorizationTypedData,
  decodeBase64Json,
  encodeBase64Json,
  HEADER_PAYMENT_REQUIRED,
  HEADER_PAYMENT_RESPONSE,
  HEADER_X_PAYMENT_RESPONSE,
  selectOffer,
  type PaymentPayload,
  type PaymentPayloadV1,
  type PaymentRequired,
  type PaymentRequiredV1,
} from "@payhole/sdk";
import { mockUsdgAbi } from "./artifacts";

export interface MockServerOptions {
  publicClient: PublicClient;
  /** Plays the facilitator: submits transferWithAuthorization and pays its gas. */
  relayer: WalletClient<Transport, Chain, Account>;
  asset: Address;
  payTo: Address;
  amount: bigint;
  chainId: number;
  version: 1 | 2;
  port: number;
}

export interface MockServer {
  url: string;
  stats: { challenges: number; payments: number; settled: number; rejected: string[] };
  close(): Promise<void>;
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (chunk: Buffer) => (data += chunk.toString()));
    req.on("end", () => resolve(data));
  });
}

const FETCH_PAGE = `<!doctype html><html><body><h1>fetch test</h1><pre id="out">pending</pre>
<script>
fetch("/paid", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ q: 1 }) })
  .then((r) => r.text().then((t) => { document.getElementById("out").textContent = r.status + " " + t; }))
  .catch((e) => { document.getElementById("out").textContent = "error " + e.message; });
</script></body></html>`;

const XHR_PAGE = `<!doctype html><html><body><h1>xhr test</h1><pre id="out">pending</pre>
<script>
var xhr = new XMLHttpRequest();
var states = [];
xhr.onreadystatechange = function () { states.push(xhr.readyState); };
xhr.onload = function () { document.getElementById("out").textContent = xhr.status + " " + xhr.responseText + " states=" + states.join(","); };
xhr.onerror = function () { document.getElementById("out").textContent = "error"; };
xhr.open("GET", "/paid");
xhr.setRequestHeader("x-test", "1");
xhr.send();
</script></body></html>`;

/**
 * Minimal x402 resource server with an embedded facilitator. `/paid` challenges and settles, `/free` is plain,
 * `/wrong-asset` offers another token, `/fetch.html` and `/xhr.html` are pages that call `/paid` from page script.
 */
export async function startMockX402Server(o: MockServerOptions): Promise<MockServer> {
  const stats: MockServer["stats"] = { challenges: 0, payments: 0, settled: 0, rejected: [] };
  const network = o.version === 2 ? `eip155:${o.chainId}` : "robinhood";
  const url = `http://127.0.0.1:${o.port}`;

  const v2Requirements = {
    scheme: "exact",
    network,
    asset: o.asset,
    amount: o.amount.toString(),
    payTo: o.payTo,
    maxTimeoutSeconds: 300,
    extra: { name: "Global Dollar", version: "1" },
  };
  const v1Requirements = {
    scheme: "exact",
    network,
    maxAmountRequired: o.amount.toString(),
    resource: `${url}/paid`,
    description: "mock paid resource",
    mimeType: "application/json",
    payTo: o.payTo,
    maxTimeoutSeconds: 300,
    asset: o.asset,
    extra: { name: "Global Dollar", version: "1" },
  };

  const reject = (res: ServerResponse, reason: string, required: PaymentRequired | PaymentRequiredV1) => {
    stats.rejected.push(reason);
    const withError = { ...required, error: reason };
    if (o.version === 2) {
      res.writeHead(402, { "content-type": "application/json", [HEADER_PAYMENT_REQUIRED]: encodeBase64Json(withError) });
      res.end("{}");
    } else {
      res.writeHead(402, { "content-type": "application/json" });
      res.end(JSON.stringify(withError));
    }
  };

  const server = createServer((req, res) => {
    void (async () => {
      const path = new URL(req.url ?? "/", url).pathname;
      if (path === "/free") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ free: true }));
        return;
      }
      if (path === "/fetch.html" || path === "/xhr.html") {
        res.writeHead(200, { "content-type": "text/html" });
        res.end(path === "/fetch.html" ? FETCH_PAGE : XHR_PAGE);
        return;
      }
      if (path === "/wrong-asset") {
        const required: PaymentRequired = {
          x402Version: 2,
          resource: { url: `${url}/wrong-asset` },
          accepts: [{ ...v2Requirements, asset: "0x0000000000000000000000000000000000000001" }],
        };
        res.writeHead(402, { [HEADER_PAYMENT_REQUIRED]: encodeBase64Json(required) });
        res.end("{}");
        return;
      }
      await readBody(req);
      const required: PaymentRequired | PaymentRequiredV1 =
        o.version === 2
          ? { x402Version: 2, resource: { url: `${url}${path}`, description: "mock paid resource", mimeType: "application/json" }, accepts: [v2Requirements] }
          : { x402Version: 1, accepts: [v1Requirements] };
      const header = req.headers["payment-signature"] ?? req.headers["x-payment"];
      const headerValue = Array.isArray(header) ? header[0] : header;
      if (!headerValue) {
        stats.challenges += 1;
        if (o.version === 2) {
          res.writeHead(402, { "content-type": "application/json", [HEADER_PAYMENT_REQUIRED]: encodeBase64Json(required) });
          res.end("{}");
        } else {
          res.writeHead(402, { "content-type": "application/json" });
          res.end(JSON.stringify(required));
        }
        return;
      }
      stats.payments += 1;
      const payload = decodeBase64Json<PaymentPayload | PaymentPayloadV1>(headerValue);
      if (payload.x402Version !== o.version) return reject(res, "invalid_x402_version", required);
      if (o.version === 2) {
        const accepted = (payload as PaymentPayload).accepted;
        if (JSON.stringify(accepted) !== JSON.stringify(v2Requirements)) return reject(res, "accepted_mismatch", required);
      }
      const { authorization, signature } = payload.payload;
      if (authorization.to.toLowerCase() !== o.payTo.toLowerCase()) return reject(res, "recipient_mismatch", required);
      if (BigInt(authorization.value) !== o.amount) return reject(res, "value_mismatch", required);
      const now = Math.floor(Date.now() / 1000);
      if (Number(authorization.validBefore) < now + 6) return reject(res, "valid_before_too_soon", required);
      const offer = selectOffer(required, { chainId: o.chainId, asset: o.asset });
      const typed = authorizationTypedData(offer, authorization);
      const valid = await verifyTypedData({ address: authorization.from, signature, ...typed });
      if (!valid) return reject(res, "invalid_signature", required);
      try {
        const hash = await o.relayer.writeContract({
          address: o.asset,
          abi: mockUsdgAbi,
          functionName: "transferWithAuthorization",
          args: [
            authorization.from,
            authorization.to,
            BigInt(authorization.value),
            BigInt(authorization.validAfter),
            BigInt(authorization.validBefore),
            authorization.nonce,
            signature,
          ],
        });
        const receipt = await o.publicClient.waitForTransactionReceipt({ hash });
        if (receipt.status !== "success") return reject(res, "settlement_reverted", required);
        stats.settled += 1;
        const settle = { success: true, transaction: hash, network, payer: authorization.from };
        res.writeHead(200, {
          "content-type": "application/json",
          [o.version === 2 ? HEADER_PAYMENT_RESPONSE : HEADER_X_PAYMENT_RESPONSE]: encodeBase64Json(settle),
        });
        res.end(JSON.stringify({ ok: true, paid: authorization.value }));
      } catch (error) {
        return reject(res, `settlement_failed: ${error instanceof Error ? error.message.split("\n")[0] : String(error)}`, required);
      }
    })();
  });

  await new Promise<void>((resolve) => server.listen(o.port, "127.0.0.1", resolve));
  return {
    url,
    stats,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
