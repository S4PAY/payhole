import { describe, expect, it, vi } from "vitest";
import { BlocklistStore, exportBlocklist, exportDnsmasq, exportHostnames, exportHosts, exportJson, matchBlocked, normalizeDomain, pushToSinkhole, type BlockEntry } from "../lib/blocklist";
import { memoryStore } from "../lib/storage";

const entries: BlockEntry[] = [
  { domain: "tracker.example", reason: "tracker", flaggedAt: 1_700_000_000_000 },
  { domain: "drain.evil", reason: "drainer", flaggedAt: 1_700_000_100_000 },
];

describe("matching", () => {
  it("matches the hostname and its subdomains only", () => {
    expect(matchBlocked(entries, "tracker.example")?.reason).toBe("tracker");
    expect(matchBlocked(entries, "cdn.tracker.example")?.domain).toBe("tracker.example");
    expect(matchBlocked(entries, "TRACKER.example.")?.domain).toBe("tracker.example");
    expect(matchBlocked(entries, "nottracker.example")).toBeUndefined();
    expect(matchBlocked(entries, "example")).toBeUndefined();
    expect(matchBlocked(entries, "tracker.example.com")).toBeUndefined();
  });

  it("normalises domains from hosts and URLs", () => {
    expect(normalizeDomain(" Tracker.Example. ")).toBe("tracker.example");
    expect(normalizeDomain("https://Drain.Evil/path")).toBe("drain.evil");
    expect(() => normalizeDomain("")).toThrow();
    expect(() => normalizeDomain("not a host")).toThrow();
  });
});

describe("exports", () => {
  it("writes plain hostnames, dnsmasq, hosts, and JSON", () => {
    expect(exportHostnames(entries)).toBe("drain.evil\ntracker.example\n");
    expect(exportDnsmasq(entries)).toBe("address=/drain.evil/0.0.0.0\naddress=/tracker.example/0.0.0.0\n");
    expect(exportHosts(entries)).toBe("# PayHole blocklist\n0.0.0.0 drain.evil\n0.0.0.0 tracker.example\n");
    const json = exportJson(entries, 1_700_000_200_000);
    expect(json).toEqual({
      version: 1,
      updatedAt: "2023-11-14T22:16:40.000Z",
      entries: [entries[1], entries[0]],
    });
    expect(JSON.parse(exportBlocklist(entries, "json", 1_700_000_200_000))).toEqual(json);
    expect(exportBlocklist([], "hostnames", 0)).toBe("");
    expect(exportBlocklist([], "hosts", 0)).toBe("# PayHole blocklist\n");
  });
});

describe("sinkhole sync", () => {
  it("PUTs the JSON export with a bearer token", async () => {
    const fetchFn = vi.fn(() => Promise.resolve(new Response(null, { status: 204 })));
    const status = await pushToSinkhole({ url: "https://sinkhole.example/", token: "secret", entries, updatedAt: 1_700_000_200_000, fetchFn, now: () => 42 });
    expect(status).toEqual({ lastAttemptAt: 42, lastSuccessAt: 42, lastStatus: 204 });
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://sinkhole.example/api/blocklist");
    expect(init.method).toBe("PUT");
    expect(init.headers).toEqual({ "content-type": "application/json", authorization: "Bearer secret" });
    expect(JSON.parse(init.body as string)).toEqual(exportJson(entries, 1_700_000_200_000));
  });

  it("reports failures without throwing", async () => {
    const denied = await pushToSinkhole({ url: "https://sinkhole.example", token: "x", entries, updatedAt: 0, fetchFn: () => Promise.resolve(new Response("nope", { status: 401 })), now: () => 1 });
    expect(denied.lastError).toBe("HTTP 401: nope");
    expect(denied.lastSuccessAt).toBeUndefined();
    const down = await pushToSinkhole({ url: "https://sinkhole.example", token: "x", entries, updatedAt: 0, fetchFn: () => Promise.reject(new Error("ECONNREFUSED")), now: () => 1 });
    expect(down.lastError).toBe("ECONNREFUSED");
    const unset = await pushToSinkhole({ url: "  ", token: "x", entries, updatedAt: 0, fetchFn: vi.fn(), now: () => 1 });
    expect(unset.lastError).toBe("sync URL is not set");
  });
});

describe("BlocklistStore", () => {
  it("adds, dedupes, removes, and persists", async () => {
    const store = memoryStore();
    let now = 1_000;
    const list = new BlocklistStore(store, () => now);
    await list.load();
    await list.add("Tracker.example", "tracker");
    now = 2_000;
    await list.add("tracker.example", "scam");
    expect(list.list()).toEqual([{ domain: "tracker.example", reason: "scam", flaggedAt: 1_000 }]);
    expect(list.updatedAt()).toBe(2_000);
    expect(list.isBlocked("a.tracker.example")?.reason).toBe("scam");
    await expect(list.add("x", "bogus" as never)).rejects.toThrow(/reason/);
    const reloaded = new BlocklistStore(store, () => now);
    await reloaded.load();
    expect(reloaded.list()).toHaveLength(1);
    expect(await reloaded.remove("tracker.example")).toBe(true);
    expect(await reloaded.remove("tracker.example")).toBe(false);
    expect(reloaded.list()).toEqual([]);
    await reloaded.setSyncStatus({ lastError: "x" });
    expect(reloaded.syncStatus()).toEqual({ lastError: "x" });
  });
});
