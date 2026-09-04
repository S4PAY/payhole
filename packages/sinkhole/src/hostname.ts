import { domainToASCII } from "node:url";

const LABEL = /^[a-z0-9_]([a-z0-9_-]*[a-z0-9_])?$/;
const MAX_HOSTNAME = 253;
const MAX_LABEL = 63;

/**
 * Normalises a hostname for the blocklist: trimmed, lowercase, punycode (internationalised labels are
 * converted with the URL standard's algorithm), no trailing dot. Returns null when the input is not a
 * bare hostname: schemes, paths, ports, credentials, IP literals, single labels and malformed labels are
 * all refused so nothing but a real domain reaches dnsmasq.
 */
export function normalizeHostname(input: unknown): string | null {
  if (typeof input !== "string") return null;
  let host = input.trim().toLowerCase();
  if (host.length === 0 || host.length > 1024) return null;
  if (/[\s/\\:@?#[\]%]/.test(host)) return null;
  if (host.endsWith(".")) host = host.slice(0, -1);
  if (host.length === 0) return null;
  const ascii = domainToASCII(host);
  if (ascii.length === 0 || ascii.length > MAX_HOSTNAME) return null;
  const labels = ascii.split(".");
  if (labels.length < 2) return null;
  for (const label of labels) {
    if (label.length === 0 || label.length > MAX_LABEL || !LABEL.test(label)) return null;
  }
  const tld = labels[labels.length - 1];
  if (tld === undefined || /^\d+$/.test(tld)) return null;
  return ascii;
}

export function isHostname(input: unknown): input is string {
  return normalizeHostname(input) !== null;
}

/** Free-text reason attached to a flag: one line of printable text, at most 200 characters. */
export function cleanReason(input: unknown, fallback = "unspecified"): string {
  if (typeof input !== "string") return fallback;
  let out = "";
  let gap = false;
  for (const ch of input) {
    const code = ch.codePointAt(0) ?? 0;
    if (code <= 0x20 || code === 0x7f || (code >= 0x80 && code <= 0x9f)) {
      gap = true;
      continue;
    }
    if (gap && out.length > 0) out += " ";
    gap = false;
    out += ch;
    if (out.length >= 200) break;
  }
  return out.length === 0 ? fallback : out;
}
