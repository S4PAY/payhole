import { describe, expect, it } from "vitest";
import { QueryStats, parseQueryLogLine, type QueryStatsState } from "../src/queryLog.js";

const START = 1_800_000_000_000;

function make(): { stats: QueryStats; advance: (ms: number) => void; now: () => number } {
  let now = START;
  const stats = new QueryStats({ clock: () => now, pendingTimeoutMs: 10_000, logSize: 5, clientsPerSlot: 3, domainsPerSlot: 4 });
  return { stats, advance: (ms) => (now += ms), now: () => now };
}

function play(stats: QueryStats, id: number, client: string, domain: string, ...rest: string[]): void {
  stats.ingest(`dnsmasq[18]: ${id} ${client}/5${id} query[A] ${domain} from ${client}`);
  for (const line of rest) stats.ingest(`dnsmasq[18]: ${id} ${client}/5${id} ${line}`);
}

describe("parseQueryLogLine", () => {
  it("reads the extra format with and without the client, with the proto prefix, and the plain format", () => {
    expect(parseQueryLogLine("dnsmasq[18]: 12 192.168.1.5/54321 query[A] Example.COM from 192.168.1.5")).toEqual({ kind: "query", id: 12, client: "192.168.1.5", type: "A", domain: "example.com" });
    expect(parseQueryLogLine("12 192.168.1.5/54321 forwarded example.com to 1.1.1.1")).toEqual({ kind: "forwarded", id: 12, client: "192.168.1.5", domain: "example.com", upstream: "1.1.1.1" });
    expect(parseQueryLogLine("12 192.168.1.5/54321 reply example.com is 93.184.216.34")).toEqual({ kind: "answer", id: 12, client: "192.168.1.5", domain: "example.com", source: "reply", answer: "93.184.216.34" });
    expect(parseQueryLogLine("UDP 13 192.168.1.5/54322 cached example.com is 93.184.216.34")).toMatchObject({ kind: "answer", id: 13, source: "cached" });
    expect(parseQueryLogLine("13 192.168.1.5/54322 cached-stale example.com is 93.184.216.34")).toMatchObject({ source: "cached" });
    expect(parseQueryLogLine("14 192.168.1.5/54323 config drainer.example is 0.0.0.0")).toMatchObject({ source: "config", answer: "0.0.0.0" });
    expect(parseQueryLogLine("15 192.168.1.5/54324 /data/dnsmasq/blocked.hosts ads.example is 0.0.0.0")).toMatchObject({ source: "hosts", domain: "ads.example", answer: "0.0.0.0" });
    expect(parseQueryLogLine("16 reply example.com is NXDOMAIN")).toEqual({ kind: "answer", id: 16, client: null, domain: "example.com", source: "reply", answer: "NXDOMAIN" });
    expect(parseQueryLogLine("17 192.168.1.5/1 reply example.com is 1.2.3.4 (DNSSEC signed)")).toMatchObject({ answer: "1.2.3.4" });
    expect(parseQueryLogLine("query[AAAA] example.com from 10.0.0.2")).toEqual({ kind: "query", id: null, client: "10.0.0.2", type: "AAAA", domain: "example.com" });
    expect(parseQueryLogLine("dnsmasq: forwarded example.com to 9.9.9.9#5353")).toMatchObject({ kind: "forwarded", id: null, upstream: "9.9.9.9#5353" });
  });

  it("ignores lines that are not about a query", () => {
    for (const line of [
      "dnsmasq[18]: started, version 2.92rel2 cachesize 10000",
      "dnsmasq[18]: using nameserver 1.1.1.1#53",
      "dnsmasq-dhcp[18]: DHCPACK(eth0) 192.168.1.5 aa:bb:cc:dd:ee:ff laptop",
      "dnsmasq[18]: 19 192.168.1.5/1 validation example.com is BOGUS",
      "dnsmasq[18]: warning: ignoring resolv-file flag because no-resolv is set",
      "",
    ]) {
      expect(parseQueryLogLine(line), line).toBeNull();
    }
  });
});

describe("QueryStats", () => {
  it("correlates queries with their outcome and keeps totals, clients, domains, types and upstreams", () => {
    const { stats, advance } = make();
    play(stats, 1, "10.0.0.2", "example.com", "forwarded example.com to 1.1.1.1", "reply example.com is 93.184.216.34");
    play(stats, 2, "10.0.0.2", "example.com", "cached example.com is 93.184.216.34");
    play(stats, 3, "10.0.0.3", "drainer.example", "config drainer.example is 0.0.0.0");
    play(stats, 4, "10.0.0.3", "ads.example", "/data/dnsmasq/blocked.hosts ads.example is 0.0.0.0");
    play(stats, 5, "10.0.0.3", "alias.example", "forwarded alias.example to 9.9.9.9", "reply alias.example is <CNAME>", "reply target.example is 1.2.3.4");
    play(stats, 6, "10.0.0.4", "5.0.0.10.in-addr.arpa", "config 10.0.0.5 is NXDOMAIN");
    advance(1000);
    const snap = stats.snapshot();
    expect(snap.summary).toEqual({ queries24h: 6, blocked24h: 2, dangerous24h: 0, blockedPercent: 33.3, cached24h: 1, forwarded24h: 2, clients24h: 3, queries7d: 6, blocked7d: 2 });
    expect(snap.blockedByCategory).toEqual([{ category: "other", count: 2 }]);
    expect(snap.clients).toEqual([
      { client: "10.0.0.3", total: 3, blocked: 2 },
      { client: "10.0.0.2", total: 2, blocked: 0 },
      { client: "10.0.0.4", total: 1, blocked: 0 },
    ]);
    expect(snap.topBlocked).toEqual([
      { domain: "ads.example", count: 1, category: null },
      { domain: "drainer.example", count: 1, category: null },
    ]);
    expect(snap.topPermitted).toEqual([
      { domain: "example.com", count: 2 },
      { domain: "alias.example", count: 1 },
    ]);
    expect(snap.types).toEqual([{ type: "A", count: 6 }]);
    expect(snap.upstreams).toEqual([
      { upstream: "1.1.1.1", count: 1 },
      { upstream: "9.9.9.9", count: 1 },
    ]);
    expect(snap.minutes.total).toHaveLength(1440);
    expect(snap.minutes.total.at(-1)).toBe(6);
    expect(snap.minutes.blocked.at(-1)).toBe(2);
    expect(snap.hours.total).toHaveLength(168);
    expect(snap.hours.total.at(-1)).toBe(6);
    const log = stats.queries();
    expect(log.map((q) => q.domain)).toEqual(["5.0.0.10.in-addr.arpa", "alias.example", "ads.example", "drainer.example", "example.com"]);
    expect(log[1]).toMatchObject({ status: "forwarded", upstream: "9.9.9.9", answer: "1.2.3.4" });
    expect(log[0]).toMatchObject({ status: "local", answer: "NXDOMAIN" });
    expect(stats.queries({ status: "blocked" }).map((q) => q.domain)).toEqual(["ads.example", "drainer.example"]);
    expect(stats.queries({ client: "10.0.0.2" }).map((q) => q.domain)).toEqual(["example.com"]);
    expect(stats.queries({ domain: "drain" })).toHaveLength(1);
    expect(stats.queries({ limit: 2 })).toHaveLength(2);
  });

  it("finalises unanswered queries on sweep and caps ranked names per hour", () => {
    const { stats, advance } = make();
    play(stats, 1, "10.0.0.2", "slow.example", "forwarded slow.example to 1.1.1.1");
    play(stats, 2, "10.0.0.2", "lost.example");
    expect(stats.sweep()).toBe(0);
    advance(11_000);
    expect(stats.sweep()).toBe(2);
    const log = stats.queries();
    expect(log.map((q) => [q.domain, q.status])).toEqual([
      ["lost.example", "unanswered"],
      ["slow.example", "forwarded"],
    ]);
    for (let i = 0; i < 6; i += 1) play(stats, 10 + i, "10.0.0.9", `blocked${i}.example`, `config blocked${i}.example is 0.0.0.0`);
    const snap = stats.snapshot();
    expect(snap.topBlocked).toHaveLength(4);
    expect(snap.summary.blocked24h).toBe(6);
    expect(snap.clients.map((c) => c.client)).toEqual(["10.0.0.9", "10.0.0.2"]);
  });

  it("keeps a 24 hour window at minute resolution and 7 days at hour resolution", () => {
    const { stats, advance } = make();
    play(stats, 1, "10.0.0.2", "old.example", "config old.example is 0.0.0.0");
    advance(25 * 3_600_000);
    play(stats, 2, "10.0.0.2", "new.example", "config new.example is 0.0.0.0");
    const snap = stats.snapshot();
    expect(snap.summary.queries24h).toBe(1);
    expect(snap.summary.queries7d).toBe(2);
    expect(snap.topBlocked).toEqual([{ domain: "new.example", count: 1, category: null }]);
    advance(7 * 24 * 3_600_000);
    expect(stats.snapshot().summary.queries7d).toBe(0);
  });

  it("counts plain-format lines without correlation", () => {
    const { stats } = make();
    stats.ingest("query[A] example.com from 10.0.0.2");
    stats.ingest("forwarded example.com to 1.1.1.1");
    stats.ingest("reply example.com is 1.2.3.4");
    stats.ingest("query[A] drainer.example from 10.0.0.2");
    stats.ingest("config drainer.example is 0.0.0.0");
    const snap = stats.snapshot();
    expect(snap.summary.queries24h).toBe(2);
    expect(snap.summary.blocked24h).toBe(1);
    expect(snap.summary.forwarded24h).toBe(1);
    expect(stats.queries().every((q) => q.status === "unknown")).toBe(true);
  });

  it("survives a snapshot round trip and bounds the log ring", () => {
    const { stats, advance, now } = make();
    for (let i = 0; i < 8; i += 1) play(stats, i, "10.0.0.2", `d${i}.example`, `config d${i}.example is 0.0.0.0`);
    expect(stats.queries()).toHaveLength(5);
    expect(stats.queries()[0]?.domain).toBe("d7.example");
    expect(stats.changed).toBe(true);
    const saved = JSON.parse(JSON.stringify(stats.toJSON())) as QueryStatsState;
    expect(stats.changed).toBe(false);
    const restored = new QueryStats({ clock: now, logSize: 5 }, saved);
    expect(restored.snapshot().summary).toEqual(stats.snapshot().summary);
    expect(restored.queries().map((q) => q.domain)).toEqual(stats.queries().map((q) => q.domain));
    expect(restored.snapshot().topBlocked).toHaveLength(4);
    advance(60_000);
    play(restored, 99, "10.0.0.2", "later.example", "cached later.example is 1.1.1.1");
    expect(restored.snapshot().summary.queries24h).toBe(9);
    expect(restored.queries()[0]?.domain).toBe("later.example");
  });
});

describe("QueryStats categories", () => {
  it("tags blocked queries with the blocklist's category and counts blocks per category", () => {
    let now = 1_700_000_000_000;
    const stats = new QueryStats({ clock: () => now, categoryOf: (domain) => (domain.startsWith("kit.") ? "drainer" : domain.startsWith("ads.") ? "ad" : null) });
    const feed = (id: number, domain: string) => {
      stats.ingest(`${id} 10.0.0.9/5000 query[A] ${domain} from 10.0.0.9`, now);
      stats.ingest(`${id} 10.0.0.9/5000 config ${domain} is 0.0.0.0`, now);
      now += 10;
    };
    feed(1, "kit.example");
    feed(2, "ads.example");
    feed(3, "kit.example");
    feed(4, "plain.example");
    const snap = stats.snapshot(now);
    expect(snap.summary.blocked24h).toBe(4);
    expect(snap.summary.dangerous24h).toBe(2);
    expect(snap.blockedByCategory).toEqual([
      { category: "drainer", count: 2 },
      { category: "ad", count: 1 },
      { category: "other", count: 1 },
    ]);
    expect(snap.topBlocked.find((d) => d.domain === "kit.example")?.category).toBe("drainer");
    const records = stats.queries({ status: "blocked" });
    expect(records.find((r) => r.domain === "kit.example")?.category).toBe("drainer");
    expect(records.find((r) => r.domain === "plain.example")?.category).toBeUndefined();
    const restored = new QueryStats({ clock: () => now }, stats.toJSON());
    expect(restored.snapshot(now).blockedByCategory).toEqual(snap.blockedByCategory);
  });
});
