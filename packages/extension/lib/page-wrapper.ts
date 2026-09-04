/**
 * Page-world wrappers for `fetch` and `XMLHttpRequest`. They run inside the page with no extension APIs: a 402 is
 * reported to the bridge through `window.postMessage`, the reply carries a signed payment header, and the request
 * is retried once with that header. The page sees a single request whose response is the retried one.
 */
import { isPageReply, PAGE_MESSAGE_402, PAGE_MESSAGE_REPLY, PAGE_MESSAGE_SETTLED, type PageReply, type PageReport402, type PageReportSettled } from "./bridge";

export const REPLY_TIMEOUT_MS = 180_000;
const PAYMENT_HEADERS = ["payment-signature", "x-payment"];
const XHR_EVENTS = ["readystatechange", "loadstart", "progress", "abort", "error", "load", "timeout", "loadend"] as const;
type XhrEventType = (typeof XHR_EVENTS)[number];

declare global {
  interface Window {
    __payholeInstalled?: boolean;
  }
}

function randomId(): string {
  const bytes = new Uint8Array(12);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

interface Channel {
  ask(report: Omit<PageReport402, "type" | "id">): Promise<PageReply>;
  settled(report: Omit<PageReportSettled, "type" | "id">): void;
}

function createChannel(win: Window): Channel {
  const pending = new Map<string, (reply: PageReply) => void>();
  win.addEventListener("message", (event: MessageEvent) => {
    if (event.source !== win) return;
    const data: unknown = event.data;
    if (!isRecord(data) || data["type"] !== PAGE_MESSAGE_REPLY || typeof data["id"] !== "string") return;
    const resolve = pending.get(data["id"]);
    if (!resolve) return;
    pending.delete(data["id"]);
    resolve(isPageReply(data["reply"]) ? data["reply"] : { kind: "refused", reason: "malformed reply" });
  });
  const target = win.location.origin === "null" ? "*" : win.location.origin;
  return {
    ask(report) {
      const id = randomId();
      return new Promise<PageReply>((resolve) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          resolve({ kind: "refused", reason: "timed out waiting for the extension" });
        }, REPLY_TIMEOUT_MS);
        pending.set(id, (reply) => {
          clearTimeout(timer);
          resolve(reply);
        });
        const message: PageReport402 = { type: PAGE_MESSAGE_402, id, ...report };
        win.postMessage(message, target);
      });
    },
    settled(report) {
      const message: PageReportSettled = { type: PAGE_MESSAGE_SETTLED, id: randomId(), ...report };
      win.postMessage(message, target);
    },
  };
}

function hasPaymentHeader(names: Iterable<string>): boolean {
  for (const name of names) if (PAYMENT_HEADERS.includes(name.toLowerCase())) return true;
  return false;
}

async function responseBodyText(response: Response): Promise<string | undefined> {
  try {
    return (await response.clone().text()).slice(0, 64 * 1024);
  } catch {
    return undefined;
  }
}

export function wrapFetch(win: Window, channel: Channel, originalFetch: typeof fetch): typeof fetch {
  return async function payholeFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    let request: Request;
    try {
      request = new Request(input, init);
    } catch {
      return originalFetch(input, init);
    }
    if (request.mode === "no-cors" || hasPaymentHeader(request.headers.keys())) return originalFetch(request);
    let body: ArrayBuffer | null = null;
    if (request.body !== null) {
      try {
        body = await request.clone().arrayBuffer();
      } catch {
        return originalFetch(request);
      }
    }
    const response = await originalFetch(request);
    if (response.status !== 402) return response;

    const url = response.url || request.url;
    const bodyText = await responseBodyText(response);
    const paymentRequired = response.headers.get("payment-required");
    const reply = await channel.ask({
      url,
      method: request.method,
      status: 402,
      responseHeaders: paymentRequired === null ? {} : { "payment-required": paymentRequired },
      ...(bodyText === undefined ? {} : { bodyText }),
    });
    if (reply.kind !== "pay") return response;

    const headers = new Headers(request.headers);
    headers.set(reply.headerName, reply.headerValue);
    const retryInit: RequestInit = {
      method: request.method,
      headers,
      body,
      credentials: request.credentials,
      cache: request.cache,
      mode: request.mode,
      redirect: request.redirect,
      referrer: request.referrer,
      referrerPolicy: request.referrerPolicy,
      integrity: request.integrity,
      keepalive: request.keepalive,
      signal: request.signal,
    };
    try {
      const second = await originalFetch(new Request(request.url, retryInit));
      const settlement = second.headers.get("payment-response") ?? second.headers.get("x-payment-response");
      channel.settled({ url, status: second.status, responseHeaders: settlement === null ? {} : { "payment-response": settlement } });
      return second;
    } catch (error) {
      channel.settled({ url, status: 0, responseHeaders: {}, error: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  };
}

async function xhrBodyText(xhr: XMLHttpRequest): Promise<string | undefined> {
  try {
    switch (xhr.responseType) {
      case "":
      case "text":
        return xhr.responseText.slice(0, 64 * 1024);
      case "json":
        return xhr.response === null ? undefined : JSON.stringify(xhr.response);
      case "arraybuffer":
        return xhr.response instanceof ArrayBuffer ? new TextDecoder().decode(xhr.response).slice(0, 64 * 1024) : undefined;
      case "blob":
        return xhr.response instanceof Blob ? (await xhr.response.text()).slice(0, 64 * 1024) : undefined;
      case "document":
        return undefined;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

interface OpenSpec {
  method: string;
  url: string;
  async: boolean;
  user: string | null | undefined;
  password: string | null | undefined;
}

type Handler = ((this: unknown, event: Event) => unknown) | null;

/**
 * Facade over a real XMLHttpRequest. Events and state of the inner request are mirrored to the page until a 402
 * arrives; the facade then holds the page at OPENED, asks for a payment, and replays either the retried request
 * or the original 402.
 */
export function createXhrClass(win: Window, channel: Channel, Original: typeof XMLHttpRequest): typeof XMLHttpRequest {
  class PayholeXMLHttpRequest extends EventTarget {
    static readonly UNSENT = 0;
    static readonly OPENED = 1;
    static readonly HEADERS_RECEIVED = 2;
    static readonly LOADING = 3;
    static readonly DONE = 4;
    readonly UNSENT = 0;
    readonly OPENED = 1;
    readonly HEADERS_RECEIVED = 2;
    readonly LOADING = 3;
    readonly DONE = 4;

    private inner: XMLHttpRequest;
    private spec: OpenSpec | null = null;
    private requestHeaders: [string, string][] = [];
    private body: Document | XMLHttpRequestBodyInit | null | undefined = null;
    private mimeType: string | null = null;
    private forwarding = true;
    private paying = false;
    private payable = false;
    private aborted = false;
    private readonly handlers: Partial<Record<XhrEventType, Handler>> = {};

    constructor() {
      super();
      this.inner = this.createInner();
      for (const type of XHR_EVENTS) {
        this.addEventListener(type, (event) => {
          const handler = this.handlers[type];
          if (typeof handler === "function") handler.call(this, event);
        });
      }
    }

    private createInner(): XMLHttpRequest {
      const xhr = new Original();
      for (const type of XHR_EVENTS) xhr.addEventListener(type, (event) => this.onInnerEvent(xhr, type, event));
      return xhr;
    }

    private onInnerEvent(source: XMLHttpRequest, type: XhrEventType, event: Event): void {
      if (source !== this.inner) return;
      if (this.paying) {
        if (type === "readystatechange" && source.readyState === 4) void this.handle402(source);
        return;
      }
      if (!this.forwarding) return;
      if (type === "readystatechange" && source.readyState === 2 && source.status === 402 && this.payable) {
        this.paying = true;
        this.forwarding = false;
        return;
      }
      this.forward(type, event);
    }

    private forward(type: XhrEventType, event: Event): void {
      if (type === "readystatechange") {
        this.dispatchEvent(new Event("readystatechange"));
        return;
      }
      const progress = event as ProgressEvent;
      this.dispatchEvent(new ProgressEvent(type, { lengthComputable: progress.lengthComputable, loaded: progress.loaded, total: progress.total }));
    }

    private async handle402(first: XMLHttpRequest): Promise<void> {
      const spec = this.spec;
      if (!spec) return;
      const bodyText = await xhrBodyText(first);
      const header = first.getResponseHeader("payment-required");
      const url = first.responseURL || spec.url;
      const reply = await channel.ask({
        url,
        method: spec.method,
        status: 402,
        responseHeaders: header === null ? {} : { "payment-required": header },
        ...(bodyText === undefined ? {} : { bodyText }),
      });
      if (this.aborted || this.inner !== first) return;
      if (reply.kind !== "pay") {
        this.replay();
        return;
      }
      const second = this.createInner();
      this.inner = second;
      this.paying = false;
      this.forwarding = false; // the page already saw OPENED; skip the second open's readystatechange
      this.payable = false;
      try {
        second.open(spec.method, spec.url, true, spec.user, spec.password);
        second.timeout = first.timeout;
        second.withCredentials = first.withCredentials;
        second.responseType = first.responseType;
        if (this.mimeType !== null) second.overrideMimeType(this.mimeType);
        for (const [name, value] of this.requestHeaders) second.setRequestHeader(name, value);
        second.setRequestHeader(reply.headerName, reply.headerValue);
        second.addEventListener("loadend", () => {
          const settlement = second.getResponseHeader("payment-response") ?? second.getResponseHeader("x-payment-response");
          channel.settled({ url, status: second.status, responseHeaders: settlement === null ? {} : { "payment-response": settlement } });
        });
        this.forwarding = true;
        second.send(this.body);
      } catch {
        this.inner = first;
        this.forwarding = true;
        this.replay();
      }
    }

    /** Hands the original 402 to the page as if nothing had happened. */
    private replay(): void {
      this.paying = false;
      this.forwarding = true;
      this.dispatchEvent(new Event("readystatechange"));
      this.dispatchEvent(new Event("readystatechange"));
      this.dispatchEvent(new Event("readystatechange"));
      this.dispatchEvent(new ProgressEvent("load"));
      this.dispatchEvent(new ProgressEvent("loadend"));
    }

    open(method: string, url: string | URL, async = true, user?: string | null, password?: string | null): void {
      if (this.inner.readyState !== 0) this.inner = this.createInner();
      this.spec = { method: String(method).toUpperCase(), url: String(url), async, user, password };
      this.requestHeaders = [];
      this.forwarding = true;
      this.paying = false;
      this.payable = false;
      this.aborted = false;
      this.inner.open(this.spec.method, this.spec.url, async, user, password);
    }

    setRequestHeader(name: string, value: string): void {
      this.requestHeaders.push([name, value]);
      this.inner.setRequestHeader(name, value);
    }

    send(body?: Document | XMLHttpRequestBodyInit | null): void {
      this.body = body;
      this.payable = this.spec?.async === true && !hasPaymentHeader(this.requestHeaders.map(([name]) => name));
      this.inner.send(body);
    }

    abort(): void {
      this.aborted = true;
      const wasPaying = this.paying;
      this.paying = false;
      this.forwarding = true;
      this.inner.abort();
      if (wasPaying) {
        this.dispatchEvent(new Event("readystatechange"));
        this.dispatchEvent(new ProgressEvent("abort"));
        this.dispatchEvent(new ProgressEvent("loadend"));
      }
    }

    overrideMimeType(mime: string): void {
      this.mimeType = mime;
      this.inner.overrideMimeType(mime);
    }

    getResponseHeader(name: string): string | null {
      return this.paying ? null : this.inner.getResponseHeader(name);
    }

    getAllResponseHeaders(): string {
      return this.paying ? "" : this.inner.getAllResponseHeaders();
    }

    get readyState(): number {
      return this.paying ? 1 : this.inner.readyState;
    }
    get status(): number {
      return this.paying ? 0 : this.inner.status;
    }
    get statusText(): string {
      return this.paying ? "" : this.inner.statusText;
    }
    get response(): unknown {
      if (!this.paying) return this.inner.response as unknown;
      return this.inner.responseType === "" || this.inner.responseType === "text" ? "" : null;
    }
    get responseText(): string {
      return this.paying ? "" : this.inner.responseText;
    }
    get responseXML(): Document | null {
      return this.paying ? null : this.inner.responseXML;
    }
    get responseURL(): string {
      return this.paying ? "" : this.inner.responseURL;
    }
    get responseType(): XMLHttpRequestResponseType {
      return this.inner.responseType;
    }
    set responseType(value: XMLHttpRequestResponseType) {
      this.inner.responseType = value;
    }
    get timeout(): number {
      return this.inner.timeout;
    }
    set timeout(value: number) {
      this.inner.timeout = value;
    }
    get withCredentials(): boolean {
      return this.inner.withCredentials;
    }
    set withCredentials(value: boolean) {
      this.inner.withCredentials = value;
    }
    get upload(): XMLHttpRequestUpload {
      return this.inner.upload;
    }
  }

  for (const type of XHR_EVENTS) {
    Object.defineProperty(PayholeXMLHttpRequest.prototype, `on${type}`, {
      configurable: true,
      enumerable: true,
      get(this: PayholeXMLHttpRequest) {
        return (this as unknown as { handlers: Partial<Record<XhrEventType, Handler>> }).handlers[type] ?? null;
      },
      set(this: PayholeXMLHttpRequest, value: Handler) {
        (this as unknown as { handlers: Partial<Record<XhrEventType, Handler>> }).handlers[type] = typeof value === "function" ? value : null;
      },
    });
  }
  Object.defineProperty(PayholeXMLHttpRequest, "name", { value: "XMLHttpRequest" });
  void win;
  return PayholeXMLHttpRequest as unknown as typeof XMLHttpRequest;
}

/** Installs both wrappers once per window. Safe to call on every document. */
export function installPageWrappers(win: Window & typeof globalThis): void {
  if (win.__payholeInstalled) return;
  win.__payholeInstalled = true;
  const channel = createChannel(win);
  const originalFetch = win.fetch.bind(win);
  win.fetch = wrapFetch(win, channel, originalFetch);
  win.XMLHttpRequest = createXhrClass(win, channel, win.XMLHttpRequest);
}
