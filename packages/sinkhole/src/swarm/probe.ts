import { lookup } from "node:dns/promises";
import { request as httpRequest, type IncomingHttpHeaders } from "node:http";
import { request as httpsRequest } from "node:https";
import { BlockList, isIP, isIPv4, isIPv6, type LookupFunction } from "node:net";
import { getAddress, isAddress } from "viem";
import { chainConfig, chainIdFromNetwork, parsePaymentRequired, selectOffer, type AnyPaymentRequired } from "@payhole/sdk";

export interface EndpointAnnouncement {
  url: string;
  network: string;
  asset: string;
  payTo: string;
}

export interface ProbeResponse {
  status: number;
  headers: IncomingHttpHeaders;
  body: string;
}

/** Performs the HTTP request against an already vetted address; injectable for tests. */
export type ProbeRequest = (url: URL, address: string, timeoutMs: number, maxBodyBytes: number) => Promise<ProbeResponse>;

export interface ProbeOptions {
  timeoutMs?: number;
  maxBodyBytes?: number;
  /** Test and private-swarm switch: permit loopback and private destinations. Off by default. */
  allowPrivate?: boolean;
  resolve?: (hostname: string) => Promise<string[]>;
  request?: ProbeRequest;
}

export type ProbeFailure =
  | "invalid_url"
  | "forbidden_address"
  | "resolve_failed"
  | "timeout"
  | "network_error"
  | "not_402"
  | "no_payment_required"
  | "no_matching_offer";

export interface VerifiedOffer {
  network: string;
  asset: string;
  payTo: string;
  amount: string | null;
  scheme: string;
}

export type ProbeResult = { ok: true; offer: VerifiedOffer } | { ok: false; reason: ProbeFailure; detail: string };

export class ProbeTimeoutError extends Error {
  override name = "ProbeTimeoutError";
}

const forbidden = new BlockList();
const V4_RANGES: [string, number][] = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
];
const V6_RANGES: [string, number][] = [
  ["::", 128],
  ["::1", 128],
  ["64:ff9b::", 96],
  ["2001:db8::", 32],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
];
for (const [net, prefix] of V4_RANGES) forbidden.addSubnet(net, prefix, "ipv4");
for (const [net, prefix] of V6_RANGES) forbidden.addSubnet(net, prefix, "ipv6");

/** IPv4 embedded in an IPv4-mapped IPv6 address (`::ffff:a.b.c.d` or `::ffff:xxxx:xxxx`), if any. */
function mappedV4(ip: string): string | null {
  const dotted = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(ip);
  if (dotted?.[1]) return dotted[1];
  const hex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(ip);
  if (hex?.[1] && hex[2]) {
    const hi = parseInt(hex[1], 16);
    const lo = parseInt(hex[2], 16);
    return `${hi >> 8}.${hi & 0xff}.${lo >> 8}.${lo & 0xff}`;
  }
  return null;
}

/** True for loopback, private, link-local, CGNAT, multicast, documentation and metadata ranges. */
export function isForbiddenAddress(ip: string): boolean {
  try {
    if (isIPv4(ip)) return forbidden.check(ip, "ipv4");
    if (isIPv6(ip)) {
      if (ip.includes("%")) return true;
      const inner = mappedV4(ip);
      if (inner) return isForbiddenAddress(inner);
      return forbidden.check(ip, "ipv6");
    }
  } catch {
    return true;
  }
  return true;
}

async function defaultResolve(hostname: string): Promise<string[]> {
  const results = await lookup(hostname, { all: true });
  return results.map((r) => r.address);
}

/** Plain `node:http(s)` GET pinned to the vetted address so a DNS rebind cannot redirect the probe. */
export const httpProbe: ProbeRequest = (url, address, timeoutMs, maxBodyBytes) =>
  new Promise((resolve, reject) => {
    const family = isIPv6(address) ? 6 : 4;
    const pinned: LookupFunction = (_hostname, options, callback) => {
      if (options.all) callback(null, [{ address, family }]);
      else callback(null, address, family);
    };
    const requestFn = url.protocol === "https:" ? httpsRequest : httpRequest;
    let settled = false;
    const finish = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };
    const req = requestFn(
      url,
      {
        method: "GET",
        lookup: pinned,
        agent: false,
        headers: { accept: "application/json, */*", "user-agent": "payhole-sinkhole-probe/1", connection: "close" },
        timeout: timeoutMs,
      },
      (res) => {
        const chunks: Buffer[] = [];
        let size = 0;
        res.on("data", (chunk: Buffer) => {
          if (size >= maxBodyBytes) return;
          size += chunk.length;
          chunks.push(chunk.subarray(0, Math.max(0, maxBodyBytes - (size - chunk.length))));
        });
        res.on("end", () => finish(() => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks).toString("utf8") })));
        res.on("error", (error) => finish(() => reject(error)));
      },
    );
    const timer = setTimeout(() => req.destroy(new ProbeTimeoutError(`no response within ${timeoutMs} ms`)), timeoutMs);
    req.on("timeout", () => req.destroy(new ProbeTimeoutError(`socket idle for ${timeoutMs} ms`)));
    req.on("error", (error) => finish(() => reject(error)));
    req.end();
  });

function fail(reason: ProbeFailure, detail: string): ProbeResult {
  return { ok: false, reason, detail };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isTimeout(error: unknown): boolean {
  if (error instanceof ProbeTimeoutError) return true;
  const code = (error as { code?: unknown }).code;
  return code === "ETIMEDOUT" || code === "UND_ERR_CONNECT_TIMEOUT";
}

function headerValue(headers: IncomingHttpHeaders, name: string): string | undefined {
  const value = headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

function sameNetwork(a: string, b: string): boolean {
  if (a.toLowerCase() === b.toLowerCase()) return true;
  const chainA = chainIdFromNetwork(a);
  return chainA !== null && chainA === chainIdFromNetwork(b);
}

interface AcceptsEntry {
  scheme: string;
  network: string;
  asset: string;
  payTo: string;
  amount?: string;
  maxAmountRequired?: string;
}

/**
 * Matches the 402's `accepts` against the announcement. On Robinhood Chain the offer must also be one
 * PayHole can pay (`selectOffer`: exact scheme, USDG, plain EIP-3009); elsewhere network, asset and
 * payTo have to agree.
 */
export function matchOffer(required: AnyPaymentRequired, entry: EndpointAnnouncement): ProbeResult {
  if (!isAddress(entry.payTo) || !isAddress(entry.asset)) return fail("no_matching_offer", "announced asset or payTo is not an address");
  const payTo = getAddress(entry.payTo);
  const asset = getAddress(entry.asset);
  const accepts = required.accepts as AcceptsEntry[];
  const candidates = accepts.filter(
    (a) => sameNetwork(a.network, entry.network) && isAddress(a.asset) && getAddress(a.asset) === asset && isAddress(a.payTo) && getAddress(a.payTo) === payTo,
  );
  const first = candidates[0];
  if (!first) return fail("no_matching_offer", "no accepts entry matches the announced network, asset and payTo");
  if (chainIdFromNetwork(entry.network) === chainConfig.chainId) {
    if (asset !== getAddress(chainConfig.usdg)) return fail("no_matching_offer", "asset on Robinhood Chain must be USDG");
    try {
      const offer = selectOffer({ ...required, accepts: candidates } as AnyPaymentRequired, { chainId: chainConfig.chainId, asset: chainConfig.usdg });
      return { ok: true, offer: { network: offer.network, asset: offer.asset, payTo: offer.payTo, amount: offer.amount.toString(), scheme: offer.scheme } };
    } catch (error) {
      return fail("no_matching_offer", errorMessage(error));
    }
  }
  return { ok: true, offer: { network: first.network, asset, payTo, amount: first.amount ?? first.maxAmountRequired ?? null, scheme: first.scheme } };
}

/**
 * Fetches the announced URL without paying and accepts it only when it answers 402 with a payment
 * request that matches the announcement. Destinations in private, loopback, link-local and metadata
 * ranges are refused before any connection is made, and the connection is pinned to the vetted address.
 */
export async function probeEndpoint(entry: EndpointAnnouncement, options: ProbeOptions = {}): Promise<ProbeResult> {
  const timeoutMs = options.timeoutMs ?? 5000;
  const maxBodyBytes = options.maxBodyBytes ?? 65_536;
  let url: URL;
  try {
    url = new URL(entry.url);
  } catch {
    return fail("invalid_url", "URL does not parse");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return fail("invalid_url", `scheme ${url.protocol} is not http or https`);
  if (url.username !== "" || url.password !== "") return fail("invalid_url", "credentials in URL");
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  if (hostname.length === 0) return fail("invalid_url", "empty host");
  let address: string;
  if (isIP(hostname) !== 0) {
    address = hostname;
    if (!options.allowPrivate && isForbiddenAddress(address)) return fail("forbidden_address", `${address} is not a public address`);
  } else {
    let addresses: string[];
    try {
      addresses = await (options.resolve ?? defaultResolve)(hostname);
    } catch (error) {
      return fail("resolve_failed", errorMessage(error));
    }
    const chosen = addresses[0];
    if (chosen === undefined) return fail("resolve_failed", `${hostname} has no addresses`);
    if (!options.allowPrivate) {
      const bad = addresses.find(isForbiddenAddress);
      if (bad !== undefined) return fail("forbidden_address", `${hostname} resolves to ${bad}`);
    }
    address = chosen;
  }
  let response: ProbeResponse;
  try {
    response = await (options.request ?? httpProbe)(url, address, timeoutMs, maxBodyBytes);
  } catch (error) {
    return fail(isTimeout(error) ? "timeout" : "network_error", errorMessage(error));
  }
  if (response.status !== 402) return fail("not_402", `status ${response.status}`);
  let required: AnyPaymentRequired | null;
  try {
    required = parsePaymentRequired((name) => headerValue(response.headers, name), response.body);
  } catch (error) {
    return fail("no_payment_required", errorMessage(error));
  }
  if (!required) return fail("no_payment_required", "402 carries no x402 payment request");
  return matchOffer(required, entry);
}
