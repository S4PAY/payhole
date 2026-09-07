import { getAddress, isAddress, recoverMessageAddress, type Hex } from "viem";
import type { Blocklist } from "./blocklist.js";
import type { Hints } from "./hints.js";
import { canonicalJson, type AnySwarmMessage, type VerifyResult } from "./swarm/messages.js";

/**
 * Reports from phones and browsers, through `POST /report`. A plain report is a hint: counted, never
 * blocking. A signed report carries a swarm message signed by a key a tier holder delegated to, and
 * counts exactly like a flag from that holder's node: it is recorded here and relayed to the swarm.
 */

export interface ReportInput {
  name?: unknown;
  category?: unknown;
  reason?: unknown;
  /** A signed hint: the phone's reporter key, the wallet rewards go to, the time, and the key's signature over the hint body. */
  key?: unknown;
  payTo?: unknown;
  ts?: unknown;
  signature?: unknown;
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
  /** Called with every new hinted name so evidence can be gathered; absent when evidence is off. */
  onHint?: ((domain: string) => void) | undefined;
  /** Verifies a signed report against the swarm rules and the reporter's tier; absent when this node cannot. */
  verify?: ((raw: string) => Promise<VerifyResult>) | undefined;
  /** Relays an accepted signed report to the swarm; absent on a node without one. */
  publish?: ((message: AnySwarmMessage) => Promise<unknown>) | undefined;
  /** Signed reports are refused until every node in the swarm understands delegated signatures. */
  acceptDelegates: boolean;
  /** Relay accepted signed reports to the swarm; off keeps them on this node while older peers would drop them. */
  relayDelegates?: boolean | undefined;
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
      if (deps.publish && deps.relayDelegates !== false) {
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
    const now = clock();
    const by = await signedBy(input, inspection.domain, now);
    if (typeof by === "string") return { status: "invalid", detail: by };
    const first = !(deps.hints as Hints).get?.(inspection.domain);
    const hint = deps.hints.record(inspection.domain, input.category, input.reason, now, by ?? undefined);
    if (!hint) return { status: "invalid", detail: "name is not a hostname" };
    if (first) deps.onHint?.(hint.domain);
    return { status: "hinted", domain: hint.domain, hints: hint.count };
  };
}

/** The text a phone signs for a hint; the same shape the app builds, keys sorted. */
export function hintText(domain: string, category: unknown, reason: unknown, ts: number, payTo: string | null): string {
  return canonicalJson({ type: "hint", domain, category: typeof category === "string" ? category : null, reason: typeof reason === "string" ? reason : "", ts, payTo });
}

/**
 * The reporter behind a signed hint, null for an unsigned one, or the reason a signature was refused.
 * A hint that carries a key or a wallet must be signed, so nobody can attach a wallet to someone else's report.
 */
async function signedBy(input: ReportInput, domain: string, now: number): Promise<{ key: string; payTo: string | null } | null | string> {
  if (input.key === undefined && input.payTo === undefined && input.signature === undefined) return null;
  if (typeof input.key !== "string" || !isAddress(input.key)) return "key is not an address";
  if (input.payTo !== undefined && input.payTo !== null && (typeof input.payTo !== "string" || !isAddress(input.payTo))) return "payTo is not an address";
  if (typeof input.ts !== "number" || !Number.isFinite(input.ts) || Math.abs(now - input.ts) > 15 * 60_000) return "ts is missing or too far from now";
  if (typeof input.signature !== "string" || !/^0x[0-9a-fA-F]{130}$/.test(input.signature)) return "signature is malformed";
  const payTo = typeof input.payTo === "string" ? getAddress(input.payTo) : null;
  let signer: string;
  try {
    signer = await recoverMessageAddress({ message: hintText(domain, input.category, input.reason, input.ts, payTo), signature: input.signature as Hex });
  } catch {
    return "signature does not verify";
  }
  if (signer.toLowerCase() !== input.key.toLowerCase()) return "signature was not made by key";
  return { key: getAddress(input.key), payTo };
}
