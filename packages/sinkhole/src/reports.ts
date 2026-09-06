import type { Blocklist } from "./blocklist.js";
import type { Hints } from "./hints.js";
import type { AnySwarmMessage, VerifyResult } from "./swarm/messages.js";

/**
 * Reports from phones and browsers, through `POST /report`. A plain report is a hint: counted, never
 * blocking. A signed report carries a swarm message signed by a key a tier holder delegated to, and
 * counts exactly like a flag from that holder's node: it is recorded here and relayed to the swarm.
 */

export interface ReportInput {
  name?: unknown;
  category?: unknown;
  reason?: unknown;
  /** A full swarm message with a `delegate`, signed on the phone; see messages.ts. */
  message?: unknown;
}

export type ReportResult =
  | { status: "hinted"; domain: string; hints: number }
  | { status: "already_blocked" | "allowlisted"; domain: string }
  | { status: "flagged" | "confirmed"; domain: string; reporters: number }
  | { status: "invalid" | "rejected"; detail: string };

export interface ReporterDeps {
  blocklist: Pick<Blocklist, "inspect" | "recordFlag">;
  hints: Pick<Hints, "record">;
  /** Verifies a signed report against the swarm rules and the reporter's tier; absent when this node cannot. */
  verify?: ((raw: string) => Promise<VerifyResult>) | undefined;
  /** Relays an accepted signed report to the swarm; absent on a node without one. */
  publish?: ((message: AnySwarmMessage) => Promise<unknown>) | undefined;
  /** Signed reports are refused until every node in the swarm understands delegated signatures. */
  acceptDelegates: boolean;
  log?: ((line: string) => void) | undefined;
  clock?: (() => number) | undefined;
}

export function createReporter(deps: ReporterDeps): (input: ReportInput) => Promise<ReportResult> {
  const log = deps.log ?? (() => undefined);
  const clock = deps.clock ?? Date.now;
  return async (input) => {
    if (input.message !== undefined) {
      if (!deps.acceptDelegates || !deps.verify) return { status: "rejected", detail: "signed reports are not accepted by this node yet" };
      let raw: string;
      try {
        raw = JSON.stringify(input.message);
      } catch {
        return { status: "invalid", detail: "message is not serialisable" };
      }
      const verified = await deps.verify(raw);
      if (!verified.ok) return { status: "rejected", detail: `${verified.reason}: ${verified.detail}` };
      const message = verified.message;
      if (message.kind !== "flag") return { status: "rejected", detail: "only flags can be reported" };
      if (!message.delegate) return { status: "rejected", detail: "a reported message must be signed by a delegated key" };
      const now = clock();
      const result = deps.blocklist.recordFlag(message.body.domain, message.reporter, message.body.reason, message.body.ts, now, message.body.category ?? "phishing");
      if (!result) return { status: "invalid", detail: "the flagged name is not a hostname" };
      if (deps.publish) {
        try {
          await deps.publish(message);
        } catch (error) {
          log(`could not relay a report for ${result.domain}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      if (result.changed) log(`report confirmed ${result.domain} (${result.reporters} reporters, via ${message.delegate})`);
      return { status: result.confirmed ? "confirmed" : "flagged", domain: result.domain, reporters: result.reporters };
    }
    const inspection = typeof input.name === "string" ? deps.blocklist.inspect(input.name) : null;
    if (!inspection) return { status: "invalid", detail: "name is not a hostname" };
    if (inspection.allowlisted) return { status: "allowlisted", domain: inspection.domain };
    if (inspection.blocked) return { status: "already_blocked", domain: inspection.domain };
    const hint = deps.hints.record(inspection.domain, input.category, input.reason, clock());
    if (!hint) return { status: "invalid", detail: "name is not a hostname" };
    return { status: "hinted", domain: hint.domain, hints: hint.count };
  };
}
