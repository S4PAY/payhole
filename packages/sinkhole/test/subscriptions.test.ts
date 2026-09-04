import { createServer, type Server } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Subscriptions, normalizeListUrl, parseListText, subscriptionId } from "../src/subscriptions.js";

const NL = String.fromCharCode(10);
const HOSTS = ["# StevenBlack style", "127.0.0.1 localhost", "0.0.0.0 0.0.0.0", "0.0.0.0 ads.example  tracker.example # both", "0.0.0.0 Drainer.Example", "", "||adblock.example^", ""].join(NL);
const PLAIN = ["# plain", "one.example", "two.example", "not a host", ""].join(NL);

let server: Server;
let base = "";
let dir = "";
let hostsVersion = 1;
let hits = 0;
let conditional = 0;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "sinkhole-lists-"));
  server = createServer((req, res) => {
    hits += 1;
    const etag = `"hosts-${hostsVersion}"`;
    if (req.url === "/hosts.txt") {
      if (req.headers["if-none-match"] === etag) {
        conditional += 1;
        res.writeHead(304);
        res.end();
        return;
      }
      const body = hostsVersion === 1 ? HOSTS : HOSTS + `0.0.0.0 later.example${NL}`;
      res.writeHead(200, { "content-type": "text/plain", etag });
      res.end(body);
      return;
    }
    if (req.url === "/plain.txt") {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end(PLAIN);
      return;
    }
    if (req.url === "/huge.txt") {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("0.0.0.0 x.example" + NL.repeat(5000) + "0.0.0.0 y.example".repeat(400));
      return;
    }
    if (req.url === "/slow.txt") {
      setTimeout(() => {
        res.writeHead(200);
        res.end("slow.example");
      }, 2000);
      return;
    }
    res.writeHead(404);
    res.end("nope");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await rm(dir, { recursive: true, force: true });
});

describe("parseListText", () => {
  it("reads hosts lines with several names, plain lines, and skips comments and non-hostnames", () => {
    const hosts = parseListText(HOSTS);
    expect([...hosts.domains].sort()).toEqual(["ads.example", "drainer.example", "tracker.example"]);
    expect(hosts.invalid).toBe(3);
    const plain = parseListText(PLAIN);
    expect([...plain.domains]).toEqual(["one.example", "two.example"]);
    expect(plain.invalid).toBe(3);
  });

  it("normalises list urls", () => {
    expect(normalizeListUrl("https://example.com/list.txt#frag")).toBe("https://example.com/list.txt");
    expect(normalizeListUrl("ftp://example.com/list.txt")).toBeNull();
    expect(normalizeListUrl("https://user:pw@example.com/list.txt")).toBeNull();
    expect(normalizeListUrl("nope")).toBeNull();
    expect(subscriptionId("https://example.com/list.txt")).toMatch(/^[0-9a-f]{12}$/);
  });
});

describe("Subscriptions", () => {
  it("adds, fetches with conditional headers, merges, persists, and removes lists", async () => {
    const changes: number[] = [];
    let now = 1_800_000_000_000;
    const subs = await Subscriptions.load({ dir, refreshMs: 3_600_000, timeoutMs: 1000, maxBytes: 4096, clock: () => now });
    subs.onChange(() => changes.push(now));
    const added = await subs.add(`${base}/hosts.txt`);
    expect(added.added).toBe(true);
    expect((await subs.add(`${base}/hosts.txt#x`)).added).toBe(false);
    const first = await subs.refresh(added.item.id);
    expect(first).toEqual({ ok: true, changed: true, entries: 3, error: null });
    expect(subs.domains().has("drainer.example")).toBe(true);
    expect(changes).toHaveLength(1);
    expect(await readFile(join(dir, `${added.item.id}.txt`), "utf8")).toBe(`ads.example${NL}drainer.example${NL}tracker.example${NL}`);

    const unchanged = await subs.refresh(added.item.id);
    expect(unchanged).toEqual({ ok: true, changed: false, entries: 3, error: null });
    expect(conditional).toBe(1);
    expect(changes).toHaveLength(1);

    hostsVersion = 2;
    const updated = await subs.refresh(added.item.id);
    expect(updated.changed).toBe(true);
    expect(updated.entries).toBe(4);
    expect(subs.domains().has("later.example")).toBe(true);

    const plain = await subs.add(`${base}/plain.txt`);
    await subs.refresh(plain.item.id);
    expect(subs.domains().size).toBe(6);
    expect(subs.list().map((s) => s.entries)).toEqual([4, 2]);
    expect(subs.get(plain.item.id)?.nextRefreshAt).toBe(now + 3_600_000);

    const reloaded = await Subscriptions.load({ dir, refreshMs: 3_600_000, clock: () => now });
    expect(reloaded.size).toBe(2);
    expect(reloaded.domains().size).toBe(6);

    expect(await subs.remove(plain.item.id)).toBe(true);
    expect(await subs.remove(plain.item.id)).toBe(false);
    expect(subs.domains().size).toBe(4);
    expect(subs.list()).toHaveLength(1);

    now += 3_600_000;
    hits = 0;
    expect(await subs.refreshDue()).toBe(1);
    expect(hits).toBe(1);
    expect(await subs.refreshDue()).toBe(0);
  });

  it("reports failures without dropping the last good list, and enforces the size cap and timeout", async () => {
    const dir2 = await mkdtemp(join(tmpdir(), "sinkhole-lists-"));
    const subs = await Subscriptions.load({ dir: dir2, refreshMs: 3_600_000, timeoutMs: 500, maxBytes: 4096 }, [`${base}/missing.txt`]);
    const [missing] = subs.list();
    expect(missing).toBeDefined();
    const result = await subs.refresh(missing!.id);
    expect(result).toMatchObject({ ok: false, error: "HTTP 404" });
    expect(subs.get(missing!.id)?.lastError).toBe("HTTP 404");
    const huge = await subs.add(`${base}/huge.txt`);
    expect((await subs.refresh(huge.item.id)).error).toMatch(/byte limit/);
    const slow = await subs.add(`${base}/slow.txt`);
    expect((await subs.refresh(slow.item.id)).ok).toBe(false);
    await expect(subs.add("ftp://x")).rejects.toThrow();
    await expect(Subscriptions.load({ dir: dir2, refreshMs: 1 }, ["not a url"])).rejects.toThrow();
    await rm(dir2, { recursive: true, force: true });
  });
});
