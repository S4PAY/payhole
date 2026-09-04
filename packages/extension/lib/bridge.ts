/**
 * Messages between the page world (fetch and XHR wrappers), the isolated content script (bridge), and the
 * background. Everything crossing a boundary is validated structurally; amounts and keys never travel here.
 */

export const PAGE_MESSAGE_402 = "payhole:402";
export const PAGE_MESSAGE_REPLY = "payhole:402:reply";
export const PAGE_MESSAGE_SETTLED = "payhole:settled";
export const BRIDGE_KIND = "payhole-bridge";
export const MAX_BODY_TEXT = 64 * 1024;
export const MAX_ID_LENGTH = 64;

/** The page world reports a 402 it received for a fetch or XHR. */
export interface PageReport402 {
  type: typeof PAGE_MESSAGE_402;
  id: string;
  url: string;
  method: string;
  status: number;
  requestHeaders?: Record<string, string>;
  responseHeaders: { "payment-required"?: string };
  bodyText?: string;
}

/** The page world reports what the retried request returned. */
export interface PageReportSettled {
  type: typeof PAGE_MESSAGE_SETTLED;
  id: string;
  url: string;
  status: number;
  responseHeaders: { "payment-response"?: string };
  error?: string;
}

export type PageReply = { kind: "pay"; headerName: string; headerValue: string } | { kind: "refused"; reason: string };

export interface PageReplyMessage {
  type: typeof PAGE_MESSAGE_REPLY;
  id: string;
  reply: PageReply;
}

export interface BridgeRequest402 {
  kind: typeof BRIDGE_KIND;
  type: "402";
  id: string;
  url: string;
  method: string;
  status: number;
  paymentRequiredHeader?: string;
  bodyText?: string;
}

export interface BridgeRequestSettled {
  kind: typeof BRIDGE_KIND;
  type: "settled";
  id: string;
  url: string;
  status: number;
  paymentResponseHeader?: string;
  error?: string;
}

export type BridgeRequest = BridgeRequest402 | BridgeRequestSettled;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isHttpUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > 8192) return false;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function isId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= MAX_ID_LENGTH && /^[A-Za-z0-9_-]+$/.test(value);
}

function optionalHeader(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 && value.length <= 16_384 ? value : undefined;
}

/** Validates a message posted by the page world. Returns null for anything that is not one of ours. */
export function parsePageMessage(data: unknown): PageReport402 | PageReportSettled | null {
  if (!isRecord(data) || typeof data["type"] !== "string") return null;
  if (!isId(data["id"]) || !isHttpUrl(data["url"])) return null;
  const responseHeaders = isRecord(data["responseHeaders"]) ? data["responseHeaders"] : {};
  if (data["type"] === PAGE_MESSAGE_402) {
    if (typeof data["method"] !== "string" || data["status"] !== 402) return null;
    const bodyText = typeof data["bodyText"] === "string" ? data["bodyText"].slice(0, MAX_BODY_TEXT) : undefined;
    const paymentRequired = optionalHeader(responseHeaders["payment-required"]);
    return {
      type: PAGE_MESSAGE_402,
      id: data["id"],
      url: data["url"],
      method: data["method"].toUpperCase().slice(0, 16),
      status: 402,
      responseHeaders: paymentRequired === undefined ? {} : { "payment-required": paymentRequired },
      ...(bodyText === undefined ? {} : { bodyText }),
    };
  }
  if (data["type"] === PAGE_MESSAGE_SETTLED) {
    if (typeof data["status"] !== "number") return null;
    const paymentResponse = optionalHeader(responseHeaders["payment-response"]);
    const error = typeof data["error"] === "string" ? data["error"].slice(0, 500) : undefined;
    return {
      type: PAGE_MESSAGE_SETTLED,
      id: data["id"],
      url: data["url"],
      status: data["status"],
      responseHeaders: paymentResponse === undefined ? {} : { "payment-response": paymentResponse },
      ...(error === undefined ? {} : { error }),
    };
  }
  return null;
}

/** The bridge only relays messages posted by its own window from the page's own origin. */
export function acceptsPageEvent(event: { source: unknown; origin: string }, self: { window: unknown; origin: string }): boolean {
  return event.source === self.window && event.origin === self.origin;
}

export function toBridgeRequest(report: PageReport402 | PageReportSettled): BridgeRequest {
  if (report.type === PAGE_MESSAGE_402) {
    const header = report.responseHeaders["payment-required"];
    return {
      kind: BRIDGE_KIND,
      type: "402",
      id: report.id,
      url: report.url,
      method: report.method,
      status: report.status,
      ...(header === undefined ? {} : { paymentRequiredHeader: header }),
      ...(report.bodyText === undefined ? {} : { bodyText: report.bodyText }),
    };
  }
  const header = report.responseHeaders["payment-response"];
  return {
    kind: BRIDGE_KIND,
    type: "settled",
    id: report.id,
    url: report.url,
    status: report.status,
    ...(header === undefined ? {} : { paymentResponseHeader: header }),
    ...(report.error === undefined ? {} : { error: report.error }),
  };
}

/** Validates a runtime message from the bridge; the background never trusts its shape. */
export function parseBridgeRequest(data: unknown): BridgeRequest | null {
  if (!isRecord(data) || data["kind"] !== BRIDGE_KIND) return null;
  if (!isId(data["id"]) || !isHttpUrl(data["url"])) return null;
  if (data["type"] === "402") {
    if (data["status"] !== 402 || typeof data["method"] !== "string") return null;
    const header = optionalHeader(data["paymentRequiredHeader"]);
    const bodyText = typeof data["bodyText"] === "string" ? data["bodyText"].slice(0, MAX_BODY_TEXT) : undefined;
    return {
      kind: BRIDGE_KIND,
      type: "402",
      id: data["id"],
      url: data["url"],
      method: data["method"],
      status: 402,
      ...(header === undefined ? {} : { paymentRequiredHeader: header }),
      ...(bodyText === undefined ? {} : { bodyText }),
    };
  }
  if (data["type"] === "settled") {
    if (typeof data["status"] !== "number") return null;
    const header = optionalHeader(data["paymentResponseHeader"]);
    const error = typeof data["error"] === "string" ? data["error"].slice(0, 500) : undefined;
    return {
      kind: BRIDGE_KIND,
      type: "settled",
      id: data["id"],
      url: data["url"],
      status: data["status"],
      ...(header === undefined ? {} : { paymentResponseHeader: header }),
      ...(error === undefined ? {} : { error }),
    };
  }
  return null;
}

export interface SenderLike {
  id?: string | undefined;
  tab?: { id?: number | undefined } | undefined;
  frameId?: number | undefined;
  url?: string | undefined;
  origin?: string | undefined;
}

export interface BridgeSender {
  tabId: number;
  frameId: number;
  /** Origin of the document that made the request; the origin that is charged. */
  origin: string;
}

/** Accepts only messages from this extension's own content scripts running in a real http(s) tab. */
export function validateBridgeSender(sender: SenderLike, extensionId: string): BridgeSender | null {
  if (sender.id !== extensionId) return null;
  const tabId = sender.tab?.id;
  if (typeof tabId !== "number" || tabId < 0) return null;
  let origin = sender.origin;
  if (origin === undefined && sender.url !== undefined) {
    try {
      origin = new URL(sender.url).origin;
    } catch {
      return null;
    }
  }
  if (origin === undefined || origin === "null") return null;
  if (!/^https?:\/\//.test(origin)) return null;
  return { tabId, frameId: sender.frameId ?? 0, origin: origin.toLowerCase() };
}

export function isPageReply(value: unknown): value is PageReply {
  if (!isRecord(value)) return false;
  if (value["kind"] === "pay") return typeof value["headerName"] === "string" && typeof value["headerValue"] === "string";
  if (value["kind"] === "refused") return typeof value["reason"] === "string";
  return false;
}

/**
 * Runs in the isolated world: relays validated page messages to the background and posts the reply back. The
 * `send` function is `browser.runtime.sendMessage`; it is injected so the relay can be unit tested.
 */
export function installBridge(win: Window, send: (request: BridgeRequest) => Promise<unknown>): () => void {
  const selfOrigin = win.location.origin;
  const listener = (event: MessageEvent): void => {
    if (!acceptsPageEvent(event, { window: win, origin: selfOrigin })) return;
    const report = parsePageMessage(event.data);
    if (!report) return;
    const request = toBridgeRequest(report);
    if (request.type === "settled") {
      void send(request).catch(() => undefined);
      return;
    }
    void send(request)
      .then((reply) => (isPageReply(reply) ? reply : { kind: "refused" as const, reason: "no reply from the extension" }))
      .catch((error: unknown) => ({ kind: "refused" as const, reason: error instanceof Error ? error.message : String(error) }))
      .then((reply) => {
        const message: PageReplyMessage = { type: PAGE_MESSAGE_REPLY, id: report.id, reply };
        win.postMessage(message, selfOrigin === "null" ? "*" : selfOrigin);
      });
  };
  win.addEventListener("message", listener);
  return () => win.removeEventListener("message", listener);
}
