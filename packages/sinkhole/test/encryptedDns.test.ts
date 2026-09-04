import { execFile } from "node:child_process";
import { createSocket, type Socket as UdpSocket } from "node:dgram";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer as createTcpServer, type Server as TcpServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { connect as tlsConnect, type TLSSocket } from "node:tls";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { DnsForwarder } from "../src/dnsForwarder.js";
import { isTruncated, minTtl, questionSectionEnd, rcode, servfail } from "../src/dnsWire.js";
import { createDohServer, DotServer, type EncryptedDnsCounters } from "../src/encryptedDns.js";
import { QueryStats } from "../src/queryLog.js";
import { RateLimiter } from "../src/rateLimit.js";

const run = promisify(execFile);

/** Wire-format query for `name`, type A, with the EDNS OPT record clients usually add. */
function query(id: number, name: string): Buffer {
  const labels = name.split(".").map((label) => Buffer.concat([Buffer.from([label.length]), Buffer.from(label)]));
  const question = Buffer.concat([...labels, Buffer.from([0, 0, 1, 0, 1])]);
  const header = Buffer.from([id >> 8, id & 0xff, 0x01, 0x00, 0, 1, 0, 0, 0, 0, 0, 1]);
  const opt = Buffer.from([0, 0, 41, 0x10, 0, 0, 0, 0, 0, 0, 0]);
  return Buffer.concat([header, question, opt]);
}

/** An answer with one A record per TTL given, optionally marked truncated. */
function answerFor(q: Buffer, ttls: number[], options: { truncated?: boolean; marker?: number } = {}): Buffer {
  const end = questionSectionEnd(q);
  const header = Buffer.from(q.subarray(0, 12));
  header.writeUInt8(0x81 | (options.truncated ? 0x02 : 0), 2);
  header.writeUInt8(0x80, 3);
  header.writeUInt16BE(1, 4);
  header.writeUInt16BE(ttls.length, 6);
  header.writeUInt16BE(0, 8);
  header.writeUInt16BE(0, 10);
  const records = ttls.map((ttl) => {
    const rr = Buffer.alloc(16);
    rr.writeUInt16BE(0xc00c, 0);
    rr.writeUInt16BE(1, 2);
    rr.writeUInt16BE(1, 4);
    rr.writeUInt32BE(ttl, 6);
    rr.writeUInt16BE(4, 10);
    rr.set([93, 184, 216, options.marker ?? 34], 12);
    return rr;
  });
  return Buffer.concat([header, q.subarray(12, end), ...records]);
}

function nameOf(q: Buffer): string {
  const parts: string[] = [];
  let i = 12;
  for (;;) {
    const length = q.readUInt8(i);
    if (length === 0) break;
    parts.push(q.subarray(i + 1, i + 1 + length).toString());
    i += 1 + length;
  }
  return parts.join(".");
}

interface StubResolver {
  port: number;
  udp: UdpSocket;
  tcp: TcpServer;
  seen: { udp: number; tcp: number };
  close(): Promise<void>;
}

/** A resolver that answers every A query with TTLs 300 and 60; names starting with "big" are truncated over UDP. */
async function startStubResolver(): Promise<StubResolver> {
  const seen = { udp: 0, tcp: 0 };
  const udp = createSocket("udp4");
  udp.on("message", (message, rinfo) => {
    seen.udp += 1;
    const truncated = nameOf(message).startsWith("big");
    udp.send(answerFor(message, [300, 60], { truncated, marker: 1 }), rinfo.port, rinfo.address);
  });
  await new Promise<void>((resolve) => udp.bind(0, "127.0.0.1", resolve));
  const port = udp.address().port;
  const tcp = createTcpServer((socket) => {
    let pending = Buffer.alloc(0);
    socket.on("data", (chunk: Buffer) => {
      pending = Buffer.concat([pending, chunk]);
      while (pending.length >= 2 && pending.length >= 2 + pending.readUInt16BE(0)) {
        const length = pending.readUInt16BE(0);
        const message = pending.subarray(2, 2 + length);
        pending = pending.subarray(2 + length);
        seen.tcp += 1;
        const reply = answerFor(message, [300, 60], { marker: 2 });
        const framed = Buffer.alloc(2 + reply.length);
        framed.writeUInt16BE(reply.length, 0);
        reply.copy(framed, 2);
        socket.write(framed);
      }
    });
  });
  await new Promise<void>((resolve) => tcp.listen(port, "127.0.0.1", resolve));
  return {
    port,
    udp,
    tcp,
    seen,
    close: async () => {
      udp.close();
      await new Promise<void>((resolve) => tcp.close(() => resolve()));
    },
  };
}

function log(): void {
  /* silent in tests */
}

describe("dns wire helpers", () => {
  it("finds the question end, the lowest TTL, and builds SERVFAIL", () => {
    const q = query(7, "example.com");
    expect(questionSectionEnd(q)).toBe(12 + 17);
    const reply = answerFor(q, [300, 60]);
    expect(minTtl(reply)).toBe(60);
    expect(minTtl(answerFor(q, []))).toBeNull();
    expect(isTruncated(answerFor(q, [1], { truncated: true }))).toBe(true);
    const fail = servfail(q);
    expect(fail.readUInt16BE(0)).toBe(7);
    expect(rcode(fail)).toBe(2);
    expect(fail.readUInt8(2) & 0x80).toBe(0x80);
    expect(fail.readUInt16BE(4)).toBe(1);
    expect(fail.readUInt16BE(10)).toBe(0);
    expect(fail.length).toBe(12 + 17);
    expect(rcode(servfail(Buffer.from([1, 2, 3])))).toBe(2);
  });
});

describe("forwarder", () => {
  let stub: StubResolver;
  beforeAll(async () => {
    stub = await startStubResolver();
  });
  afterAll(() => stub.close());

  it("answers over UDP and repeats over TCP when the UDP answer is truncated", async () => {
    const forwarder = new DnsForwarder({ host: "127.0.0.1", port: stub.port, timeoutMs: 2000 });
    const small = await forwarder.query(query(1, "small.example"));
    expect(small.readUInt16BE(0)).toBe(1);
    expect(small.at(-1)).toBe(1);
    const big = await forwarder.query(query(2, "big.example"));
    expect(big.at(-1)).toBe(2);
    expect(isTruncated(big)).toBe(false);
    expect(stub.seen.tcp).toBe(1);
  });

  it("rejects when nothing answers", async () => {
    const forwarder = new DnsForwarder({ host: "127.0.0.1", port: 9, timeoutMs: 300 });
    await expect(forwarder.query(query(3, "example.com"))).rejects.toThrow(/no UDP answer|ECONNREFUSED/);
  });
});

describe("dns over https", () => {
  let stub: StubResolver;
  let base = "";
  let counters: EncryptedDnsCounters;
  const stats = new QueryStats();
  let server: ReturnType<typeof createDohServer>;

  beforeAll(async () => {
    stub = await startStubResolver();
    server = createDohServer({
      forwarder: new DnsForwarder({ host: "127.0.0.1", port: stub.port, timeoutMs: 2000 }),
      limiter: new RateLimiter(3, 60_000),
      log,
      onQuery: (transport) => stats.countTransport(transport),
    });
    counters = server.counters;
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    base = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
  });
  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await stub.close();
  });

  it("answers GET and POST with the wire answer, the lowest TTL as max-age, and counts the transport", async () => {
    const q = query(11, "example.com");
    const viaGet = await fetch(`${base}/dns-query?dns=${q.toString("base64url")}`);
    expect(viaGet.status).toBe(200);
    expect(viaGet.headers.get("content-type")).toBe("application/dns-message");
    expect(viaGet.headers.get("cache-control")).toBe("max-age=60");
    const got = Buffer.from(await viaGet.arrayBuffer());
    expect(got.readUInt16BE(0)).toBe(11);
    expect(rcode(got)).toBe(0);
    const viaPost = await fetch(`${base}/dns-query`, { method: "POST", headers: { "content-type": "application/dns-message" }, body: new Uint8Array(query(12, "big.example")) });
    expect(viaPost.status).toBe(200);
    expect(Buffer.from(await viaPost.arrayBuffer()).at(-1)).toBe(2);
    expect(counters.queries).toBe(2);
    expect(stats.snapshot().upstreams).toEqual([{ upstream: "doh", count: 2 }]);
    const health = await fetch(`${base}/healthz`);
    expect(await health.json()).toMatchObject({ ok: true, transport: "doh" });
  });

  it("rejects other paths, methods, content types, and malformed input", async () => {
    expect((await fetch(`${base}/other`)).status).toBe(404);
    expect((await fetch(`${base}/dns-query`, { method: "PUT" })).status).toBe(405);
    expect((await fetch(`${base}/dns-query`, { method: "POST", headers: { "content-type": "text/plain" }, body: "x" })).status).toBe(415);
    expect((await fetch(`${base}/dns-query?dns=%%%`)).status).toBe(400);
    expect((await fetch(`${base}/dns-query?dns=AAAA`)).status).toBe(400);
    expect((await fetch(`${base}/dns-query`)).status).toBe(400);
  });

  it("answers SERVFAIL without caching once a client is over the limit", async () => {
    const q = query(13, "example.com");
    const third = await fetch(`${base}/dns-query?dns=${q.toString("base64url")}`);
    expect(rcode(Buffer.from(await third.arrayBuffer()))).toBe(0);
    const fourth = await fetch(`${base}/dns-query?dns=${q.toString("base64url")}`);
    expect(fourth.status).toBe(200);
    expect(fourth.headers.get("cache-control")).toBe("no-store");
    const failed = Buffer.from(await fourth.arrayBuffer());
    expect(rcode(failed)).toBe(2);
    expect(failed.readUInt16BE(0)).toBe(13);
    expect(counters.limited).toBe(1);
  });
});

async function makeCertificate(dir: string, name: string): Promise<{ cert: string; key: string }> {
  const cert = join(dir, `${name}.crt`);
  const key = join(dir, `${name}.key`);
  await run("openssl", ["req", "-x509", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:prime256v1", "-nodes", "-keyout", key, "-out", cert, "-days", "3650", "-subj", `/CN=${name}.example`]);
  return { cert, key };
}

async function hasOpenssl(): Promise<boolean> {
  try {
    await run("openssl", ["version"]);
    return true;
  } catch {
    return false;
  }
}

function frame(message: Buffer): Buffer {
  const out = Buffer.alloc(2 + message.length);
  out.writeUInt16BE(message.length, 0);
  message.copy(out, 2);
  return out;
}

/** Opens a TLS connection and returns a helper that collects framed answers. */
function openDot(port: number): Promise<{ socket: TLSSocket; next: () => Promise<Buffer>; closed: Promise<void> }> {
  return new Promise((resolve, reject) => {
    const answers: Buffer[] = [];
    const waiters: ((b: Buffer) => void)[] = [];
    let pending = Buffer.alloc(0);
    const socket = tlsConnect({ host: "127.0.0.1", port, rejectUnauthorized: false, minVersion: "TLSv1.2" }, () => {
      resolve({
        socket,
        next: () =>
          new Promise<Buffer>((done) => {
            const ready = answers.shift();
            if (ready) done(ready);
            else waiters.push(done);
          }),
        closed,
      });
    });
    const closed = new Promise<void>((done) => socket.once("close", () => done()));
    socket.once("error", reject);
    socket.on("data", (chunk: Buffer) => {
      pending = Buffer.concat([pending, chunk]);
      while (pending.length >= 2 && pending.length >= 2 + pending.readUInt16BE(0)) {
        const length = pending.readUInt16BE(0);
        const message = Buffer.from(pending.subarray(2, 2 + length));
        pending = pending.subarray(2 + length);
        const waiter = waiters.shift();
        if (waiter) waiter(message);
        else answers.push(message);
      }
    });
  });
}

describe("dns over tls", async () => {
  const available = await hasOpenssl();
  let stub: StubResolver;
  let dir = "";
  let dot: DotServer;
  let port = 0;
  let first: { cert: string; key: string };
  let second: { cert: string; key: string };

  beforeAll(async () => {
    if (!available) return;
    stub = await startStubResolver();
    dir = await mkdtemp(join(tmpdir(), "sinkhole-dot-"));
    first = await makeCertificate(dir, "first");
    second = await makeCertificate(dir, "second");
    const live = { cert: join(dir, "live.crt"), key: join(dir, "live.key") };
    await writeFile(live.cert, await (await import("node:fs/promises")).readFile(first.cert));
    await writeFile(live.key, await (await import("node:fs/promises")).readFile(first.key));
    dot = new DotServer({
      forwarder: new DnsForwarder({ host: "127.0.0.1", port: stub.port, timeoutMs: 2000 }),
      limiter: new RateLimiter(3, 60_000),
      log,
      certFile: live.cert,
      keyFile: live.key,
      idleTimeoutMs: 400,
      reloadIntervalMs: 60 * 60 * 1000,
    });
    await dot.listen(0, "127.0.0.1");
    port = ((dot as unknown as { server: { address(): { port: number } } }).server).address().port;
  });
  afterAll(async () => {
    if (!available) return;
    await dot.close();
    await stub.close();
    await rm(dir, { recursive: true, force: true });
  });

  it.skipIf(!available)("answers two queries on one connection and presents the certificate", async () => {
    const c = await openDot(port);
    expect(c.socket.getPeerCertificate().subject.CN).toBe("first.example");
    c.socket.write(Buffer.concat([frame(query(21, "one.example")), frame(query(22, "big.example"))]));
    const [a, b] = [await c.next(), await c.next()];
    const ids = [a.readUInt16BE(0), b.readUInt16BE(0)].sort();
    expect(ids).toEqual([21, 22]);
    expect(rcode(a)).toBe(0);
    expect(rcode(b)).toBe(0);
    expect(dot.counters.queries).toBe(2);
    c.socket.destroy();
  });

  it.skipIf(!available)("closes an idle connection", async () => {
    const c = await openDot(port);
    const started = Date.now();
    await c.closed;
    expect(Date.now() - started).toBeGreaterThanOrEqual(300);
    expect(Date.now() - started).toBeLessThan(5000);
  });

  it.skipIf(!available)("answers SERVFAIL over the limit", async () => {
    const c = await openDot(port);
    c.socket.write(Buffer.concat([frame(query(31, "three.example")), frame(query(32, "four.example"))]));
    const answers = [await c.next(), await c.next()];
    const codes = answers.map((m) => rcode(m)).sort();
    expect(codes).toEqual([0, 2]);
    expect(dot.counters.limited).toBe(1);
    c.socket.destroy();
  });

  it.skipIf(!available)("picks up a renewed certificate from the files without a restart", async () => {
    const fs = await import("node:fs/promises");
    const before = dot.certificate?.fingerprint256;
    await fs.writeFile(join(dir, "live.key"), await fs.readFile(second.key));
    await fs.writeFile(join(dir, "live.crt"), await fs.readFile(second.cert));
    const deadline = Date.now() + 8000;
    while (dot.certificate?.fingerprint256 === before && Date.now() < deadline) await new Promise((r) => setTimeout(r, 100));
    if (dot.certificate?.fingerprint256 === before) expect(await dot.reload()).toBe(true);
    expect(dot.certificate?.subject).toContain("second.example");
    const c = await openDot(port);
    expect(c.socket.getPeerCertificate().subject.CN).toBe("second.example");
    c.socket.destroy();
    await fs.writeFile(join(dir, "live.crt"), "not a certificate");
    expect(await dot.reload()).toBe(false);
    expect(dot.certificate?.subject).toContain("second.example");
  });
});

describe("configuration", () => {
  const base = { ADMIN_TOKEN: "t" };
  it("keeps both transports off by default and validates the TLS files", () => {
    const config = loadConfig({ ...base });
    expect(config.doh).toEqual({ enabled: false, listen: "0.0.0.0", port: 8054 });
    expect(config.dot).toMatchObject({ enabled: false, listen: "0.0.0.0", port: 853 });
    expect(config.dnsRateLimitPerMinute).toBe(300);
    expect(() => loadConfig({ ...base, DOT_ENABLED: "1" })).toThrow(/DOT_CERT_FILE/);
    expect(() => loadConfig({ ...base, DOH_LISTEN: "nope" })).toThrow(/DOH_LISTEN/);
    const on = loadConfig({ ...base, DOH_ENABLED: "1", DOH_PORT: "9000", DOT_ENABLED: "1", DOT_CERT_FILE: "/c", DOT_KEY_FILE: "/k", DNS_RATE_LIMIT_PER_MINUTE: "10" });
    expect(on.doh).toEqual({ enabled: true, listen: "0.0.0.0", port: 9000 });
    expect(on.dot).toEqual({ enabled: true, listen: "0.0.0.0", port: 853, certFile: "/c", keyFile: "/k" });
    expect(on.dnsRateLimitPerMinute).toBe(10);
  });
});
