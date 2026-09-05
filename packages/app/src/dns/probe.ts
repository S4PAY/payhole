import { buildQuery, isBlocked, parseMessage, rcodeName, RR_TYPE, toBase64Url } from "./wire";

export interface ProbeResult {
  ok: boolean;
  millis: number;
  rcode?: string;
  addresses?: string[];
  blocked?: boolean;
  error?: string;
}

/**
 * Sends one A query to a DNS-over-HTTPS endpoint with the RFC 8484 GET form and reports what
 * came back. Used by the Resolver screen to confirm a URL answers before it is saved.
 */
export async function probeDoh(
  url: string,
  name: string,
  fetchImpl: typeof fetch = fetch,
  now: () => number = Date.now,
): Promise<ProbeResult> {
  const started = now();
  try {
    const query = buildQuery(name, RR_TYPE.A);
    const separator = url.includes("?") ? "&" : "?";
    const response = await fetchImpl(`${url}${separator}dns=${toBase64Url(query)}`, {
      method: "GET",
      headers: { accept: "application/dns-message" },
    });
    if (!response.ok) {
      return { ok: false, millis: now() - started, error: `HTTP ${response.status}` };
    }
    const message = parseMessage(new Uint8Array(await response.arrayBuffer()));
    const addresses: string[] = [];
    for (const answer of message.answers) if (answer.address !== undefined) addresses.push(answer.address);
    return {
      ok: true,
      millis: now() - started,
      rcode: rcodeName(message.rcode),
      addresses,
      blocked: isBlocked(message),
    };
  } catch (error) {
    return {
      ok: false,
      millis: now() - started,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
