/**
 * Just enough of the DNS wire format (RFC 1035) to route messages: header flags, the length of the question
 * section, the lowest TTL in an answer, and a SERVFAIL reply that echoes a query.
 */

export const HEADER_BYTES = 12;
/** Largest message the encrypted listeners accept or return. */
export const MAX_MESSAGE_BYTES = 4096;
const TYPE_OPT = 41;

export function isQuery(message: Buffer): boolean {
  return message.length >= HEADER_BYTES && (message.readUInt8(2) & 0x80) === 0;
}

export function isTruncated(message: Buffer): boolean {
  return message.length >= HEADER_BYTES && (message.readUInt8(2) & 0x02) !== 0;
}

export function rcode(message: Buffer): number {
  return message.length >= HEADER_BYTES ? message.readUInt8(3) & 0x0f : -1;
}

export function messageId(message: Buffer): number {
  return message.readUInt16BE(0);
}

/** Offset just past the name that starts at `offset`; a compression pointer ends the name after two bytes. */
function skipName(message: Buffer, offset: number): number {
  let i = offset;
  while (i < message.length) {
    const length = message.readUInt8(i);
    if (length === 0) return i + 1;
    if ((length & 0xc0) === 0xc0) return i + 2;
    i += 1 + length;
  }
  throw new Error("name runs past the end of the message");
}

/** Offset just past the question section. Throws on a malformed message. */
export function questionSectionEnd(message: Buffer): number {
  if (message.length < HEADER_BYTES) throw new Error("message shorter than a header");
  const questions = message.readUInt16BE(4);
  let i = HEADER_BYTES;
  for (let q = 0; q < questions; q += 1) {
    i = skipName(message, i) + 4;
    if (i > message.length) throw new Error("question runs past the end of the message");
  }
  return i;
}

/**
 * Lowest TTL over the answer, authority and additional records, ignoring the EDNS OPT pseudo-record.
 * Null when the message has no records or cannot be parsed.
 */
export function minTtl(message: Buffer): number | null {
  let i: number;
  try {
    i = questionSectionEnd(message);
  } catch {
    return null;
  }
  const records = message.readUInt16BE(6) + message.readUInt16BE(8) + message.readUInt16BE(10);
  let lowest: number | null = null;
  try {
    for (let r = 0; r < records; r += 1) {
      i = skipName(message, i);
      if (i + 10 > message.length) return lowest;
      const type = message.readUInt16BE(i);
      const ttl = message.readUInt32BE(i + 4);
      const rdlength = message.readUInt16BE(i + 8);
      i += 10 + rdlength;
      if (i > message.length) return lowest;
      if (type === TYPE_OPT) continue;
      lowest = lowest === null ? ttl : Math.min(lowest, ttl);
    }
  } catch {
    return lowest;
  }
  return lowest;
}

/** A SERVFAIL reply carrying the query's id and question, with recursion available and no records. */
export function servfail(query: Buffer): Buffer {
  let end: number;
  let keepQuestion = true;
  try {
    end = questionSectionEnd(query);
  } catch {
    end = Math.min(query.length, HEADER_BYTES);
    keepQuestion = false;
  }
  const reply = Buffer.alloc(Math.max(end, HEADER_BYTES));
  query.copy(reply, 0, 0, Math.min(end, query.length));
  const opcode = query.length >= 3 ? query.readUInt8(2) & 0x78 : 0;
  const recursionDesired = query.length >= 3 ? query.readUInt8(2) & 0x01 : 0;
  reply.writeUInt8(0x80 | opcode | recursionDesired, 2);
  reply.writeUInt8(0x80 | 0x02, 3);
  if (!keepQuestion) reply.writeUInt16BE(0, 4);
  reply.writeUInt16BE(0, 6);
  reply.writeUInt16BE(0, 8);
  reply.writeUInt16BE(0, 10);
  return reply;
}
