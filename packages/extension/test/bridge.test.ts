import { describe, expect, it, vi } from "vitest";
import { acceptsPageEvent, installBridge, PAGE_MESSAGE_402, PAGE_MESSAGE_REPLY, PAGE_MESSAGE_SETTLED, parseBridgeRequest, parsePageMessage, toBridgeRequest, validateBridgeSender } from "../lib/bridge";

const report = { type: PAGE_MESSAGE_402, id: "abc123", url: "https://api.example/paid", method: "post", status: 402, responseHeaders: { "payment-required": "eyJ9" }, bodyText: "{}" };

describe("page message validation", () => {
  it("accepts well-formed reports and normalises them", () => {
    expect(parsePageMessage(report)).toEqual({ ...report, method: "POST" });
    expect(parsePageMessage({ type: PAGE_MESSAGE_402, id: "x", url: "https://a/b", method: "GET", status: 402, responseHeaders: {} })).toEqual({
      type: PAGE_MESSAGE_402,
      id: "x",
      url: "https://a/b",
      method: "GET",
      status: 402,
      responseHeaders: {},
    });
    expect(parsePageMessage({ type: PAGE_MESSAGE_SETTLED, id: "x", url: "https://a/b", status: 200, responseHeaders: { "payment-response": "abc" } })).toEqual({
      type: PAGE_MESSAGE_SETTLED,
      id: "x",
      url: "https://a/b",
      status: 200,
      responseHeaders: { "payment-response": "abc" },
    });
  });

  it("rejects wrong shapes, ids, urls, and statuses", () => {
    expect(parsePageMessage(null)).toBeNull();
    expect(parsePageMessage("payhole:402")).toBeNull();
    expect(parsePageMessage({ ...report, type: "other" })).toBeNull();
    expect(parsePageMessage({ ...report, id: "has space" })).toBeNull();
    expect(parsePageMessage({ ...report, id: "x".repeat(65) })).toBeNull();
    expect(parsePageMessage({ ...report, url: "javascript:alert(1)" })).toBeNull();
    expect(parsePageMessage({ ...report, url: "file:///etc/passwd" })).toBeNull();
    expect(parsePageMessage({ ...report, status: 200 })).toBeNull();
    expect(parsePageMessage({ ...report, method: 5 })).toBeNull();
    const big = parsePageMessage({ ...report, bodyText: "x".repeat(100_000) });
    expect(big && "bodyText" in big ? big.bodyText?.length : 0).toBe(64 * 1024);
  });

  it("only accepts events from its own window and origin", () => {
    const win = {};
    expect(acceptsPageEvent({ source: win, origin: "https://app.example" }, { window: win, origin: "https://app.example" })).toBe(true);
    expect(acceptsPageEvent({ source: {}, origin: "https://app.example" }, { window: win, origin: "https://app.example" })).toBe(false);
    expect(acceptsPageEvent({ source: win, origin: "https://evil.example" }, { window: win, origin: "https://app.example" })).toBe(false);
  });
});

describe("bridge request validation", () => {
  it("converts reports and re-validates on the background side", () => {
    const request = toBridgeRequest(parsePageMessage(report)!);
    expect(request).toEqual({ kind: "payhole-bridge", type: "402", id: "abc123", url: report.url, method: "POST", status: 402, paymentRequiredHeader: "eyJ9", bodyText: "{}" });
    expect(parseBridgeRequest(request)).toEqual(request);
    expect(parseBridgeRequest({ ...request, kind: "other" })).toBeNull();
    expect(parseBridgeRequest({ ...request, status: 401 })).toBeNull();
    expect(parseBridgeRequest({ kind: "payhole-bridge", type: "settled", id: "a", url: "https://a/b", status: 200 })).toEqual({ kind: "payhole-bridge", type: "settled", id: "a", url: "https://a/b", status: 200 });
    expect(parseBridgeRequest({ kind: "payhole-bridge", type: "settled", id: "a", url: "https://a/b" })).toBeNull();
  });

  it("validates the sender: own extension, a tab, an http(s) origin", () => {
    const ok = validateBridgeSender({ id: "ext", tab: { id: 3 }, frameId: 0, origin: "https://App.example", url: "https://app.example/x" }, "ext");
    expect(ok).toEqual({ tabId: 3, frameId: 0, origin: "https://app.example" });
    expect(validateBridgeSender({ id: "other", tab: { id: 3 }, origin: "https://app.example" }, "ext")).toBeNull();
    expect(validateBridgeSender({ id: "ext", origin: "https://app.example" }, "ext")).toBeNull();
    expect(validateBridgeSender({ id: "ext", tab: { id: 3 }, origin: "null" }, "ext")).toBeNull();
    expect(validateBridgeSender({ id: "ext", tab: { id: 3 }, origin: "chrome-extension://ext" }, "ext")).toBeNull();
    expect(validateBridgeSender({ id: "ext", tab: { id: 3 }, url: "https://app.example/page" }, "ext")).toEqual({ tabId: 3, frameId: 0, origin: "https://app.example" });
    expect(validateBridgeSender({ id: "ext", tab: { id: 3 }, url: "not a url" }, "ext")).toBeNull();
  });
});

interface FakeWindow {
  location: { origin: string };
  listeners: ((event: MessageEvent) => void)[];
  posted: { message: unknown; target: string }[];
  addEventListener(type: string, listener: (event: MessageEvent) => void): void;
  removeEventListener(type: string, listener: (event: MessageEvent) => void): void;
  postMessage(message: unknown, target: string): void;
}

function fakeWindow(origin = "https://app.example"): FakeWindow {
  const win: FakeWindow = {
    location: { origin },
    listeners: [],
    posted: [],
    addEventListener: (_type, listener) => win.listeners.push(listener),
    removeEventListener: (_type, listener) => {
      win.listeners = win.listeners.filter((l) => l !== listener);
    },
    postMessage: (message, target) => win.posted.push({ message, target }),
  };
  return win;
}

describe("installBridge", () => {
  it("relays valid reports and posts the reply back to the page", async () => {
    const win = fakeWindow();
    const send = vi.fn(() => Promise.resolve({ kind: "pay", headerName: "payment-signature", headerValue: "sig" }));
    installBridge(win as unknown as Window, send);
    win.listeners[0]!({ source: win, origin: "https://app.example", data: report } as unknown as MessageEvent);
    await new Promise((r) => setTimeout(r, 0));
    expect(send).toHaveBeenCalledTimes(1);
    expect(win.posted).toEqual([{ message: { type: PAGE_MESSAGE_REPLY, id: "abc123", reply: { kind: "pay", headerName: "payment-signature", headerValue: "sig" } }, target: "https://app.example" }]);
  });

  it("ignores foreign sources, wrong origins, and junk; turns errors into refusals", async () => {
    const win = fakeWindow();
    const send = vi.fn(() => Promise.reject(new Error("locked")));
    const uninstall = installBridge(win as unknown as Window, send);
    const listener = win.listeners[0]!;
    listener({ source: {}, origin: "https://app.example", data: report } as unknown as MessageEvent);
    listener({ source: win, origin: "https://evil.example", data: report } as unknown as MessageEvent);
    listener({ source: win, origin: "https://app.example", data: { type: PAGE_MESSAGE_402 } } as unknown as MessageEvent);
    expect(send).not.toHaveBeenCalled();
    listener({ source: win, origin: "https://app.example", data: report } as unknown as MessageEvent);
    await new Promise((r) => setTimeout(r, 0));
    expect(win.posted[0]?.message).toEqual({ type: PAGE_MESSAGE_REPLY, id: "abc123", reply: { kind: "refused", reason: "locked" } });
    uninstall();
    expect(win.listeners).toHaveLength(0);
  });
});
