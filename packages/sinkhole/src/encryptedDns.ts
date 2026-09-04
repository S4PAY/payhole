import { X509Certificate } from "node:crypto";
import { watch, type FSWatcher } from "node:fs";
import { readFile } from "node:fs/promises";
import { createServer as createHttpServer, type IncomingMessage, type Server as HttpServer, type ServerResponse } from "node:http";
import { isIP, type Socket } from "node:net";
import { basename, dirname } from "node:path";
import { createSecureContext, createServer as createTlsServer, type Server as TlsServer, type TLSSocket } from "node:tls";
import type { DnsForwarder } from "./dnsForwarder.js";
import { isQuery, MAX_MESSAGE_BYTES, minTtl, servfail } from "./dnsWire.js";
import type { RateLimiter } from "./rateLimit.js";

export type Transport = "doh" | "dot";

/** Counters kept by each encrypted listener; they work with or without the query log. */
export interface EncryptedDnsCounters {
  queries: number;
  /** Answered SERVFAIL because the client address went over the rate limit. */
  limited: number;
  /** Answered SERVFAIL because the local resolver did not answer. */
  failed: number;
}

export interface EncryptedDnsShared {
  forwarder: DnsForwarder;
  /** Shared per-client-address limit for both transports. */
  limiter: RateLimiter;
  log: (line: string) => void;
  /** Called for every accepted query, for the statistics. */
  onQuery?: ((transport: Transport, client: string) => void) | undefined;
}

const DNS_MESSAGE = "application/dns-message";
const DEFAULT_IDLE_MS = 10_000;
const DEFAULT_IN_FLIGHT = 32;
const HOUR = 60 * 60 * 1000;

function newCounters(): EncryptedDnsCounters {
  return { queries: 0, limited: 0, failed: 0 };
}

function isLoopback(address: string | undefined): boolean {
  if (!address) return false;
  const bare = address.startsWith("::ffff:") ? address.slice(7) : address;
  return bare === "::1" || bare.startsWith("127.");
}

/** The address a query came from; a reverse proxy on this host may forward the real one. */
export function clientAddress(req: IncomingMessage): string {
  const remote = req.socket.remoteAddress ?? "unknown";
  if (!isLoopback(remote)) return remote;
  const forwarded = req.headers["x-forwarded-for"];
  const first = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(",")[0]?.trim();
  return first && isIP(first) !== 0 ? first : remote;
}

/**
 * Answers one wire-format query for a transport: the rate limit first, then the resolver, then a SERVFAIL when the
 * resolver did not answer. Never rejects.
 */
export async function answer(shared: EncryptedDnsShared, counters: EncryptedDnsCounters, transport: Transport, client: string, query: Buffer): Promise<Buffer> {
  counters.queries += 1;
  if (!shared.limiter.take(client).allowed) {
    counters.limited += 1;
    return servfail(query);
  }
  shared.onQuery?.(transport, client);
  try {
    return await shared.forwarder.query(query);
  } catch (error) {
    counters.failed += 1;
    shared.log(`${transport} query from ${client} failed: ${error instanceof Error ? error.message : String(error)}`);
    return servfail(query);
  }
}

function base64UrlDecode(text: string): Buffer | null {
  if (!/^[A-Za-z0-9_-]*$/.test(text) || text.length === 0) return null;
  return Buffer.from(text, "base64url");
}

function readBody(req: IncomingMessage, limit: number): Promise<Buffer | null> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        resolve(null);
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function plain(res: ServerResponse, status: number, text: string, headers: Record<string, string> = {}): void {
  res.writeHead(status, { "content-type": "text/plain; charset=utf-8", "content-length": Buffer.byteLength(text), "cache-control": "no-store", ...headers });
  res.end(text);
}

/**
 * DNS over HTTPS (RFC 8484) on plain HTTP: `GET /dns-query?dns=` and `POST /dns-query`, plus `GET /healthz`.
 * TLS is the reverse proxy's job; on the public node Caddy terminates it and forwards here.
 */
export function createDohServer(shared: EncryptedDnsShared, counters: EncryptedDnsCounters = newCounters()): HttpServer & { counters: EncryptedDnsCounters } {
  const server = createHttpServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? "/", "http://localhost");
      if (url.pathname === "/healthz") {
        if (req.method !== "GET") return plain(res, 405, "use GET", { allow: "GET" });
        const body = JSON.stringify({ ok: true, transport: "doh", queries: counters.queries });
        res.writeHead(200, { "content-type": "application/json; charset=utf-8", "content-length": Buffer.byteLength(body), "cache-control": "no-store" });
        return res.end(body);
      }
      if (url.pathname !== "/dns-query") return plain(res, 404, "not found");
      let query: Buffer | null;
      if (req.method === "GET") {
        const encoded = url.searchParams.get("dns");
        if (encoded === null) return plain(res, 400, "missing dns parameter");
        query = base64UrlDecode(encoded);
        if (!query) return plain(res, 400, "dns parameter is not base64url");
      } else if (req.method === "POST") {
        const type = (req.headers["content-type"] ?? "").split(";")[0]?.trim().toLowerCase();
        if (type !== DNS_MESSAGE) return plain(res, 415, `content-type must be ${DNS_MESSAGE}`);
        query = await readBody(req, MAX_MESSAGE_BYTES);
        if (!query) return plain(res, 413, `body exceeds ${MAX_MESSAGE_BYTES} bytes`);
      } else {
        return plain(res, 405, "use GET or POST", { allow: "GET, POST" });
      }
      if (query.length > MAX_MESSAGE_BYTES) return plain(res, 413, `message exceeds ${MAX_MESSAGE_BYTES} bytes`);
      if (!isQuery(query)) return plain(res, 400, "not a DNS query");
      const reply = await answer(shared, counters, "doh", clientAddress(req), query);
      const ttl = minTtlOrNone(reply);
      res.writeHead(200, {
        "content-type": DNS_MESSAGE,
        "content-length": reply.length,
        "cache-control": ttl === null ? "no-store" : `max-age=${ttl}`,
      });
      res.end(reply);
    })().catch((error: unknown) => {
      shared.log(`doh request failed: ${error instanceof Error ? error.message : String(error)}`);
      if (!res.headersSent) plain(res, 500, "internal error");
      else res.end();
    });
  });
  return Object.assign(server, { counters });
}

function minTtlOrNone(reply: Buffer): number | null {
  // SERVFAIL and other errors are not cacheable; a positive answer caches for its lowest TTL.
  if (reply.length < 12 || (reply.readUInt8(3) & 0x0f) !== 0) return null;
  return minTtl(reply);
}

export interface DotServerOptions extends EncryptedDnsShared {
  certFile: string;
  keyFile: string;
  idleTimeoutMs?: number | undefined;
  maxInFlight?: number | undefined;
  /** Fallback re-read of the certificate files, in case the file watch misses a renewal. */
  reloadIntervalMs?: number | undefined;
}

export interface CertificateInfo {
  fingerprint256: string;
  subject: string;
  validTo: string;
  loadedAt: number;
}

/**
 * DNS over TLS (RFC 7858): TLS 1.2 or newer, two-byte length framing, several queries per connection, answers
 * written as they arrive. The certificate and key are re-read when their files change and once an hour.
 */
export class DotServer {
  readonly counters: EncryptedDnsCounters = newCounters();
  private server: TlsServer | null = null;
  private watchers: FSWatcher[] = [];
  private reloadTimer: NodeJS.Timeout | null = null;
  private debounceTimer: NodeJS.Timeout | null = null;
  private info: CertificateInfo | null = null;
  private readonly idleTimeoutMs: number;
  private readonly maxInFlight: number;
  private readonly reloadIntervalMs: number;

  constructor(private readonly options: DotServerOptions) {
    this.idleTimeoutMs = options.idleTimeoutMs ?? DEFAULT_IDLE_MS;
    this.maxInFlight = options.maxInFlight ?? DEFAULT_IN_FLIGHT;
    this.reloadIntervalMs = options.reloadIntervalMs ?? HOUR;
  }

  /** The certificate currently presented. */
  get certificate(): CertificateInfo | null {
    return this.info;
  }

  async listen(port: number, host: string): Promise<void> {
    const material = await this.readMaterial();
    const server = createTlsServer({ key: material.key, cert: material.cert, minVersion: "TLSv1.2" }, (socket) => this.serve(socket));
    server.on("tlsClientError", () => undefined);
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, host, () => {
        server.off("error", reject);
        resolve();
      });
    });
    this.server = server;
    this.info = material.info;
    this.watchFiles();
    this.reloadTimer = setInterval(() => void this.reload(), this.reloadIntervalMs);
    this.reloadTimer.unref();
  }

  /** Re-reads the certificate and key; keeps the current pair when the new files do not parse. Returns true on a change. */
  async reload(): Promise<boolean> {
    if (!this.server) return false;
    let material: { key: Buffer; cert: Buffer; info: CertificateInfo };
    try {
      material = await this.readMaterial();
    } catch (error) {
      this.options.log(`dot certificate reload failed, keeping the current certificate: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
    if (material.info.fingerprint256 === this.info?.fingerprint256) return false;
    this.server.setSecureContext({ key: material.key, cert: material.cert, minVersion: "TLSv1.2" });
    this.info = material.info;
    this.options.log(`dot certificate reloaded: ${material.info.subject}, valid to ${material.info.validTo}`);
    return true;
  }

  async close(): Promise<void> {
    for (const watcher of this.watchers) watcher.close();
    this.watchers = [];
    if (this.reloadTimer) clearInterval(this.reloadTimer);
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    const server = this.server;
    this.server = null;
    if (!server) return;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  private async readMaterial(): Promise<{ key: Buffer; cert: Buffer; info: CertificateInfo }> {
    const [key, cert] = await Promise.all([readFile(this.options.keyFile), readFile(this.options.certFile)]);
    createSecureContext({ key, cert, minVersion: "TLSv1.2" });
    const parsed = new X509Certificate(cert);
    return { key, cert, info: { fingerprint256: parsed.fingerprint256, subject: parsed.subject, validTo: parsed.validTo, loadedAt: Date.now() } };
  }

  private watchFiles(): void {
    const files = [this.options.certFile, this.options.keyFile];
    const dirs = new Set(files.map((file) => dirname(file)));
    const names = new Set(files.map((file) => basename(file)));
    for (const dir of dirs) {
      try {
        const watcher = watch(dir, { persistent: false }, (_event, filename) => {
          if (filename && !names.has(String(filename))) return;
          if (this.debounceTimer) clearTimeout(this.debounceTimer);
          this.debounceTimer = setTimeout(() => void this.reload(), 1000);
          this.debounceTimer.unref();
        });
        watcher.on("error", () => undefined);
        this.watchers.push(watcher);
      } catch (error) {
        this.options.log(`cannot watch ${dir} for certificate changes: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  private serve(socket: TLSSocket): void {
    const client = (socket as Socket).remoteAddress ?? "unknown";
    let pending: Buffer = Buffer.alloc(0);
    let inFlight = 0;
    socket.setTimeout(this.idleTimeoutMs, () => socket.end());
    socket.on("error", () => undefined);
    const drain = (): void => {
      while (pending.length >= 2) {
        const length = pending.readUInt16BE(0);
        if (length === 0 || length > MAX_MESSAGE_BYTES) {
          socket.destroy();
          return;
        }
        if (pending.length < 2 + length) return;
        if (inFlight >= this.maxInFlight) {
          socket.pause();
          return;
        }
        const query = Buffer.from(pending.subarray(2, 2 + length));
        pending = pending.subarray(2 + length);
        inFlight += 1;
        const reply = isQuery(query) ? answer(this.options, this.counters, "dot", client, query) : Promise.resolve(servfail(query));
        void reply.then((message) => {
          inFlight -= 1;
          if (!socket.destroyed) {
            const framed = Buffer.alloc(2 + message.length);
            framed.writeUInt16BE(message.length, 0);
            message.copy(framed, 2);
            socket.write(framed);
          }
          if (socket.isPaused()) {
            socket.resume();
            drain();
          }
        });
      }
    };
    socket.on("data", (chunk: Buffer) => {
      pending = pending.length === 0 ? chunk : Buffer.concat([pending, chunk]);
      drain();
    });
  }
}
