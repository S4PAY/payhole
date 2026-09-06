// Sends a report to the resolver's public report route and puts the answer into words.

import type { Category } from "../dns/verdict";
import type { DelegatedFlag } from "./identity";

export interface ReportInput {
  name?: string;
  category?: Category;
  reason?: string;
  message?: DelegatedFlag;
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

/** The sentence shown after a report; `linked` says whether this phone reports for a tier holder. */
export function describeReport(result: ReportResult, linked: boolean): string {
  switch (result.status) {
    case "hinted": {
      const count = result.hints === 1 ? "Yours is the first report" : `${result.hints} reports so far`;
      return `Counted. ${count} for ${result.domain}. Nothing blocks on reports alone; a tier holder has to confirm it.${linked ? "" : " Link a tier and reports from this phone count as flags."}`;
    }
    case "flagged":
      return `Flagged as your wallet's report. ${result.reporters} reporter${result.reporters === 1 ? "" : "s"} so far; ${result.domain} blocks everywhere once enough agree, or at once if a list already names it.`;
    case "confirmed":
      return `Confirmed. ${result.domain} is now blocked on every node.`;
    case "already_blocked":
      return `${result.domain} is already blocked.`;
    case "allowlisted":
      return `${result.domain} is on the allowlist, a shared platform that stays reachable on purpose.`;
    case "invalid":
    case "rejected":
      return result.detail;
  }
}
