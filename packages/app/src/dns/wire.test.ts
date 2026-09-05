import { describe, expect, it } from "vitest";

import {
  buildQuery,
  encodeName,
  formatAddress,
  isBlocked,
  parseMessage,
  rcodeName,
  readName,
  RR_TYPE,
  toBase64Url,
} from "./wire";

function response(query: Uint8Array, answers: number[], rcode = 0, ancount = 1): Uint8Array {
  const out = new Uint8Array(query.length + answers.length);
  out.set(query, 0);
  out.set(answers, query.length);
  out[2] = 0x81; // QR + RD
  out[3] = 0x80 | rcode; // RA + rcode
  out[6] = (ancount >> 8) & 0xff;
  out[7] = ancount & 0xff;
  return out;
}

describe("encodeName", () => {
  it("encodes labels with length prefixes and a root terminator", () => {
    expect(Array.from(encodeName("dns.payhole.org"))).toEqual([
      3, 100, 110, 115, 7, 112, 97, 121, 104, 111, 108, 101, 3, 111, 114, 103, 0,
    ]);
  });

  it("tolerates a trailing dot and rejects empty or non-ASCII labels", () => {
    expect(encodeName("payhole.org.")).toEqual(encodeName("payhole.org"));
    expect(() => encodeName("pay..hole")).toThrow(/1 to 63/);
    expect(() => encodeName("m\u00fcnchen.de")).toThrow(/ASCII/);
    expect(() => encodeName(`${"a".repeat(64)}.org`)).toThrow(/1 to 63/);
  });
});

describe("buildQuery and parseMessage", () => {
  it("round-trips a single A question", () => {
    const query = buildQuery("payhole.org", RR_TYPE.A, 0x1234);
    expect(query.length).toBe(12 + 13 + 4);
    const parsed = parseMessage(query);
    expect(parsed.id).toBe(0x1234);
    expect(parsed.isResponse).toBe(false);
    expect(parsed.rcode).toBe(0);
    expect(parsed.questions).toEqual([{ name: "payhole.org", type: 1, class: 1 }]);
    expect(parsed.answers).toEqual([]);
  });

  it("reads an A answer that uses a compression pointer back to the question", () => {
    const query = buildQuery("payhole.org", RR_TYPE.A, 7);
    const answer = [0xc0, 0x0c, 0, 1, 0, 1, 0, 0, 0x0e, 0x10, 0, 4, 69, 48, 228, 170];
    const parsed = parseMessage(response(query, answer));
    expect(parsed.isResponse).toBe(true);
    expect(parsed.answers).toHaveLength(1);
    expect(parsed.answers[0]?.name).toBe("payhole.org");
    expect(parsed.answers[0]?.ttl).toBe(3600);
    expect(parsed.answers[0]?.address).toBe("69.48.228.170");
    expect(isBlocked(parsed)).toBe(false);
  });

  it("flags the unspecified address as a block", () => {
    const query = buildQuery("drainer.example", RR_TYPE.A, 9);
    const a = [0xc0, 0x0c, 0, 1, 0, 1, 0, 0, 0, 60, 0, 4, 0, 0, 0, 0];
    expect(isBlocked(parseMessage(response(query, a)))).toBe(true);

    const query6 = buildQuery("drainer.example", RR_TYPE.AAAA, 9);
    const aaaa = [0xc0, 0x0c, 0, 28, 0, 1, 0, 0, 0, 60, 0, 16, ...new Array<number>(16).fill(0)];
    const parsed6 = parseMessage(response(query6, aaaa));
    expect(parsed6.answers[0]?.address).toBe("::");
    expect(isBlocked(parsed6)).toBe(true);
  });

  it("reports rcodes by name", () => {
    const query = buildQuery("nope.example", RR_TYPE.A, 1);
    const parsed = parseMessage(response(query, [], 3, 0));
    expect(parsed.rcode).toBe(3);
    expect(rcodeName(parsed.rcode)).toBe("NXDOMAIN");
    expect(rcodeName(11)).toBe("RCODE11");
  });

  it("throws on truncated messages instead of returning garbage", () => {
    const query = buildQuery("payhole.org", RR_TYPE.A, 1);
    expect(() => parseMessage(query.subarray(0, 8))).toThrow(/header/);
    expect(() => parseMessage(query.subarray(0, query.length - 2))).toThrow(/truncated question/);
    const answer = [0xc0, 0x0c, 0, 1, 0, 1, 0, 0, 0, 60, 0, 4, 1, 2];
    expect(() => parseMessage(response(query, answer))).toThrow(/truncated record data/);
  });
});

describe("readName", () => {
  it("follows pointers only backwards and refuses loops", () => {
    const bytes = Uint8Array.from([3, 97, 98, 99, 0, 0xc0, 0x00, 0xc0, 0x07]);
    expect(readName(bytes, 5)).toEqual({ name: "abc", next: 7 });
    expect(() => readName(bytes, 7)).toThrow(/backwards/);
  });
});

describe("formatAddress", () => {
  it("compresses the longest run of zero groups in IPv6", () => {
    const data = Uint8Array.from([0x20, 0x01, 0x0d, 0xb8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1]);
    expect(formatAddress(RR_TYPE.AAAA, data)).toBe("2001:db8::1");
    expect(formatAddress(RR_TYPE.CNAME, data)).toBeUndefined();
    expect(formatAddress(RR_TYPE.A, Uint8Array.from([1, 2, 3]))).toBeUndefined();
  });
});

describe("toBase64Url", () => {
  it("matches the RFC 8484 example alphabet with no padding", () => {
    expect(toBase64Url(Uint8Array.from([]))).toBe("");
    expect(toBase64Url(Uint8Array.from([0xfb, 0xff]))).toBe("-_8");
    expect(toBase64Url(Uint8Array.from([0, 0, 1]))).toBe("AAAB");
    expect(toBase64Url(Uint8Array.from([0xab]))).toBe("qw");
  });
});
