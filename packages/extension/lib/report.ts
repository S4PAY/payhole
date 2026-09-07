/** Reporting a name to the public resolver: the same `POST /report` the app uses, as a plain hint. */
import { isCategory, type Category } from "./shield";

export interface ReportInput {
  name: string;
  category?: Category | undefined;
  reason?: string | undefined;
}

export type ReportResult =
  | { status: "hinted"; domain: string; hints: number }
  | { status: "already_blocked" | "allowlisted"; domain: string }
  | { status: "flagged" | "confirmed"; domain: string; reporters: number }
  | { status: "invalid" | "rejected"; detail: string };

const STATUSES = new Set(["hinted", "already_blocked", "allowlisted", "flagged", "confirmed", "invalid", "rejected"]);

export class ReportError extends Error {}

/** Sends one plain report and returns the resolver's answer. */
export async function sendReport(resolver: string, input: ReportInput, fetchImpl: typeof fetch = fetch): Promise<ReportResult> {
  const body: Record<string, unknown> = { name: input.name };
  if (isCategory(input.category)) body["category"] = input.category;
  if (input.reason && input.reason.trim().length > 0) body["reason"] = input.reason.trim().slice(0, 200);
  return postReport(resolver, body, fetchImpl);
}

/** Posts any report body, signed hint or delegated flag included. Throws on network trouble or an answer that is not a report result. */
export async function postReport(resolver: string, body: Record<string, unknown>, fetchImpl: typeof fetch = fetch): Promise<ReportResult> {
  const response = await fetchImpl(`${resolver.replace(/\/+$/, "")}/report`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(body),
  });
  if (response.status === 429) throw new ReportError("The resolver is rate limiting this browser. Try again in a minute.");
  let parsed: unknown;
  try {
    parsed = await response.json();
  } catch {
    throw new ReportError(`The resolver did not answer the report (${response.status}).`);
  }
  const status = typeof parsed === "object" && parsed !== null ? (parsed as { status?: unknown }).status : undefined;
  if (typeof status !== "string" || !STATUSES.has(status)) throw new ReportError("The resolver's answer was not a report result.");
  return parsed as ReportResult;
}

/** What the answer means, in a few words. */
export function describeReport(result: ReportResult): string {
  switch (result.status) {
    case "hinted":
      return result.hints === 1 ? "Counted. First report." : `Counted. ${result.hints} reports now.`;
    case "flagged":
      return `Flagged. ${result.reporters} reporter${result.reporters === 1 ? "" : "s"} so far.`;
    case "confirmed":
      return "Confirmed. Blocked network-wide.";
    case "already_blocked":
      return "Already blocked.";
    case "allowlisted":
      return "On the allowlist. Not counted.";
    case "invalid":
      return `Not a name: ${result.detail}`;
    case "rejected":
      return `Not accepted: ${result.detail}`;
  }
}
