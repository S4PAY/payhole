import { createHash, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer as createHttpServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { chainConfig } from "@payhole/sdk";
import { ADMIN_ASSETS, ADMIN_CSP, ADMIN_PAGE } from "./adminPage.js";
import { parseExtensionPush, type Blocklist } from "./blocklist.js";
import { isQueryStatus, type QueryFilter, type QueryRecord, type StatsSnapshot } from "./queryLog.js";
import { isExportFormat, renderExport } from "./render/export.js";
import type { RadarSnapshot } from "./radar.js";
import type { RefreshResult, SubscriptionInfo } from "./subscriptions.js";
import type { AnnouncementResult, DirectoryEntry } from "./swarm/directory.js";
import type { EndpointAnnouncement } from "./swarm/probe.js";
import { TierError } from "@payhole/sdk";
import { MembershipError, type Membership } from "./membership.js";
import { CATEGORIES, parseCategory, type Category } from "./category.js";

export interface AdminDeps {
  token: string;
  blocklist: Blocklist;
  status: () => Record<string, unknown>;
  health: () => { ok: boolean } & Record<string, unknown>;
  directory: { list: () => DirectoryEntry[]; add: (input: EndpointAnnouncement) => Promise<AnnouncementResult> };
  /** Receives newly added explicit flags so they can be announced to the swarm. */
  publish?: (entries: { domain: string; reason: string; category: Category }[]) => void;
  /** Query statistics; absent when query logging is off, and the routes answer 404. */
  stats?: { snapshot: () => StatsSnapshot; queries: (filter: QueryFilter) => QueryRecord[] } | undefined;
  /** Subscribed public blocklists; absent in deployments without list support. */
  subscriptions?:
    | {
        list: () => SubscriptionInfo[];
        get: (id: string) => SubscriptionInfo | undefined;
        add: (url: string, category?: Category) => Promise<{ item: SubscriptionInfo; added: boolean }>;
        setCategory: (id: string, category: Category) => Promise<SubscriptionInfo | undefined>;
        remove: (id: string) => Promise<boolean>;
        refresh: (id: string) => Promise<RefreshResult>;
      }
    | undefined;
  /** What the network learned lately, for `GET /api/radar`; absent when the node has no lists. */
  radar?: (() => RadarSnapshot) | undefined;
  /** The operator wallet's BurnVault tier and the unlock action; absent when the node has no vault. */
  membership?: Membership | undefined;
  maxBodyBytes?: number;
}

const BLOCKLIST_PAGE = 1000;
const BLOCKLIST_PAGE_MAX = 5000;

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

/** A category from a request body: absent is null, anything else must be a known category. */
function categoryParam(value: unknown): Category | null {
  if (value === undefined || value === null) return null;
  const category = parseCategory(value);
  if (!category) throw new HttpError(400, "invalid_category", `category must be one of ${CATEGORIES.join(", ")}`);
  return category;
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
 * `/healthz`, the page at `/`, and its static files under `/admin/` do not (the page holds no data until a token is entered).
 */
export function createAdminServer(deps: AdminDeps): Server {
  const maxBody = deps.maxBodyBytes ?? 4 * 1024 * 1024;
  const tokenHash = sha256(deps.token);
  const assetCache = new Map<string, Buffer>();

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
        const limitParam = Number(url.searchParams.get("limit") ?? BLOCKLIST_PAGE);
        const limit = Number.isInteger(limitParam) && limitParam > 0 ? Math.min(limitParam, BLOCKLIST_PAGE_MAX) : BLOCKLIST_PAGE;
        const result = deps.blocklist.search(url.searchParams.get("q") ?? "", limit);
        return json(res, 200, { count: result.count, matched: result.matched, limit, entries: result.entries });
      }
      if (method === "PUT") {
        const parsed = parseExtensionPush(await readJson(req, maxBody));
        if (!parsed.ok) throw new HttpError(400, "invalid_blocklist", parsed.error);
        const { added, removed } = deps.blocklist.setLocal(parsed.push);
        if (added.length > 0) deps.publish?.(added.map((e) => ({ domain: e.domain, reason: e.reason, category: e.category })));
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
      const category = categoryParam(isRecord(body) ? body["category"] : undefined) ?? "other";
      const result = deps.blocklist.addManual(domain, reason, undefined, category);
      if (!result) throw new HttpError(400, "invalid_domain", `${domain.slice(0, 120)} is not a hostname`);
      if (result.added) deps.publish?.([{ domain: result.domain, reason, category }]);
      return json(res, result.added ? 201 : 200, { domain: result.domain, added: result.added, category });
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
    if (path === "/api/stats") {
      if (method !== "GET") throw new HttpError(405, "method_not_allowed", "use GET");
      if (!deps.stats) throw new HttpError(404, "stats_disabled", "query logging is off on this node (QUERY_LOG_ENABLED=0)");
      return json(res, 200, deps.stats.snapshot());
    }
    if (path === "/api/queries") {
      if (method !== "GET") throw new HttpError(405, "method_not_allowed", "use GET");
      if (!deps.stats) throw new HttpError(404, "stats_disabled", "query logging is off on this node (QUERY_LOG_ENABLED=0)");
      const filter: QueryFilter = {};
      const limit = Number(url.searchParams.get("limit") ?? "200");
      if (Number.isInteger(limit) && limit > 0) filter.limit = limit;
      const client = url.searchParams.get("client");
      if (client) filter.client = client;
      const domain = url.searchParams.get("domain");
      if (domain) filter.domain = domain;
      const status = url.searchParams.get("status");
      if (status) {
        if (!isQueryStatus(status)) throw new HttpError(400, "invalid_status", "status must be blocked, cached, forwarded, local, unanswered or unknown");
        filter.status = status;
      }
      const entries = deps.stats.queries(filter);
      return json(res, 200, { count: entries.length, entries });
    }
    if (path === "/api/membership") {
      if (!deps.membership) throw new HttpError(404, "membership_disabled", "no BurnVault is configured on this node");
      if (method !== "GET") throw new HttpError(405, "method_not_allowed", "use GET");
      const view = await deps.membership.read();
      return json(res, 200, view ? { configured: true, ...view } : { configured: false });
    }
    if (path === "/api/membership/unlock") {
      if (!deps.membership) throw new HttpError(404, "membership_disabled", "no BurnVault is configured on this node");
      if (method !== "POST") throw new HttpError(405, "method_not_allowed", "use POST");
      const body = await readJson(req, maxBody);
      const tier = isRecord(body) ? body["tier"] : undefined;
      if (typeof tier !== "number" || !Number.isInteger(tier) || tier < 1 || tier > 255) {
        throw new HttpError(400, "invalid_tier", "body must carry a tier number from 1 to 255");
      }
      try {
        return json(res, 200, await deps.membership.unlock(tier));
      } catch (error) {
        if (error instanceof MembershipError) throw new HttpError(409, error.code, error.message);
        if (error instanceof TierError) throw new HttpError(400, error.code, error.message);
        throw error;
      }
    }
    if (path === "/api/subscriptions") {
      const subs = deps.subscriptions;
      if (!subs) throw new HttpError(404, "lists_disabled", "list subscriptions are not available on this node");
      if (method === "GET") {
        const entries = subs.list();
        return json(res, 200, { count: entries.length, entries });
      }
      if (method === "POST") {
        const body = await readJson(req, maxBody);
        const target = isRecord(body) ? body["url"] : undefined;
        if (typeof target !== "string") throw new HttpError(400, "invalid_url", "body must carry a url string");
        const category = categoryParam(isRecord(body) ? body["category"] : undefined);
        let added: { item: SubscriptionInfo; added: boolean };
        try {
          added = await subs.add(target, category ?? undefined);
        } catch (error) {
          throw new HttpError(400, "invalid_url", error instanceof Error ? error.message : String(error));
        }
        const result = added.added ? await subs.refresh(added.item.id) : null;
        return json(res, added.added ? 201 : 200, { entry: subs.get(added.item.id) ?? added.item, added: added.added, ...(result ? { refresh: result } : {}) });
      }
      throw new HttpError(405, "method_not_allowed", "use GET or POST");
    }
    const subscription = /^\/api\/subscriptions\/([0-9a-f]{12})(\/refresh)?$/.exec(path);
    if (subscription?.[1] !== undefined) {
      const subs = deps.subscriptions;
      if (!subs) throw new HttpError(404, "lists_disabled", "list subscriptions are not available on this node");
      const id = subscription[1];
      if (subscription[2] !== undefined) {
        if (method !== "POST") throw new HttpError(405, "method_not_allowed", "use POST");
        if (!subs.get(id)) throw new HttpError(404, "not_found", "no such subscription");
        const result = await subs.refresh(id);
        return json(res, 200, { entry: subs.get(id), refresh: result });
      }
      if (method === "PATCH") {
        const body = await readJson(req, maxBody);
        const category = categoryParam(isRecord(body) ? body["category"] : undefined);
        if (!category) throw new HttpError(400, "invalid_category", `body must carry a category: ${CATEGORIES.join(", ")}`);
        const entry = await subs.setCategory(id, category);
        if (!entry) throw new HttpError(404, "not_found", "no such subscription");
        return json(res, 200, { entry });
      }
      if (method !== "DELETE") throw new HttpError(405, "method_not_allowed", "use PATCH or DELETE");
      if (!(await subs.remove(id))) throw new HttpError(404, "not_found", "no such subscription");
      return json(res, 200, { id, removed: true });
    }
    if (path === "/api/radar") {
      if (method !== "GET") throw new HttpError(405, "method_not_allowed", "use GET");
      if (!deps.radar) throw new HttpError(404, "not_found", "radar is not enabled");
      return json(res, 200, deps.radar());
    }
    if (path === "/api/verdict") {
      if (method !== "GET") throw new HttpError(405, "method_not_allowed", "use GET");
      const name = url.searchParams.get("name");
      if (!name) throw new HttpError(400, "invalid_name", "name query parameter is required");
      const verdict = deps.blocklist.inspect(name);
      if (!verdict) throw new HttpError(400, "invalid_name", `${name.slice(0, 120)} is not a hostname`);
      return json(res, 200, { ...verdict, checkedAt: Date.now() });
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
        "content-security-policy": ADMIN_CSP,
        "x-content-type-options": "nosniff",
      });
      res.end(ADMIN_PAGE);
      return;
    }
    const asset = Object.hasOwn(ADMIN_ASSETS, url.pathname) ? ADMIN_ASSETS[url.pathname] : undefined;
    if (asset) {
      if (method !== "GET") return json(res, 405, { error: "method_not_allowed" }, { allow: "GET" });
      let body = assetCache.get(url.pathname);
      if (!body) {
        try {
          body = await readFile(asset.file);
        } catch {
          return json(res, 404, { error: "not_found", message: "asset missing from this build" });
        }
        assetCache.set(url.pathname, body);
      }
      res.writeHead(200, { "content-type": asset.contentType, "content-length": body.length, "cache-control": "public, max-age=3600", "x-content-type-options": "nosniff" });
      res.end(body);
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
