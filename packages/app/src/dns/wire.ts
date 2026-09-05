/**
 * Minimal DNS wire-format helpers (RFC 1035) used to build a probe query and read the answer.
 * Only what the app needs: question encoding, header flags, answer records, A/AAAA addresses,
 * and name decompression. Anything malformed throws so callers can report a broken resolver.
 */

export const RR_TYPE = {
  A: 1,
  CNAME: 5,
  AAAA: 28,
} as const;

export type RrType = (typeof RR_TYPE)[keyof typeof RR_TYPE];

export const RCODE_NAMES: Readonly<Record<number, string>> = {
  0: "NOERROR",
  1: "FORMERR",
  2: "SERVFAIL",
  3: "NXDOMAIN",
  4: "NOTIMP",
  5: "REFUSED",
};

export interface DnsQuestion {
  name: string;
  type: number;
  class: number;
}

export interface DnsRecord {
  name: string;
  type: number;
  class: number;
  ttl: number;
  data: Uint8Array;
  /** Dotted IPv4 or compressed IPv6 text for A and AAAA records. */
  address?: string;
}

export interface DnsMessage {
  id: number;
  isResponse: boolean;
  truncated: boolean;
  rcode: number;
  questions: DnsQuestion[];
  answers: DnsRecord[];
}

const MAX_LABEL = 63;
const MAX_NAME = 255;
const MAX_POINTER_HOPS = 32;

function asciiBytes(label: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < label.length; i++) {
    const code = label.charCodeAt(i);
    if (code < 0x21 || code > 0x7e) {
      throw new Error(`label "${label}" must be ASCII (use punycode for other scripts)`);
    }
    out.push(code);
  }
  return out;
}

/** Encodes a host name as DNS labels, tolerating a trailing dot. */
export function encodeName(name: string): Uint8Array {
  const labels = name.replace(/\.$/, "").split(".");
  const bytes: number[] = [];
  for (const label of labels) {
    const encoded = asciiBytes(label);
    if (encoded.length === 0 || encoded.length > MAX_LABEL) {
      throw new Error(`label "${label}" must be 1 to ${MAX_LABEL} characters`);
    }
    bytes.push(encoded.length, ...encoded);
  }
  bytes.push(0);
  if (bytes.length > MAX_NAME) throw new Error("name longer than 255 bytes");
  return Uint8Array.from(bytes);
}

function randomId(): number {
  return Math.floor(Math.random() * 0x10000);
}

/** Builds a standard recursive query with a single question and no EDNS. */
export function buildQuery(name: string, type: RrType = RR_TYPE.A, id: number = randomId()): Uint8Array {
  const qname = encodeName(name);
  const out = new Uint8Array(12 + qname.length + 4);
  const view = new DataView(out.buffer);
  view.setUint16(0, id & 0xffff);
  view.setUint16(2, 0x0100); // RD set, everything else zero
  view.setUint16(4, 1); // QDCOUNT
  out.set(qname, 12);
  view.setUint16(12 + qname.length, type);
  view.setUint16(14 + qname.length, 1); // IN
  return out;
}

/** Reads a possibly compressed name starting at `start`; `next` is the offset after it. */
export function readName(bytes: Uint8Array, start: number): { name: string; next: number } {
  const labels: string[] = [];
  let offset = start;
  let next = -1;
  let hops = 0;
  for (;;) {
    if (offset >= bytes.length) throw new Error("name runs past the end of the message");
    const len = bytes[offset] ?? 0;
    if (len === 0) {
      offset += 1;
      break;
    }
    if ((len & 0xc0) === 0xc0) {
      if (offset + 1 >= bytes.length) throw new Error("truncated compression pointer");
      const pointer = ((len & 0x3f) << 8) | (bytes[offset + 1] ?? 0);
      if (pointer >= offset) throw new Error("compression pointer does not point backwards");
      if (++hops > MAX_POINTER_HOPS) throw new Error("compression pointer loop");
      if (next < 0) next = offset + 2;
      offset = pointer;
      continue;
    }
    if ((len & 0xc0) !== 0) throw new Error("unsupported label type");
    if (offset + 1 + len > bytes.length) throw new Error("label runs past the end of the message");
    let label = "";
    for (let i = offset + 1; i < offset + 1 + len; i++) label += String.fromCharCode(bytes[i] ?? 0);
    labels.push(label);
    offset += 1 + len;
  }
  return { name: labels.join("."), next: next < 0 ? offset : next };
}

function compressIpv6(groups: number[]): string {
  let bestStart = -1;
  let bestLen = 0;
  for (let i = 0; i < groups.length; ) {
    if (groups[i] !== 0) {
      i++;
      continue;
    }
    let j = i;
    while (j < groups.length && groups[j] === 0) j++;
    if (j - i > bestLen) {
      bestStart = i;
      bestLen = j - i;
    }
    i = j;
  }
  const hex = groups.map((g) => g.toString(16));
  if (bestLen < 2) return hex.join(":");
  const head = hex.slice(0, bestStart).join(":");
  const tail = hex.slice(bestStart + bestLen).join(":");
  return `${head}::${tail}`;
}

/** Text form of an A or AAAA record's data, or undefined for other types. */
export function formatAddress(type: number, data: Uint8Array): string | undefined {
  if (type === RR_TYPE.A && data.length === 4) return Array.from(data).join(".");
  if (type === RR_TYPE.AAAA && data.length === 16) {
    const groups: number[] = [];
    for (let i = 0; i < 16; i += 2) groups.push(((data[i] ?? 0) << 8) | (data[i + 1] ?? 0));
    return compressIpv6(groups);
  }
  return undefined;
}

/** Parses header, questions, and answers. Authority and additional sections are ignored. */
export function parseMessage(bytes: Uint8Array): DnsMessage {
  if (bytes.length < 12) throw new Error("DNS message shorter than its header");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const flags = view.getUint16(2);
  const qdcount = view.getUint16(4);
  const ancount = view.getUint16(6);
  let offset = 12;

  const questions: DnsQuestion[] = [];
  for (let i = 0; i < qdcount; i++) {
    const { name, next } = readName(bytes, offset);
    if (next + 4 > bytes.length) throw new Error("truncated question");
    questions.push({ name, type: view.getUint16(next), class: view.getUint16(next + 2) });
    offset = next + 4;
  }

  const answers: DnsRecord[] = [];
  for (let i = 0; i < ancount; i++) {
    const { name, next } = readName(bytes, offset);
    if (next + 10 > bytes.length) throw new Error("truncated answer");
    const type = view.getUint16(next);
    const cls = view.getUint16(next + 2);
    const ttl = view.getUint32(next + 4);
    const rdlength = view.getUint16(next + 8);
    const dataStart = next + 10;
    if (dataStart + rdlength > bytes.length) throw new Error("truncated record data");
    const data = bytes.slice(dataStart, dataStart + rdlength);
    const record: DnsRecord = { name, type, class: cls, ttl, data };
    const address = formatAddress(type, data);
    if (address !== undefined) record.address = address;
    answers.push(record);
    offset = dataStart + rdlength;
  }

  return {
    id: view.getUint16(0),
    isResponse: (flags & 0x8000) !== 0,
    truncated: (flags & 0x0200) !== 0,
    rcode: flags & 0x000f,
    questions,
    answers,
  };
}

/** Sinkhole answers a blocked name with the unspecified address: 0.0.0.0 for A, :: for AAAA. */
export function isBlocked(message: DnsMessage): boolean {
  return message.answers.some((a) => a.address === "0.0.0.0" || a.address === "::");
}

export function rcodeName(rcode: number): string {
  return RCODE_NAMES[rcode] ?? `RCODE${rcode}`;
}

const B64URL = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

/** Unpadded base64url, the encoding RFC 8484 uses for the `dns` query parameter. */
export function toBase64Url(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i] ?? 0;
    const b1 = bytes[i + 1];
    const b2 = bytes[i + 2];
    out += B64URL[b0 >> 2];
    out += B64URL[((b0 & 3) << 4) | ((b1 ?? 0) >> 4)];
    if (b1 === undefined) break;
    out += B64URL[((b1 & 15) << 2) | ((b2 ?? 0) >> 6)];
    if (b2 === undefined) break;
    out += B64URL[b2 & 63];
  }
  return out;
}
