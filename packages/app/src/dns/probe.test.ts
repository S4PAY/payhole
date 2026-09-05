import { describe, expect, it } from "vitest";

import { probeDoh } from "./probe";
import { parseMessage } from "./wire";

function urlOf(input: string | URL | Request): string {
  if (typeof input === "string") return input;
  return input instanceof URL ? input.href : input.url;
}

function fakeFetch(handler: (url: string) => Response): typeof fetch {
  return (input) => Promise.resolve(handler(urlOf(input)));
}

function answerFor(url: string, address: number[]): Response {
  const encoded = new URL(url).searchParams.get("dns") ?? "";
  const padded = encoded.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(encoded.length / 4) * 4, "=");
  const query = Uint8Array.from(Buffer.from(padded, "base64"));
  const answer = [0xc0, 0x0c, 0, 1, 0, 1, 0, 0, 0, 60, 0, 4, ...address];
  const body = new Uint8Array(query.length + answer.length);
  body.set(query);
  body.set(answer, query.length);
  body[2] = 0x81;
  body[3] = 0x80;
  body[7] = 1;
  return new Response(body, { status: 200, headers: { "content-type": "application/dns-message" } });
}

describe("probeDoh", () => {
  it("sends the RFC 8484 GET form and reads the answer", async () => {
    let seen = "";
    const result = await probeDoh(
      "https://dns.payhole.org/dns-query",
      "payhole.org",
      fakeFetch((url) => {
        seen = url;
        return answerFor(url, [69, 48, 228, 170]);
      }),
      () => 0,
    );
    expect(seen.startsWith("https://dns.payhole.org/dns-query?dns=")).toBe(true);
    expect(result).toEqual({ ok: true, millis: 0, rcode: "NOERROR", addresses: ["69.48.228.170"], blocked: false });
    const sent = new URL(seen).searchParams.get("dns") ?? "";
    expect(sent).not.toContain("=");
    expect(parseMessage(Uint8Array.from(Buffer.from(sent, "base64url"))).questions[0]?.name).toBe("payhole.org");
  });

  it("reports a blocked answer", async () => {
    const result = await probeDoh("https://dns.payhole.org/dns-query", "drainer.example", fakeFetch((url) => answerFor(url, [0, 0, 0, 0])), () => 0);
    expect(result.ok).toBe(true);
    expect(result.blocked).toBe(true);
  });

  it("turns HTTP and network failures into a result instead of throwing", async () => {
    const http = await probeDoh("https://example.org/dns-query?x=1", "payhole.org", fakeFetch(() => new Response("nope", { status: 503 })), () => 0);
    expect(http).toEqual({ ok: false, millis: 0, error: "HTTP 503" });

    const network = await probeDoh(
      "https://example.org/dns-query",
      "payhole.org",
      () => Promise.reject(new Error("Network request failed")),
      () => 0,
    );
    expect(network.ok).toBe(false);
    expect(network.error).toBe("Network request failed");
  });
});
