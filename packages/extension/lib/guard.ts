/**
 * The wallet guard: reads what a page asked the wallet to do, finds every address in it, and says whether any of
 * them is one the network knows. The reading is pure, so the same rules run in tests and in the background; the
 * answers about addresses come from the resolver's `GET /address` and are remembered for a while.
 */

export const GUARDED_METHODS: ReadonlySet<string> = new Set(["eth_sendTransaction", "eth_signTypedData", "eth_signTypedData_v3", "eth_signTypedData_v4", "wallet_sendCalls"]);

export type ApprovalKind = "approve" | "increaseAllowance" | "approveAll" | "permit" | "permit2";

export interface Approval {
  kind: ApprovalKind;
  spender: string;
  token: string | null;
  unlimited: boolean;
}

export interface Transfer {
  recipient: string;
  token: string | null;
}

/** What a request would do, as far as the guard can read it. */
export interface Inspection {
  method: string;
  /** Every address in the request, lowercase, without repeats. */
  addresses: string[];
  /** The counterparty of a send, or the contract a signature is for. */
  to: string | null;
  /** True when `to` is called with data, so it is a contract rather than a recipient. */
  isCall: boolean;
  value: bigint;
  approvals: Approval[];
  transfers: Transfer[];
}

export type Role = "recipient" | "spender" | "contract" | "party";

export interface AddressLookup {
  address: string;
  flagged: boolean;
  category: string | null;
  sources: string[];
  label: string | null;
}

export interface AddressFlag {
  address: string;
  role: Role;
  category: string | null;
  label: string | null;
  sources: string[];
}

export interface GuardVerdict {
  level: "stop" | "warn" | "clear";
  flagged: AddressFlag[];
  unlimited: Approval[];
  summary: string;
}

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
/** Spenders every wallet user meets: an unlimited approval to them is the normal way in, not a trap. */
export const KNOWN_SPENDERS: ReadonlySet<string> = new Set(["0x000000000022d473030f116ddee9f6b43ac78ba3"]);
const UNLIMITED_256 = 1n << 255n;
const UNLIMITED_160 = 1n << 159n;

const SELECTORS = {
  approve: "0x095ea7b3",
  increaseAllowance: "0x39509351",
  setApprovalForAll: "0xa22cb465",
  transfer: "0xa9059cbb",
  transferFrom: "0x23b872dd",
  safeTransferFrom: "0x42842e0e",
  safeTransferFromData: "0xb88d4fde",
  permit: "0xd505accf",
  permit2Approve: "0x87517c45",
} as const;

export function isGuardedMethod(method: unknown): method is string {
  return typeof method === "string" && GUARDED_METHODS.has(method);
}

export function parseAddress(value: unknown): string | null {
  return typeof value === "string" && ADDRESS.test(value.trim()) ? value.trim().toLowerCase() : null;
}

export function shortAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function toBigint(value: unknown): bigint | null {
  if (typeof value === "bigint") return value;
  if (typeof value === "number" && Number.isFinite(value)) return BigInt(Math.trunc(value));
  if (typeof value !== "string") return null;
  const text = value.trim();
  try {
    if (/^0x[0-9a-fA-F]+$/.test(text)) return BigInt(text);
    if (/^\d+$/.test(text)) return BigInt(text);
  } catch {
    return null;
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Every address-shaped string anywhere inside `value`. */
export function collectAddresses(value: unknown, out = new Set<string>(), depth = 0): Set<string> {
  if (depth > 12) return out;
  const address = parseAddress(value);
  if (address) out.add(address);
  else if (Array.isArray(value)) for (const item of value) collectAddresses(item, out, depth + 1);
  else if (isRecord(value)) for (const item of Object.values(value)) collectAddresses(item, out, depth + 1);
  return out;
}

function word(data: string, index: number): string | null {
  const start = 10 + index * 64;
  const text = data.slice(start, start + 64);
  return text.length === 64 ? text : null;
}

function addressWord(data: string, index: number): string | null {
  const text = word(data, index);
  return text ? parseAddress(`0x${text.slice(24)}`) : null;
}

function uintWord(data: string, index: number): bigint | null {
  const text = word(data, index);
  return text ? BigInt(`0x${text}`) : null;
}

/** What one call does, from its target and calldata. */
function readCall(to: string | null, data: string, out: { approvals: Approval[]; transfers: Transfer[]; addresses: Set<string> }): void {
  const selector = data.slice(0, 10).toLowerCase();
  const add = (address: string | null): string | null => {
    if (address) out.addresses.add(address);
    return address;
  };
  switch (selector) {
    case SELECTORS.approve:
    case SELECTORS.increaseAllowance: {
      const spender = add(addressWord(data, 0));
      const amount = uintWord(data, 1);
      if (spender) out.approvals.push({ kind: selector === SELECTORS.approve ? "approve" : "increaseAllowance", spender, token: to, unlimited: amount !== null && amount >= UNLIMITED_256 });
      return;
    }
    case SELECTORS.setApprovalForAll: {
      const operator = add(addressWord(data, 0));
      const approved = uintWord(data, 1);
      if (operator && approved !== null && approved !== 0n) out.approvals.push({ kind: "approveAll", spender: operator, token: to, unlimited: true });
      return;
    }
    case SELECTORS.transfer: {
      const recipient = add(addressWord(data, 0));
      if (recipient) out.transfers.push({ recipient, token: to });
      return;
    }
    case SELECTORS.transferFrom:
    case SELECTORS.safeTransferFrom:
    case SELECTORS.safeTransferFromData: {
      add(addressWord(data, 0));
      const recipient = add(addressWord(data, 1));
      if (recipient) out.transfers.push({ recipient, token: to });
      return;
    }
    case SELECTORS.permit: {
      add(addressWord(data, 0));
      const spender = add(addressWord(data, 1));
      const value = uintWord(data, 2);
      if (spender) out.approvals.push({ kind: "permit", spender, token: to, unlimited: value !== null && value >= UNLIMITED_256 });
      return;
    }
    case SELECTORS.permit2Approve: {
      const token = add(addressWord(data, 0));
      const spender = add(addressWord(data, 1));
      const amount = uintWord(data, 2);
      if (spender) out.approvals.push({ kind: "permit2", spender, token, unlimited: amount !== null && amount >= UNLIMITED_160 });
      return;
    }
    default:
      return;
  }
}

function readTypedData(raw: unknown, out: { approvals: Approval[]; addresses: Set<string> }): string | null {
  let typed: unknown = raw;
  if (typeof raw === "string") {
    try {
      typed = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!isRecord(typed)) return null;
  const domain = isRecord(typed["domain"]) ? typed["domain"] : {};
  const message = isRecord(typed["message"]) ? typed["message"] : {};
  const contract = parseAddress(domain["verifyingContract"]);
  collectAddresses(message, out.addresses);
  if (contract) out.addresses.add(contract);
  const primaryType = typeof typed["primaryType"] === "string" ? typed["primaryType"] : "";
  const spender = parseAddress(message["spender"]);
  if (primaryType === "Permit" && spender) {
    const value = toBigint(message["value"]);
    out.approvals.push({ kind: "permit", spender, token: contract, unlimited: message["allowed"] === true || (value !== null && value >= UNLIMITED_256) });
  } else if (primaryType === "PermitSingle" && spender) {
    const details = isRecord(message["details"]) ? message["details"] : {};
    const amount = toBigint(details["amount"]);
    out.approvals.push({ kind: "permit2", spender, token: parseAddress(details["token"]), unlimited: amount !== null && amount >= UNLIMITED_160 });
  } else if (primaryType === "PermitBatch" && spender) {
    const details = Array.isArray(message["details"]) ? message["details"] : [];
    for (const item of details) {
      if (!isRecord(item)) continue;
      const amount = toBigint(item["amount"]);
      out.approvals.push({ kind: "permit2", spender, token: parseAddress(item["token"]), unlimited: amount !== null && amount >= UNLIMITED_160 });
    }
  } else if (/^Permit(Witness)?(Batch)?TransferFrom$/.test(primaryType) && spender) {
    const permitted = message["permitted"];
    const tokens = (Array.isArray(permitted) ? permitted : [permitted]).map((item) => (isRecord(item) ? parseAddress(item["token"]) : null));
    for (const token of tokens.length > 0 ? tokens : [null]) out.approvals.push({ kind: "permit2", spender, token, unlimited: false });
  }
  return contract;
}

/** Reads a wallet request; null when the method is not one the guard looks at. */
export function inspectRequest(method: unknown, params: unknown): Inspection | null {
  if (!isGuardedMethod(method)) return null;
  const out = { approvals: [] as Approval[], transfers: [] as Transfer[], addresses: new Set<string>() };
  let to: string | null = null;
  let isCall = false;
  let value = 0n;
  const list: unknown[] = Array.isArray(params) ? (params as unknown[]) : [];

  const readTransaction = (tx: unknown): void => {
    if (!isRecord(tx)) return;
    const target = parseAddress(tx["to"]);
    const data = typeof tx["data"] === "string" && tx["data"].startsWith("0x") ? tx["data"] : typeof tx["input"] === "string" && tx["input"].startsWith("0x") ? tx["input"] : "0x";
    if (target) out.addresses.add(target);
    if (to === null) {
      to = target;
      isCall = data.length >= 10;
    }
    value += toBigint(tx["value"]) ?? 0n;
    if (data.length >= 10) readCall(target, data, out);
    else if (target) out.transfers.push({ recipient: target, token: null });
  };

  if (method === "eth_sendTransaction") {
    readTransaction(list[0]);
  } else if (method === "wallet_sendCalls") {
    const batch = isRecord(list[0]) ? list[0] : {};
    const calls = Array.isArray(batch["calls"]) ? batch["calls"] : [];
    for (const call of calls) readTransaction(call);
  } else {
    // eth_signTypedData(_v3|_v4): [address, typedData]; the v1 form is [typedData[], address].
    const typed = typeof list[0] === "string" && ADDRESS.test(list[0]) ? list[1] : list[0];
    if (Array.isArray(typed)) collectAddresses(typed, out.addresses);
    else to = readTypedData(typed, out);
  }

  return { method, addresses: [...out.addresses], to, isCall, value, approvals: out.approvals, transfers: out.transfers };
}

const CATEGORY_WORDS: Record<string, string> = {
  drainer: "wallet drainer",
  phishing: "phishing wallet",
  infra: "drainer infrastructure",
  counterfeit: "counterfeit token",
  other: "flagged address",
};

function describeFlag(flag: AddressFlag): string {
  const what = `a known ${CATEGORY_WORDS[flag.category ?? "other"] ?? "flagged address"}${flag.label ? ` (${flag.label})` : ""}`;
  const who = shortAddress(flag.address);
  switch (flag.role) {
    case "recipient":
      return `Sending to ${who}, ${what}. The funds would not come back.`;
    case "spender":
      return `This approval lets ${who} move your tokens. It is ${what}.`;
    case "contract":
      return `${who} is ${what}. Calling it is how the funds leave.`;
    case "party":
      return `${who} is in what you would sign. It is ${what}.`;
  }
}

/** The roles addresses play in a request, so the warning can say what would happen. */
export function rolesOf(inspection: Inspection): Map<string, Role> {
  const roles = new Map<string, Role>();
  for (const address of inspection.addresses) roles.set(address, "party");
  if (inspection.to) roles.set(inspection.to, inspection.isCall ? "contract" : "recipient");
  for (const transfer of inspection.transfers) roles.set(transfer.recipient, "recipient");
  for (const approval of inspection.approvals) roles.set(approval.spender, "spender");
  return roles;
}

/** Weighs what was read against what the network knows about each address. */
export function assess(inspection: Inspection, lookups: ReadonlyMap<string, AddressLookup | null>, options: { warnUnlimited: boolean; trusted?: ReadonlySet<string> | undefined }): GuardVerdict {
  const roles = rolesOf(inspection);
  const flagged: AddressFlag[] = [];
  for (const address of inspection.addresses) {
    const lookup = lookups.get(address);
    if (lookup?.flagged) flagged.push({ address, role: roles.get(address) ?? "party", category: lookup.category, label: lookup.label, sources: lookup.sources });
  }
  const order: Role[] = ["recipient", "spender", "contract", "party"];
  flagged.sort((a, b) => order.indexOf(a.role) - order.indexOf(b.role));
  const trusted = options.trusted ?? new Set<string>();
  const unlimited = inspection.approvals.filter((approval) => approval.unlimited && !lookups.get(approval.spender)?.flagged && !KNOWN_SPENDERS.has(approval.spender) && !trusted.has(approval.spender));
  if (flagged.length > 0) return { level: "stop", flagged, unlimited, summary: describeFlag(flagged[0]!) };
  if (unlimited.length > 0 && options.warnUnlimited) {
    const first = unlimited[0]!;
    return { level: "warn", flagged, unlimited, summary: `Unlimited approval to ${shortAddress(first.spender)}. Not on any list. It could move all of this token at any time.` };
  }
  return { level: "clear", flagged, unlimited, summary: "Nothing known." };
}

/** Asks the resolver about one address. Throws on network trouble or a refused input. */
export async function fetchAddress(address: string, resolver: string, fetchImpl: typeof fetch = fetch): Promise<AddressLookup> {
  const response = await fetchImpl(`${resolver.replace(/\/+$/, "")}/address?address=${encodeURIComponent(address)}`, { headers: { accept: "application/json" } });
  if (response.status === 429) throw new Error("The resolver is rate limiting this browser.");
  if (!response.ok) throw new Error(`The resolver refused the address (${response.status}).`);
  const parsed: unknown = await response.json();
  const body = (typeof parsed === "object" && parsed !== null ? parsed : {}) as Partial<AddressLookup>;
  if (typeof body.address !== "string" || typeof body.flagged !== "boolean") throw new Error("The resolver sent an answer this extension does not understand.");
  return {
    address: body.address.toLowerCase(),
    flagged: body.flagged,
    category: typeof body.category === "string" ? body.category : null,
    sources: Array.isArray(body.sources) ? body.sources.filter((s): s is string => typeof s === "string") : [],
    label: typeof body.label === "string" ? body.label : null,
  };
}

/** Answers about addresses, each trusted for a while; a lookup that fails counts as unknown, never as clean forever. */
export class AddressCache {
  private readonly entries = new Map<string, { lookup: AddressLookup; at: number }>();
  private readonly inflight = new Map<string, Promise<AddressLookup>>();
  private readonly ttl: number;
  private readonly flaggedTtl: number;
  private readonly now: () => number;

  constructor(
    private readonly source: (address: string) => Promise<AddressLookup>,
    options: { ttlMs?: number | undefined; flaggedTtlMs?: number | undefined; now?: (() => number) | undefined } = {},
  ) {
    this.ttl = options.ttlMs ?? 10 * 60_000;
    this.flaggedTtl = options.flaggedTtlMs ?? 60 * 60_000;
    this.now = options.now ?? (() => Date.now());
  }

  known(address: string): AddressLookup | null {
    const entry = this.entries.get(address);
    if (!entry) return null;
    if (this.now() - entry.at >= (entry.lookup.flagged ? this.flaggedTtl : this.ttl)) {
      this.entries.delete(address);
      return null;
    }
    return entry.lookup;
  }

  lookup(address: string): Promise<AddressLookup> {
    const fresh = this.known(address);
    if (fresh) return Promise.resolve(fresh);
    let pending = this.inflight.get(address);
    if (!pending) {
      pending = this.source(address)
        .then((lookup) => {
          this.entries.set(address, { lookup, at: this.now() });
          return lookup;
        })
        .finally(() => this.inflight.delete(address));
      this.inflight.set(address, pending);
    }
    return pending;
  }

  /** Every address at once; one that cannot be answered is null. */
  async lookupAll(addresses: readonly string[]): Promise<Map<string, AddressLookup | null>> {
    const out = new Map<string, AddressLookup | null>();
    await Promise.all(addresses.map(async (address) => out.set(address, await this.lookup(address).catch(() => null))));
    return out;
  }

  clear(): void {
    this.entries.clear();
  }
}
