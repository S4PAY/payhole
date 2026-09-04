import { createServer as createHttpServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { HEADER_PAYMENT_SIGNATURE } from "@payhole/sdk";
import { AttestError, type AttestInput, type Attestation } from "./attest.js";
import { demoResponse, type DemoDeps } from "./demo.js";
import type { RateLimiter } from "./rateLimit.js";

export interface ServerDeps {
  attest: (input: AttestInput) => Promise<Attestation>;
  limiter: RateLimiter;
  trustProxy: boolean;
  health: () => Record<string, unknown>;
  maxBodyBytes?: number;
  /** Paid demo article at GET /demo/article; the route answers 404 when absent. */
  demo?: DemoDeps;
}

function json(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(text),
    "cache-control": "no-store",
    ...headers,
  });
  res.end(text);
}

function clientKey(req: IncomingMessage, trustProxy: boolean): string {
  if (trustProxy) {
    const forwarded = req.headers["x-forwarded-for"];
    const first = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(",")[0]?.trim();
    if (first) return first;
  }
  return req.socket.remoteAddress ?? "unknown";
}

function readJson(req: IncomingMessage, limit: number): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        reject(new AttestError(413, "body_too_large", `body exceeds ${limit} bytes`));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      try {
        resolve(chunks.length === 0 ? {} : JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject(new AttestError(400, "invalid_json", "body must be JSON"));
      }
    });
    req.on("error", reject);
  });
}

/** HTTP surface: `GET /healthz`, `POST /attest {domain, wallet}`, and `GET /demo/article` when a demo is configured. */
export function createServer(deps: ServerDeps): Server {
  const maxBody = deps.maxBodyBytes ?? 4096;
  return createHttpServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? "/", "http://localhost");
      if (url.pathname === "/healthz") {
        if (req.method !== "GET") return json(res, 405, { error: "method_not_allowed" }, { allow: "GET" });
        return json(res, 200, { ok: true, ...deps.health() });
      }
      if (url.pathname === "/demo/article") {
        if (!deps.demo) return json(res, 404, { error: "not_found" });
        if (req.method !== "GET") return json(res, 405, { error: "method_not_allowed" }, { allow: "GET" });
        const raw = req.headers[HEADER_PAYMENT_SIGNATURE];
        const payment = Array.isArray(raw) ? raw[0] : raw;
        if (payment) {
          // Only paid attempts reach a facilitator, so only they count against the limit.
          const gate = deps.limiter.take(clientKey(req, deps.trustProxy));
          if (!gate.allowed) return json(res, 429, { error: "rate_limited", message: "too many requests" }, { "retry-after": String(gate.retryAfterSeconds) });
        }
        try {
          const out = await demoResponse(deps.demo, payment);
          return json(res, out.status, out.body, { ...out.headers, "access-control-expose-headers": "payment-required, payment-response" });
        } catch (error) {
          console.error("demo settlement failed", error);
          return json(res, 502, { error: "facilitator_unavailable", message: "no facilitator could settle the payment; nothing was charged" });
        }
      }
      if (url.pathname !== "/attest") return json(res, 404, { error: "not_found" });
      if (req.method !== "POST") return json(res, 405, { error: "method_not_allowed" }, { allow: "POST" });

      const gate = deps.limiter.take(clientKey(req, deps.trustProxy));
      if (!gate.allowed) {
        return json(res, 429, { error: "rate_limited", message: "too many requests" }, { "retry-after": String(gate.retryAfterSeconds) });
      }
      try {
        const body = (await readJson(req, maxBody)) as Record<string, unknown>;
        if (typeof body !== "object" || body === null) throw new AttestError(400, "invalid_json", "body must be a JSON object");
        const attestation = await deps.attest({ domain: body["domain"], wallet: body["wallet"] });
        return json(res, 200, attestation);
      } catch (error) {
        if (error instanceof AttestError) {
          return json(res, error.status, { error: error.code, message: error.message, ...(error.details ? { details: error.details } : {}) });
        }
        console.error("attest failed", error);
        return json(res, 500, { error: "internal_error", message: "attestation failed" });
      }
    })();
  });
}
