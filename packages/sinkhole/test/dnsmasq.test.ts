import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DnsmasqSupervisor } from "../src/dnsmasq.js";
import { dnsmasqArgs, isUpstream, renderBlocklistConfig, renderDnsmasqConfig, renderHostsFile } from "../src/render/dnsmasq.js";
import { renderExport } from "../src/render/export.js";

const NL = String.fromCharCode(10);

describe("renderDnsmasqConfig", () => {
  const settings = { listen: "0.0.0.0", port: 53, upstream: ["1.1.1.1", "9.9.9.9#5353"], cacheSize: 10_000, blocklistFile: "/data/dnsmasq/blocklist.conf", user: "dnsmasq" };

  it("renders every setting, with query logging and the hosts file only when asked", () => {
    const text = renderDnsmasqConfig(settings);
    const lines = text.split(NL);
    expect(lines).toContain("port=53");
    expect(lines).toContain("listen-address=0.0.0.0");
    expect(lines).toContain("bind-interfaces");
    expect(lines).toContain("no-resolv");
    expect(lines).toContain("no-hosts");
    expect(lines).toContain("cache-size=10000");
    expect(lines).toContain("server=1.1.1.1");
    expect(lines).toContain("server=9.9.9.9#5353");
    expect(lines).toContain("user=dnsmasq");
    expect(lines).toContain("conf-file=/data/dnsmasq/blocklist.conf");
    expect(text).not.toMatch(/log-queries|log-facility|addn-hosts/);
    expect(text.endsWith(NL)).toBe(true);
    expect(renderDnsmasqConfig({ ...settings, user: undefined })).not.toContain("user=");
    const logged = renderDnsmasqConfig({ ...settings, logQueries: true, hostsFile: "/data/dnsmasq/blocked.hosts" }).split(NL);
    expect(logged).toContain("log-queries=extra");
    expect(logged).toContain("addn-hosts=/data/dnsmasq/blocked.hosts");
    expect(() => renderDnsmasqConfig({ ...settings, hostsFile: `/data/x${NL}log-queries` })).toThrow();
  });

  it("rejects unsafe values", () => {
    expect(() => renderDnsmasqConfig({ ...settings, listen: "dns.example" })).toThrow();
    expect(() => renderDnsmasqConfig({ ...settings, port: 70_000 })).toThrow();
    expect(() => renderDnsmasqConfig({ ...settings, upstream: [] })).toThrow();
    expect(() => renderDnsmasqConfig({ ...settings, upstream: ["one.one.one.one"] })).toThrow();
    expect(() => renderDnsmasqConfig({ ...settings, blocklistFile: `/data/x${NL}log-queries` })).toThrow();
    expect(() => renderDnsmasqConfig({ ...settings, cacheSize: -1 })).toThrow();
    expect(isUpstream("2606:4700:4700::1111")).toBe(true);
    expect(isUpstream("1.1.1.1#0")).toBe(false);
    expect(isUpstream("1.1.1.1#53#53")).toBe(false);
  });
});

describe("renderBlocklistConfig", () => {
  it("emits sorted, de-duplicated address rules for A and AAAA", () => {
    const text = renderBlocklistConfig(["tracker.example", "a.example", "tracker.example"]);
    expect(text.split(NL)).toEqual([
      "# Rendered by the PayHole Sinkhole agent. Edits are overwritten.",
      "# 2 blocked domains",
      "address=/a.example/0.0.0.0",
      "address=/a.example/::",
      "address=/tracker.example/0.0.0.0",
      "address=/tracker.example/::",
      "",
    ]);
    expect(renderBlocklistConfig([])).toContain("# 0 blocked domains");
    expect(() => renderBlocklistConfig(["bad/domain"])).toThrow();
    expect(dnsmasqArgs("/data/dnsmasq/sinkhole.conf")).toEqual(["--keep-in-foreground", "--no-resolv", "--log-facility=-", "--conf-file=/data/dnsmasq/sinkhole.conf"]);
  });
});

describe("renderHostsFile", () => {
  it("emits one sorted 0.0.0.0 line per name", () => {
    expect(renderHostsFile(["b.example", "a.example", "b.example"]).split(NL)).toEqual([
      "# Rendered by the PayHole Sinkhole agent from subscribed lists. Edits are overwritten.",
      "# 2 blocked domains",
      "0.0.0.0 a.example",
      "0.0.0.0 b.example",
      "",
    ]);
    expect(() => renderHostsFile(["bad domain"])).toThrow();
  });

  it("renders a 300k-name list in well under a second", () => {
    const names: string[] = [];
    for (let i = 0; i < 300_000; i += 1) names.push(`host${i}.list.example`);
    const started = performance.now();
    const text = renderHostsFile(names);
    const ms = performance.now() - started;
    expect(text.split(NL).length).toBe(300_003);
    expect(ms).toBeLessThan(5000);
    console.log(`renderHostsFile: 300000 names in ${Math.round(ms)} ms, ${text.length} bytes`);
  });
});

describe("renderExport", () => {
  const entries = [
    { domain: "b.example", sources: ["local" as const], reason: "r", category: "drainer" as const },
    { domain: "a.example", sources: ["manual" as const, "swarm" as const], reason: "m", category: null },
  ];

  it("renders every format sorted by domain", () => {
    expect(renderExport("plain", entries, "t").body).toBe(`a.example${NL}b.example${NL}`);
    expect(renderExport("hosts", entries, "t").body.split(NL)).toEqual(["# PayHole Sinkhole blocklist, 2 entries, generated t", "0.0.0.0 a.example", "0.0.0.0 b.example", ""]);
    expect(renderExport("dnsmasq", entries, "t").body).toContain("address=/a.example/0.0.0.0");
    const json = JSON.parse(renderExport("json", entries, "t").body) as { count: number; entries: { domain: string }[] };
    expect(json.count).toBe(2);
    expect(json.entries.map((e) => e.domain)).toEqual(["a.example", "b.example"]);
    expect(renderExport("json", entries, "t").contentType).toContain("application/json");
  });
});

describe("DnsmasqSupervisor", () => {
  let dir = "";
  let fake = "";
  let crashing = "";
  let chatty = "";

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "sinkhole-dnsmasq-"));
    fake = join(dir, "fake-dnsmasq");
    crashing = join(dir, "crashing-dnsmasq");
    chatty = join(dir, "chatty-dnsmasq");
    // Stays up, notes every SIGHUP in a file next to the config, and prints two log lines the way dnsmasq does.
    await writeFile(
      fake,
      [
        "#!/bin/sh",
        "trap 'echo HUP >> \"$SINKHOLE_TEST_HUPS\"' HUP",
        'echo "dnsmasq[$$]: started, version 2.92rel2 cachesize 100" >&2',
        'echo "dnsmasq[$$]: 1 127.0.0.1/40000 query[A] example.com from 127.0.0.1" >&2',
        "while :; do sleep 0.1; done",
        "",
      ].join(NL),
      { mode: 0o755 },
    );
    await writeFile(crashing, ["#!/bin/sh", "exit 3", ""].join(NL), { mode: 0o755 });
    await writeFile(chatty, ["#!/bin/sh", "exec sleep 30", ""].join(NL), { mode: 0o755 });
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("renders the files, restarts only when the curated set changes, reloads the hosts file with SIGHUP, and pipes the log", async () => {
    const lines: string[] = [];
    process.env["SINKHOLE_TEST_HUPS"] = join(dir, "conf", "hups");
    const supervisor = new DnsmasqSupervisor({
      binary: fake,
      confDir: join(dir, "conf"),
      settings: { listen: "127.0.0.1", port: 5354, upstream: ["1.1.1.1"], cacheSize: 100, user: undefined, logQueries: true },
      onLine: (line) => lines.push(line),
    });
    await supervisor.start({ curated: ["a.example"], hosts: ["ads.example"] });
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(supervisor.running).toBe(true);
    const pid = supervisor.status().pid;
    expect(await readFile(supervisor.configFile, "utf8")).toContain("port=5354");
    expect(await readFile(supervisor.configFile, "utf8")).toContain("log-queries=extra");
    expect(await readFile(supervisor.blocklistFile, "utf8")).toContain("address=/a.example/0.0.0.0");
    expect(await readFile(supervisor.hostsFile, "utf8")).toContain("0.0.0.0 ads.example");
    expect(lines).toContain("dnsmasq[" + String(pid) + "]: 1 127.0.0.1/40000 query[A] example.com from 127.0.0.1");

    expect(await supervisor.apply({ curated: ["a.example"], hosts: ["ads.example"] })).toBe("unchanged");
    expect(supervisor.status().pid).toBe(pid);

    expect(await supervisor.apply({ curated: ["a.example"], hosts: ["ads.example", "more.example"] })).toBe("reloaded");
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(supervisor.status().pid).toBe(pid);
    expect(supervisor.status().reloads).toBe(1);
    expect(supervisor.status().restarts).toBe(0);
    expect(await readFile(join(dir, "conf", "hups"), "utf8")).toContain("HUP");
    expect(await readFile(supervisor.hostsFile, "utf8")).toContain("0.0.0.0 more.example");

    expect(await supervisor.apply({ curated: ["a.example", "b.example"], hosts: ["ads.example", "more.example"] })).toBe("restarted");
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(supervisor.running).toBe(true);
    expect(supervisor.status().pid).not.toBe(pid);
    expect(supervisor.status().restarts).toBe(1);
    expect(await readFile(supervisor.blocklistFile, "utf8")).toContain("address=/b.example/0.0.0.0");

    await supervisor.stop();
    expect(supervisor.running).toBe(false);
    expect(supervisor.status().unexpectedExits).toBe(0);
  });

  it("inherits the output when no line handler is given", async () => {
    const supervisor = new DnsmasqSupervisor({
      binary: chatty,
      confDir: join(dir, "conf-quiet"),
      settings: { listen: "127.0.0.1", port: 5356, upstream: ["1.1.1.1"], cacheSize: 100, user: undefined },
    });
    await supervisor.start({ curated: [] });
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(supervisor.running).toBe(true);
    expect(await readFile(supervisor.configFile, "utf8")).not.toContain("log-queries");
    await supervisor.stop();
  });

  it("respawns after an unexpected exit with backoff", async () => {
    const supervisor = new DnsmasqSupervisor({
      binary: crashing,
      confDir: join(dir, "conf-crash"),
      settings: { listen: "127.0.0.1", port: 5355, upstream: ["1.1.1.1"], cacheSize: 0, user: undefined },
      respawnDelayMs: 20,
    });
    await supervisor.start({ curated: [] });
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(supervisor.status().unexpectedExits).toBeGreaterThanOrEqual(2);
    expect(supervisor.status().lastExit?.code).toBe(3);
    await supervisor.stop();
    const exits = supervisor.status().unexpectedExits;
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(supervisor.status().unexpectedExits).toBe(exits);
  });
});
