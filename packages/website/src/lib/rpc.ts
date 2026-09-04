import { config } from "./config.js";

export const SELECTORS = {
  token: "0xfc0c546a",
  tierCost: "0xffdbd60d",
  tierOf: "0xc8f74bb8",
  balanceOf: "0x70a08231",
  walletOf: "0x09521458",
  nonceOf: "0x59f3ec16",
  claim: "0x54313918",
  totalSupply: "0x18160ddd",
  decimals: "0x313ce567",
  symbol: "0x95d89b41",
} as const;

export const TOPICS = {
  burned: "0x8cbfdd0f15f678ea4039ef0f30ce1494d591556082bee7c244bfd664efad36c7",
  tipped: "0xf16c198d9bc7f2358560566aabe9b43412ab77e09fb1db215be50ebb4843e1ee",
  claimed: "0x0508a8b4117d9a7b3d8f5895f6413e61b4f9a2df35afbfb41e78d0ecfff1843f",
} as const;

export const ZERO = "0x0000000000000000000000000000000000000000";
export const DEAD = "0x000000000000000000000000000000000000dEaD";

let id = 0;
export async function rpc<T>(method: string, params: unknown[]): Promise<T> {
  const res = await fetch(config.rpc, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }),
  });
  if (!res.ok) throw new Error(`rpc ${method}: http ${res.status}`);
  const json = (await res.json()) as { result?: T; error?: { message: string } };
  if (json.error) throw new Error(`rpc ${method}: ${json.error.message}`);
  return json.result as T;
}

export const pad32 = (hex: string): string => hex.replace(/^0x/, "").padStart(64, "0");
export const encodeAddress = (address: string): string => pad32(address.toLowerCase());
export const encodeUint = (value: bigint): string => pad32(value.toString(16));
export const encodeBytes = (hex: string): string => {
  const body = hex.replace(/^0x/, "");
  const length = body.length / 2;
  return encodeUint(BigInt(length)) + body.padEnd(Math.ceil(length / 32) * 64, "0");
};
export const decodeUint = (hex: string): bigint => (hex && hex !== "0x" ? BigInt(hex) : 0n);
export const decodeAddress = (hex: string): string => "0x" + hex.replace(/^0x/, "").slice(-40);

export function call(to: string, data: string): Promise<string> {
  return rpc<string>("eth_call", [{ to, data }, "latest"]);
}

export interface Log {
  address: string;
  topics: string[];
  data: string;
  blockNumber: string;
  transactionHash: string;
}

/** Logs from the most recent `span` blocks (the public RPC caps a query at 10,000 blocks). */
export async function recentLogs(address: string, topics: (string | null)[], span = 9_000): Promise<Log[]> {
  const latest = decodeUint(await rpc<string>("eth_blockNumber", []));
  const from = latest > BigInt(span) ? latest - BigInt(span) : 0n;
  return rpc<Log[]>("eth_getLogs", [{ address, topics, fromBlock: "0x" + from.toString(16), toBlock: "latest" }]);
}

export function formatUnits(value: bigint, decimals: number, maxFraction = 2): string {
  const base = 10n ** BigInt(decimals);
  const whole = value / base;
  const fraction = (value % base).toString().padStart(decimals, "0").slice(0, maxFraction).replace(/0+$/, "");
  const wholeText = whole.toLocaleString("en-US");
  return fraction ? `${wholeText}.${fraction}` : wholeText;
}

export const short = (hex: string): string => (hex.length > 12 ? `${hex.slice(0, 6)}…${hex.slice(-4)}` : hex);
export const txUrl = (hash: string): string => `${config.explorer}/tx/${hash}`;
export const addressUrl = (address: string): string => `${config.explorer}/address/${address}`;
