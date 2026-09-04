/** Keccak-256 (the Ethereum variant with 0x01 padding), enough for domain hashes and selectors. */

const MASK = (1n << 64n) - 1n;
const RC = [
  0x0000000000000001n, 0x0000000000008082n, 0x800000000000808an, 0x8000000080008000n,
  0x000000000000808bn, 0x0000000080000001n, 0x8000000080008081n, 0x8000000000008009n,
  0x000000000000008an, 0x0000000000000088n, 0x0000000080008009n, 0x000000008000000an,
  0x000000008000808bn, 0x800000000000008bn, 0x8000000000008089n, 0x8000000000008003n,
  0x8000000000008002n, 0x8000000000000080n, 0x000000000000800an, 0x800000008000000an,
  0x8000000080008081n, 0x8000000000008080n, 0x0000000080000001n, 0x8000000080008008n,
];
// rotation offsets indexed by x + 5 * y
const ROT = [0, 1, 62, 28, 27, 36, 44, 6, 55, 20, 3, 10, 43, 25, 39, 41, 45, 15, 21, 8, 18, 2, 61, 56, 14];

function rotl(v: bigint, n: number): bigint {
  if (n === 0) return v;
  return ((v << BigInt(n)) | (v >> BigInt(64 - n))) & MASK;
}

function keccakF(a: bigint[]): void {
  for (let round = 0; round < 24; round++) {
    const c: bigint[] = [];
    for (let x = 0; x < 5; x++) c[x] = a[x]! ^ a[x + 5]! ^ a[x + 10]! ^ a[x + 15]! ^ a[x + 20]!;
    for (let x = 0; x < 5; x++) {
      const d = c[(x + 4) % 5]! ^ rotl(c[(x + 1) % 5]!, 1);
      for (let y = 0; y < 25; y += 5) a[x + y] = a[x + y]! ^ d;
    }
    const b: bigint[] = new Array<bigint>(25).fill(0n);
    for (let x = 0; x < 5; x++) {
      for (let y = 0; y < 5; y++) {
        b[y + 5 * ((2 * x + 3 * y) % 5)] = rotl(a[x + 5 * y]!, ROT[x + 5 * y]!);
      }
    }
    for (let x = 0; x < 5; x++) {
      for (let y = 0; y < 5; y++) {
        a[x + 5 * y] = b[x + 5 * y]! ^ (~b[((x + 1) % 5) + 5 * y]! & MASK & b[((x + 2) % 5) + 5 * y]!);
      }
    }
    a[0] = a[0]! ^ RC[round]!;
  }
}

export function keccak256(input: Uint8Array | string): string {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : input;
  const rate = 136;
  const padded = new Uint8Array(Math.ceil((bytes.length + 1) / rate) * rate);
  padded.set(bytes);
  padded[bytes.length] = 0x01;
  padded[padded.length - 1] = (padded[padded.length - 1] ?? 0) | 0x80;
  const state: bigint[] = new Array<bigint>(25).fill(0n);
  for (let offset = 0; offset < padded.length; offset += rate) {
    for (let i = 0; i < rate / 8; i++) {
      let lane = 0n;
      for (let j = 7; j >= 0; j--) lane = (lane << 8n) | BigInt(padded[offset + i * 8 + j] ?? 0);
      state[i] = state[i]! ^ lane;
    }
    keccakF(state);
  }
  let hex = "0x";
  for (let i = 0; i < 4; i++) {
    let lane = state[i]!;
    for (let j = 0; j < 8; j++) {
      hex += (lane & 0xffn).toString(16).padStart(2, "0");
      lane >>= 8n;
    }
  }
  return hex;
}

/** keccak256 of the lowercase hostname without a trailing dot, the registry's domainHash. */
export function domainHash(hostname: string): string {
  return keccak256(normalizeHostname(hostname));
}

export function normalizeHostname(input: string): string {
  const candidate = input.includes("://") ? input : `https://${input}`;
  const host = new URL(candidate).hostname.toLowerCase();
  return host.endsWith(".") ? host.slice(0, -1) : host;
}
