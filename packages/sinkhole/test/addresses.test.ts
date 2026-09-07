import { describe, expect, it, vi } from "vitest";
import { AddressList, normalizeAddress, parseAddressList } from "../src/addresses.js";
import { Blocklist } from "../src/blocklist.js";
import { Hints } from "../src/hints.js";
import { createReporter } from "../src/reports.js";

const NOW = 1_800_000_000_000;
const DAY = 24 * 60 * 60 * 1000;
const A = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const B = "0xBBBBbbbbBBBBbbbbBBBBbbbbBBBBbbbbBBBBbbbb";
const C = "0xcccccccccccccccccccccccccccccccccccccccc";

const answer = (status: number, body: string, etag: string | null = null) =>
  ({ status, ok: status < 400, headers: { get: (name: string) => (name === "etag" ? etag : null) }, text: () => Promise.resolve(body) }) as unknown as Response;

describe("bad addresses", () => {
  it("normalises and parses address lists in JSON or line form", () => {
    expect(normalizeAddress(` ${B} `)).toBe(B.toLowerCase());
    expect(normalizeAddress("0x123")).toBeNull();
    expect(normalizeAddress(42)).toBeNull();
    expect(parseAddressList(JSON.stringify([A, B, "nope", A]))).toEqual([A, B.toLowerCase()]);
    expect(parseAddressList(`# comment\n${A} drainer\n${C}\n`)).toEqual([A, C]);
    expect(parseAddressList("{}")).toEqual([]);
  });

  it("fetches the list with conditional headers, records arrivals, and answers lookups with the manual entries on top", async () => {
    let now = NOW;
    const fetchImpl = vi.fn<typeof fetch>();
    fetchImpl.mockResolvedValueOnce(answer(200, JSON.stringify([A, B]), '"v1"'));
    fetchImpl.mockResolvedValueOnce(answer(304, ""));
    fetchImpl.mockResolvedValueOnce(answer(200, JSON.stringify([A, C]), '"v2"'));
    const list = new AddressList({ url: "https://raw.githubusercontent.com/scamsniffer/scam-database/refs/heads/main/blacklist/address.json", refreshMs: DAY, fetch: fetchImpl, clock: () => now });
    expect(await list.refreshDue()).toBe(true);
    expect(list.size).toBe(2);
    expect(list.lookup(B)).toEqual({ address: B.toLowerCase(), flagged: true, category: "drainer", sources: ["list"], label: "ScamSniffer" });
    expect(list.lookup(C)).toMatchObject({ flagged: false, sources: [] });
    expect(list.lookup("hello")).toBeNull();
    expect(list.arrivalOf(A)).toEqual({ at: NOW, label: "ScamSniffer" });
    expect(await list.refreshDue()).toBe(false);
    now += DAY + 1;
    expect(await list.refreshDue()).toBe(true);
    expect(list.status()).toMatchObject({ lastStatus: 304, count: 2, etag: '"v1"' });
    const headers = (fetchImpl.mock.calls[1]?.[1] as { headers: Record<string, string> }).headers;
    expect(headers["if-none-match"]).toBe('"v1"');
    now += DAY + 1;
    expect(await list.refresh()).toEqual({ status: 200, added: 1, removed: 1 });
    expect(list.isFlagged(B)).toBe(false);
    expect(list.arrivalOf(C)?.at).toBe(now);
    expect(list.arrivalOf(A)?.at).toBe(NOW);

    expect(list.addManual(B, "phishing", "receives from the kit")).toEqual({ address: B.toLowerCase(), added: true });
    expect(list.lookup(B)).toMatchObject({ flagged: true, category: "phishing", sources: ["manual"], label: "receives from the kit" });
    expect(list.addManual(A, "infra")?.added).toBe(true);
    expect(list.lookup(A)?.sources).toEqual(["list", "manual"]);
    expect(list.export()).toBe(`${A}\n${B.toLowerCase()}\n${C}\n`);
    expect(list.removeManual(B)).toBe(true);
    expect(list.removeManual(B)).toBe(false);

    const restored = new AddressList({ url: list.status().url, refreshMs: DAY, fetch: fetchImpl, clock: () => now }, JSON.parse(JSON.stringify(list.toJSON())) as ReturnType<AddressList["toJSON"]>);
    expect(restored.entries()).toEqual(list.entries());
    expect(restored.arrivalOf(C)?.at).toBe(now);
    expect(restored.status()).toMatchObject({ etag: '"v2"', count: 2, manual: 1 });
    const other = new AddressList({ url: "https://other.example/list.json", refreshMs: DAY, fetch: fetchImpl, clock: () => now }, JSON.parse(JSON.stringify(list.toJSON())) as ReturnType<AddressList["toJSON"]>);
    expect(other.size).toBe(1);
  });

  it("keeps working when the list cannot be fetched", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockRejectedValue(new Error("offline"));
    const list = new AddressList({ url: "https://lists.example/addresses.json", refreshMs: DAY, fetch: fetchImpl, clock: () => NOW });
    expect(await list.refresh()).toEqual({ status: "error", added: 0, removed: 0 });
    expect(list.status()).toMatchObject({ lastStatus: "error", lastError: "offline" });
    expect(list.lookup(A)?.flagged).toBe(false);
    const off = new AddressList({ url: null, refreshMs: DAY, clock: () => NOW });
    expect(await off.refreshDue()).toBe(false);
    expect(off.addManual(A, "drainer")?.added).toBe(true);
    expect(off.lookup(A)).toMatchObject({ flagged: true, label: null });
  });

  it("takes an address as a report: a hint with the address as its key, already_blocked when listed", async () => {
    const list = new AddressList({ url: null, refreshMs: DAY, clock: () => NOW });
    list.addManual(A, "drainer", "kit");
    const blocklist = new Blocklist({ threshold: 5, ttlMs: 30 * DAY, clock: () => NOW });
    const hints = new Hints({ clock: () => NOW });
    const report = createReporter({ blocklist, hints, addresses: list, acceptDelegates: false, clock: () => NOW });
    expect(await report({ address: A, category: "drainer" })).toEqual({ status: "already_blocked", domain: A });
    expect(await report({ address: B, category: "phishing", reason: "receives from the kit" })).toEqual({ status: "hinted", domain: B.toLowerCase(), hints: 1 });
    expect(hints.get(B.toLowerCase())).toMatchObject({ categories: { phishing: 1 }, reasons: ["receives from the kit"] });
    expect(await report({ address: "0x12" })).toEqual({ status: "invalid", detail: "address is not an EVM address" });
    expect(await report({ name: "kit.example", category: "drainer" })).toEqual({ status: "hinted", domain: "kit.example", hints: 1 });
  });
});
