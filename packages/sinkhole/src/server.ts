import { createHash, timingSafeEqual } from "node:crypto";
import { createServer as createHttpServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { chainConfig } from "@payhole/sdk";
import { ADMIN_PAGE } from "./adminPage.js";
import { parseExtensionPush, type Blocklist } from "./blocklist.js";
import { isExportFormat, renderExport } from "./render/export.js";
import type { AnnouncementResult, DirectoryEntry } from "./swarm/directory.js";
import type { EndpointAnnouncement } from "./swarm/probe.js";

export interface AdminDeps {
  token: string;
  blocklist: Blocklist;
  status: () => Record<string, unknown>;
  health: () => { ok: boolean } & Record<string, unknown>;
  directory: { list: () => DirectoryEntry[]; add: (input: EndpointAnnouncement) => Promise<AnnouncementResult> };
  /** Receives newly added explicit flags so they can be announced to the swarm. */
  publish?: (entries: { domain: string; reason: string }[]) => void;
  maxBodyBytes?: number;
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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

function readJson(req: IncomingMessage, limit: number): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let size = 0;
    let overflow = false;
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => {
      if (overflow) return;
      size += chunk.length;
      if (size > limit) {
        overflow = true;
        chunks.length = 0;
        reject(new HttpError(413, "body_too_large", `body exceeds ${limit} bytes`));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (overflow) return;
      try {
        resolve(chunks.length === 0 ? {} : JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject(new HttpError(400, "invalid_json", "body must be JSON"));
      }
    });
    req.on("error", reject);
  });
}

function sha256(text: string): Buffer {
  return createHash("sha256").update(text).digest();
}

/**
 * Admin API and page. Everything under `/api/` requires `Authorization: Bearer <ADMIN_TOKEN>`;
 * `/healthz` and the static page at `/` do not (the page holds no data until a token is entered).
 */
export function createAdminServer(deps: AdminDeps): Server {
  const maxBody = deps.maxBodyBytes ?? 4 * 1024 * 1024;
  const tokenHash = sha256(deps.token);

  const authorized = (req: IncomingMessage): boolean => {
    const header = req.headers.authorization;
    const match = header ? /^Bearer\s+(\S+)$/i.exec(header) : null;
    return match?.[1] !== undefined && timingSafeEqual(sha256(match[1]), tokenHash);
  };

  const route = async (method: string, url: URL, req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const path = url.pathname;
    if (path === "/api/status") {
      if (method !== "GET") throw new HttpError(405, "method_not_allowed", "use GET");
      return json(res, 200, deps.status());
    }
    if (path === "/api/blocklist") {
      if (method === "GET") {
        const entries = deps.blocklist.merged();
        return json(res, 200, { count: entries.length, entries });
      }
      if (method === "PUT") {
        const parsed = parseExtensionPush(await readJson(req, maxBody));
        if (!parsed.ok) throw new HttpError(400, "invalid_blocklist", parsed.error);
        const { added, removed } = deps.blocklist.setLocal(parsed.push);
        if (added.length > 0) deps.publish?.(added.map((e) => ({ domain: e.domain, reason: e.reason })));
        return json(res, 200, { ok: true, accepted: parsed.push.entries.length, added: added.length, removed: removed.length, rejected: parsed.rejected });
      }
      throw new HttpError(405, "method_not_allowed", "use GET or PUT");
    }
    if (path === "/api/blocklist/export") {
      if (method !== "GET") throw new HttpError(405, "method_not_allowed", "use GET");
      const format = url.searchParams.get("format") ?? "plain";
      if (!isExportFormat(format)) throw new HttpError(400, "invalid_format", "format must be hosts, dnsmasq, plain or json");
      const { body, contentType } = renderExport(format, deps.blocklist.merged(), new Date().toISOString());
      res.writeHead(200, { "content-type": contentType, "content-length": Buffer.byteLength(body), "cache-control": "no-store" });
      res.end(body);
      return;
    }
    if (path === "/api/blocklist/manual") {
      if (method !== "POST") throw new HttpError(405, "method_not_allowed", "use POST");
      const body = await readJson(req, maxBody);
      const domain = isRecord(body) ? body["domain"] : undefined;
      if (typeof domain !== "string") throw new HttpError(400, "invalid_domain", "body must carry a domain string");
      const reason = isRecord(body) && typeof body["reason"] === "string" ? body["reason"] : "manual";
      const result = deps.blocklist.addManual(domain, reason);
      if (!result) throw new HttpError(400, "invalid_domain", `${domain.slice(0, 120)} is not a hostname`);
      if (result.added) deps.publish?.([{ domain: result.domain, reason }]);
      return json(res, result.added ? 201 : 200, { domain: result.domain, added: result.added });
    }
    const manual = /^\/api\/blocklist\/manual\/([^/]+)$/.exec(path);
    if (manual?.[1] !== undefined) {
      if (method !== "DELETE") throw new HttpError(405, "method_not_allowed", "use DELETE");
      let domain: string;
      try {
        domain = decodeURIComponent(manual[1]);
      } catch {
        throw new HttpError(400, "invalid_domain", "bad encoding");
      }
      if (!deps.blocklist.removeManual(domain)) throw new HttpError(404, "not_found", `${domain.slice(0, 120)} is not a manual entry`);
      return json(res, 200, { domain, removed: true });
    }
    if (path === "/api/directory") {
      if (method === "GET") {
        const entries = deps.directory.list();
        return json(res, 200, { count: entries.length, entries });
      }
      if (method === "POST") {
        const body = await readJson(req, maxBody);
        if (!isRecord(body) || typeof body["url"] !== "string" || typeof body["payTo"] !== "string") {
          throw new HttpError(400, "invalid_endpoint", "body must carry url and payTo");
        }
        const input: EndpointAnnouncement = {
          url: body["url"],
          payTo: body["payTo"],
          network: typeof body["network"] === "string" ? body["network"] : chainConfig.x402.network,
          asset: typeof body["asset"] === "string" ? body["asset"] : chainConfig.usdg,
        };
        const result = await deps.directory.add(input);
        if (!result.ok) throw new HttpError(422, result.reason, result.detail);
        return json(res, 201, { entry: result.entry, probed: result.probed });
      }
      throw new HttpError(405, "method_not_allowed", "use GET or POST");
    }
    if (path === "/api/flags") {
      if (method !== "GET") throw new HttpError(405, "method_not_allowed", "use GET");
      return json(res, 200, { threshold: deps.blocklist.threshold, ttlMs: deps.blocklist.ttlMs, entries: deps.blocklist.flagSummaries() });
    }
    throw new HttpError(404, "not_found", "no such route");
  };

  const handle = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const method = req.method ?? "GET";
    if (url.pathname === "/healthz") {
      if (method !== "GET") return json(res, 405, { error: "method_not_allowed" }, { allow: "GET" });
      const health = deps.health();
      return json(res, health.ok ? 200 : 503, health);
    }
    if (url.pathname === "/" || url.pathname === "/index.html") {
      if (method !== "GET") return json(res, 405, { error: "method_not_allowed" }, { allow: "GET" });
      res.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "content-length": Buffer.byteLength(ADMIN_PAGE),
        "cache-control": "no-store",
        "content-security-policy": "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'",
      });
      res.end(ADMIN_PAGE);
      return;
    }
    if (!url.pathname.startsWith("/api/")) return json(res, 404, { error: "not_found" });
    if (!authorized(req)) return json(res, 401, { error: "unauthorized", message: "bearer token required" }, { "www-authenticate": "Bearer" });
    try {
      await route(method, url, req, res);
    } catch (error) {
      if (error instanceof HttpError) {
        return json(res, error.status, { error: error.code, message: error.message }, error.status === 413 ? { connection: "close" } : {});
      }
      console.error("admin request failed", error);
      return json(res, 500, { error: "internal_error", message: "request failed" });
    }
  };

  return createHttpServer((req, res) => {
    void handle(req, res).catch((error: unknown) => {
      console.error("admin handler crashed", error);
      if (!res.headersSent) json(res, 500, { error: "internal_error" });
    });
  });
}
