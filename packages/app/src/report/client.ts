// Sends a report to the resolver's public report route and puts the answer into words.

import type { Category } from "../dns/verdict";
import type { DelegatedFlag } from "./identity";

export interface ReportInput {
  name?: string;
  category?: Category;
  reason?: string;
  message?: DelegatedFlag;
  /** Signed hint fields; see identity.ts. */
  key?: string;
  payTo?: string | null;
  ts?: number;
  signature?: string;
}

export type RewardStatus = "payable" | "pending" | "capped" | "paid" | "void";

export interface RewardEntry {
  domain: string;
  category: Category | null;
  amount: number;
  status: RewardStatus;
  reportedAt: number;
  confirmedAt: number | null;
  corroboration: string | null;
  paidTx: string | null;
  /** What the resolver's probes found, once they ran. */
  evidence: { score: number; marks: string[] } | null;
  /** The project's verdict on the report, when it gave one. */
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

export type ReportResult =
  | { status: "hinted"; domain: string; hints: number }
  | { status: "already_blocked" | "allowlisted"; domain: string }
  | { status: "flagged" | "confirmed"; domain: string; reporters: number }
  | { status: "invalid" | "rejected"; detail: string };

export class ReportError extends Error {}

const STATUSES = new Set(["hinted", "already_blocked", "allowlisted", "flagged", "confirmed", "invalid", "rejected"]);

export async function sendReport(url: string, input: ReportInput, fetchImpl: typeof fetch = fetch): Promise<ReportResult> {
  const response = await fetchImpl(url, { method: "POST", headers: { "content-type": "application/json", accept: "application/json" }, body: JSON.stringify(input) });
  if (response.status === 429) throw new ReportError("The resolver is rate limiting this connection. Try again in a minute.");
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new ReportError(`The resolver did not answer the report (${response.status}).`);
  }
  const status = typeof body === "object" && body !== null ? (body as { status?: unknown }).status : undefined;
  if (typeof status !== "string" || !STATUSES.has(status)) throw new ReportError("The resolver's answer was not a report result.");
  return body as ReportResult;
}

/** The line shown after a report; short, because it sits under a button. */
export function describeReport(result: ReportResult, linked: boolean): string {
  switch (result.status) {
    case "hinted":
      return `Counted. ${result.hints === 1 ? "First report." : `${result.hints} reports so far.`}${linked ? "" : " Link a tier to flag."}`;
    case "flagged":
      return `Flagged. ${result.reporters} reporter${result.reporters === 1 ? "" : "s"} so far.`;
    case "confirmed":
      return "Confirmed. Blocked on every node.";
    case "already_blocked":
      return "Already blocked.";
    case "allowlisted":
      return "Allowlisted. Stays reachable.";
    case "invalid":
    case "rejected":
      return result.detail;
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function num(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

const REWARD_STATUSES = new Set(["payable", "pending", "capped", "paid", "void"]);

/** What the resolver owes a rewards wallet, and every report behind it. */
export async function fetchRewards(url: string, wallet: string, fetchImpl: typeof fetch = fetch): Promise<RewardsSummary> {
  const response = await fetchImpl(`${url}?wallet=${encodeURIComponent(wallet)}`, { headers: { accept: "application/json" } });
  if (response.status === 429) throw new ReportError("The resolver is rate limiting this connection. Try again in a minute.");
  if (!response.ok) throw new ReportError(`The resolver refused the request (${response.status}).`);
  const body = record(await response.json());
  if (!body) throw new ReportError("The resolver's answer was not a rewards summary.");
  const eligibleRaw = record(body["eligible"]);
  const claimRaw = record(body["claim"]);
  const entries: RewardEntry[] = [];
  for (const item of Array.isArray(body["entries"]) ? body["entries"] : []) {
    const entry = record(item);
    if (!entry || typeof entry["domain"] !== "string") continue;
    const status = typeof entry["status"] === "string" && REWARD_STATUSES.has(entry["status"]) ? (entry["status"] as RewardStatus) : "pending";
    const evidenceRaw = record(entry["evidence"]);
    const reviewRaw = record(entry["review"]);
    const verdict = reviewRaw?.["verdict"];
    entries.push({
      domain: entry["domain"],
      category: typeof entry["category"] === "string" ? (entry["category"] as Category) : null,
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
export async function requestPayout(url: string, wallet: string, fetchImpl: typeof fetch = fetch): Promise<{ status: string; detail: string | null }> {
  const response = await fetchImpl(url, { method: "POST", headers: { "content-type": "application/json", accept: "application/json" }, body: JSON.stringify({ wallet }) });
  if (response.status === 429) throw new ReportError("The resolver is rate limiting this connection. Try again in a minute.");
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
      return result.detail ?? "Wallet not eligible yet.";
    default:
      return result.detail ?? `Not accepted (${result.status}).`;
  }
}
