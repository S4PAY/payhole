/**
 * The browser's reporter identity: a secp256k1 key that signs reports, the same way the phone's does. Money never
 * touches it. A tier holder links it by signing a membership proof on payhole.org/link that names this key's address
 * in the peer slot, and from then on the browser's reports count as that wallet's flags. Texts and shapes are
 * identical to the app's and the node's, keys sorted.
 */
import { getAddress, isAddress, recoverMessageAddress, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import type { Category } from "./shield";
import type { KeyValueStore } from "./storage";

export const MEMBERSHIP_HEADER = "PayHole Sinkhole membership";
export const REPORTER_KEY = "reporterKey";
export const REPORTER_PROOF_KEY = "reporterProof";
export const REWARDS_WALLET_KEY = "rewardsWallet";
export const MY_REPORTS_KEY = "myReports";
const REPORTS_KEPT = 100;

export interface Proof {
  peerId: string;
  address: string;
  issuedAt: string;
  signature: string;
}

export interface FlagBody {
  type: "flag";
  domain: string;
  reason: string;
  ts: number;
  category?: Category;
}

export interface DelegatedFlag {
  kind: "flag";
  body: FlagBody;
  reporter: string;
  proof: Proof;
  signature: string;
  delegate: string;
}

export interface SignedHint {
  name?: string;
  address?: string;
  category?: Category;
  reason?: string;
  key: string;
  payTo: string | null;
  ts: number;
  signature: string;
}

/** A report this browser made, kept so the dashboard can show what became of it. */
export interface LocalReport {
  /** The name, or the lowercase address. */
  domain: string;
  category: Category | null;
  at: number;
}

const SIGNATURE = /^0x[0-9a-fA-F]{130}$/;

export function sameAddress(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

/** JSON with keys sorted at every level; what a signature covers. Identical to the node's. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  const record = value as Record<string, unknown>;
  const parts: string[] = [];
  for (const key of Object.keys(record).sort()) {
    const item = record[key];
    if (item === undefined) continue;
    parts.push(`${JSON.stringify(key)}:${canonicalJson(item)}`);
  }
  return `{${parts.join(",")}}`;
}

/** The exact text a tier holder signs to bind a key to their wallet; identical to the node's. */
export function membershipText(peerId: string, address: string, issuedAt: string): string {
  return `${MEMBERSHIP_HEADER}\npeer: ${peerId}\naddress: ${address}\nissued: ${issuedAt}`;
}

/** The text a reporter signs for a hint; identical to the node's, keys sorted. */
export function hintText(domain: string, category: Category | null, reason: string, ts: number, payTo: string | null): string {
  return canonicalJson({ type: "hint", domain, category, reason, ts, payTo });
}

/** Reads a proof pasted from payhole.org/link and checks that it names this key and was signed by the wallet it claims. */
export async function parseProof(text: string, delegateAddress: string): Promise<{ ok: true; proof: Proof } | { ok: false; error: string }> {
  let value: unknown;
  try {
    value = JSON.parse(text.trim());
  } catch {
    return { ok: false, error: "That is not the proof JSON. Copy the whole block from the link page." };
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) return { ok: false, error: "The proof must be a JSON object." };
  const { peerId, address, issuedAt, signature } = value as Record<string, unknown>;
  if (typeof peerId !== "string" || !isAddress(peerId)) return { ok: false, error: "The proof does not name a reporter key." };
  if (!sameAddress(peerId, delegateAddress)) return { ok: false, error: `This proof is for ${peerId.slice(0, 10)}, not for this browser's key.` };
  if (typeof address !== "string" || !isAddress(address)) return { ok: false, error: "The proof does not name a wallet." };
  if (typeof issuedAt !== "string" || Number.isNaN(Date.parse(issuedAt))) return { ok: false, error: "The proof has no valid issue time." };
  if (typeof signature !== "string" || !SIGNATURE.test(signature)) return { ok: false, error: "The proof's signature is malformed." };
  let signer: string;
  try {
    signer = await recoverMessageAddress({ message: membershipText(peerId, address, issuedAt), signature: signature as Hex });
  } catch {
    return { ok: false, error: "The proof's signature cannot be read." };
  }
  if (!sameAddress(signer, address)) return { ok: false, error: "The signature was not made by the wallet the proof names." };
  return { ok: true, proof: { peerId, address, issuedAt, signature } };
}

/** A hint signed by this browser's key, naming the wallet rewards go to. `subject` is a name or a lowercase address. */
export async function signHint(account: PrivateKeyAccount, subject: string, category: Category | null, reason: string, payTo: string | null, ts = Date.now()): Promise<SignedHint> {
  const cleanPayTo = payTo && isAddress(payTo) ? getAddress(payTo) : null;
  const signature = await account.signMessage({ message: hintText(subject, category, reason, ts, cleanPayTo) });
  return {
    ...(isAddress(subject) ? { address: subject } : { name: subject }),
    ...(category ? { category } : {}),
    ...(reason ? { reason } : {}),
    key: account.address,
    payTo: cleanPayTo,
    ts,
    signature,
  };
}

/** A swarm flag signed by this browser on behalf of the wallet in the proof, in the node's message format. */
export async function buildDelegatedFlag(account: PrivateKeyAccount, proof: Proof, body: FlagBody): Promise<DelegatedFlag> {
  if (!sameAddress(proof.peerId, account.address)) throw new Error("the proof does not name this browser's key");
  const clean: FlagBody = { type: "flag", domain: body.domain, reason: body.reason, ts: body.ts, ...(body.category ? { category: body.category } : {}) };
  return { kind: "flag", body: clean, reporter: proof.address, proof, signature: await account.signMessage({ message: canonicalJson(clean) }), delegate: account.address };
}

/** The reporter identity and what goes with it, kept in extension storage: the key, the proof, the rewards wallet, and the reports made. */
export class ReporterStore {
  private account: PrivateKeyAccount | null = null;
  private proof: Proof | null = null;
  private wallet: string | null = null;
  private reports: LocalReport[] = [];

  constructor(private readonly store: KeyValueStore) {}

  async load(): Promise<void> {
    let key = await this.store.get<string>(REPORTER_KEY);
    if (typeof key !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(key)) {
      key = generatePrivateKey();
      await this.store.set(REPORTER_KEY, key);
    }
    this.account = privateKeyToAccount(key as Hex);
    const proof = await this.store.get<Proof>(REPORTER_PROOF_KEY);
    this.proof = proof && typeof proof.peerId === "string" && sameAddress(proof.peerId, this.account.address) ? proof : null;
    const wallet = await this.store.get<string>(REWARDS_WALLET_KEY);
    this.wallet = typeof wallet === "string" && isAddress(wallet) ? wallet : null;
    const reports = await this.store.get<LocalReport[]>(MY_REPORTS_KEY);
    this.reports = Array.isArray(reports) ? reports.filter((entry) => typeof entry.domain === "string" && typeof entry.at === "number") : [];
  }

  signer(): PrivateKeyAccount {
    if (!this.account) throw new Error("the reporter key is not loaded");
    return this.account;
  }

  get address(): string | null {
    return this.account?.address ?? null;
  }

  get holder(): string | null {
    return this.proof?.address ?? null;
  }

  get linked(): Proof | null {
    return this.proof;
  }

  /** Where bounties go: the wallet the person named, or the linked holder. */
  get payTo(): string | null {
    return this.wallet ?? this.proof?.address ?? null;
  }

  get walletIsOwn(): boolean {
    return this.wallet !== null;
  }

  list(): LocalReport[] {
    return [...this.reports];
  }

  async setWallet(input: string): Promise<string | null> {
    const trimmed = input.trim();
    if (trimmed.length === 0) {
      this.wallet = null;
      await this.store.remove(REWARDS_WALLET_KEY);
      return null;
    }
    if (!isAddress(trimmed)) throw new Error("That is not a wallet address. It starts with 0x and has 40 characters after it.");
    this.wallet = getAddress(trimmed);
    await this.store.set(REWARDS_WALLET_KEY, this.wallet);
    return this.wallet;
  }

  async link(proofText: string): Promise<Proof> {
    const parsed = await parseProof(proofText, this.signer().address);
    if (!parsed.ok) throw new Error(parsed.error);
    this.proof = parsed.proof;
    await this.store.set(REPORTER_PROOF_KEY, parsed.proof);
    return parsed.proof;
  }

  async unlink(): Promise<void> {
    this.proof = null;
    await this.store.remove(REPORTER_PROOF_KEY);
  }

  async remember(domain: string, category: Category | null, at = Date.now()): Promise<void> {
    this.reports = [{ domain, category, at }, ...this.reports.filter((entry) => entry.domain !== domain)].slice(0, REPORTS_KEPT);
    await this.store.set(MY_REPORTS_KEY, this.reports);
  }
}

export type RewardStatus = "payable" | "pending" | "capped" | "paid" | "void";

export interface RewardEntry {
  domain: string;
  category: string | null;
  amount: number;
  status: RewardStatus;
  reportedAt: number;
  confirmedAt: number | null;
  corroboration: string | null;
  paidTx: string | null;
  evidence: { score: number; marks: string[] } | null;
  review: "confirm" | "reject" | null;
}

export interface RewardsSummary {
  wallet: string;
  owed: number;
  paid: number;
  pending: number;
  minPayout: number;
  eligible: { ok: boolean; tier: number; tokens: number; required: number } | null;
  claim: { requestedAt: number; amount: number; paidAt: number | null; tx: string | null } | null;
  entries: RewardEntry[];
}

const REWARD_STATUSES = new Set(["payable", "pending", "capped", "paid", "void"]);

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function num(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/** What the resolver owes a rewards wallet, and every report behind it. */
export async function fetchRewards(resolver: string, wallet: string, fetchImpl: typeof fetch = fetch): Promise<RewardsSummary> {
  const response = await fetchImpl(`${resolver.replace(/\/+$/, "")}/rewards?wallet=${encodeURIComponent(wallet)}`, { headers: { accept: "application/json" } });
  if (response.status === 429) throw new Error("The resolver is rate limiting this browser. Try again in a minute.");
  if (!response.ok) throw new Error(`The resolver refused the request (${response.status}).`);
  const body = record(await response.json());
  if (!body) throw new Error("The resolver's answer was not a rewards summary.");
  const eligibleRaw = record(body["eligible"]);
  const claimRaw = record(body["claim"]);
  const entries: RewardEntry[] = [];
  for (const item of Array.isArray(body["entries"]) ? body["entries"] : []) {
    const entry = record(item);
    if (!entry || typeof entry["domain"] !== "string") continue;
    const status = typeof entry["status"] === "string" && REWARD_STATUSES.has(entry["status"]) ? (entry["status"] as RewardStatus) : "pending";
    const evidenceRaw = record(entry["evidence"]);
    const verdict = record(entry["review"])?.["verdict"];
    entries.push({
      domain: entry["domain"],
      category: typeof entry["category"] === "string" ? entry["category"] : null,
      amount: num(entry["amount"]),
      status,
      reportedAt: num(entry["reportedAt"]),
      confirmedAt: typeof entry["confirmedAt"] === "number" ? entry["confirmedAt"] : null,
      corroboration: typeof entry["corroboration"] === "string" ? entry["corroboration"] : null,
      paidTx: typeof entry["paidTx"] === "string" ? entry["paidTx"] : null,
      evidence: evidenceRaw ? { score: num(evidenceRaw["score"]), marks: (Array.isArray(evidenceRaw["marks"]) ? evidenceRaw["marks"] : []).filter((mark): mark is string => typeof mark === "string") } : null,
      review: verdict === "confirm" || verdict === "reject" ? verdict : null,
    });
  }
  return {
    wallet,
    owed: num(body["owed"]),
    paid: num(body["paid"]),
    pending: num(body["pending"]),
    minPayout: num(body["minPayout"], 10),
    eligible: eligibleRaw ? { ok: eligibleRaw["ok"] === true, tier: num(eligibleRaw["tier"]), tokens: num(eligibleRaw["tokens"]), required: num(eligibleRaw["required"]) } : null,
    claim: claimRaw ? { requestedAt: num(claimRaw["requestedAt"]), amount: num(claimRaw["amount"]), paidAt: typeof claimRaw["paidAt"] === "number" ? claimRaw["paidAt"] : null, tx: typeof claimRaw["tx"] === "string" ? claimRaw["tx"] : null } : null,
    entries,
  };
}

/** Asks the resolver to queue a payout for a wallet; the answer is the node's status word and detail. */
export async function requestPayout(resolver: string, wallet: string, fetchImpl: typeof fetch = fetch): Promise<{ status: string; detail: string | null }> {
  const response = await fetchImpl(`${resolver.replace(/\/+$/, "")}/rewards/claim`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json" }, body: JSON.stringify({ wallet }) });
  if (response.status === 429) throw new Error("The resolver is rate limiting this browser. Try again in a minute.");
  const body = record(await response.json().catch(() => null));
  const status = typeof body?.["status"] === "string" ? body["status"] : `error_${response.status}`;
  const detail = typeof body?.["detail"] === "string" ? body["detail"] : null;
  return { status, detail };
}

/** The line shown after a payout request. */
export function describePayout(result: { status: string; detail: string | null }, minPayout: number, owed: number): string {
  switch (result.status) {
    case "requested":
      return `Payout requested: ${owed.toFixed(2)} USDG.`;
    case "below_minimum":
      return `Payouts start at ${minPayout} USDG. Owed ${owed.toFixed(2)}.`;
    case "already_open":
      return "Payout already on its way.";
    case "not_eligible":
      return result.detail ? `Not eligible: ${result.detail}` : "Not eligible. Hold a tier or $10 of PAYHOLE.";
    default:
      return result.detail ?? `Not accepted (${result.status}).`;
  }
}

/** One line per report: its status, the amount when it pays, who agreed, and what the probes saw while it waits. */
export function describeEntry(entry: RewardEntry): string {
  const words: Record<RewardStatus, string> = { payable: "payable", pending: "waiting", capped: "over daily cap", paid: "paid", void: "not paid" };
  const agreed = entry.review ? "reviewed" : entry.corroboration?.startsWith("list:") ? "list" : entry.corroboration ? "swarm" : null;
  const seen = entry.status === "pending" && entry.evidence ? (entry.evidence.marks[0] ?? "checked, nothing found") : null;
  return [words[entry.status], entry.status === "payable" || entry.status === "paid" ? `${entry.amount.toFixed(2)} USDG` : null, agreed, seen].filter((part) => part !== null).join(" · ");
}
