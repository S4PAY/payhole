import type { Hint, Probe } from "./hints.js";

/**
 * The node's own verdicts. A report does not wait for a person when the evidence is plain: a page that asks for
 * a seed phrase on a domain registered this week confirms itself; a name that has not resolved on two checks a
 * day apart closes itself. Everything in between keeps waiting for the swarm, a list, or the project.
 */

export interface AutopilotOptions {
  /** Evidence score at or above which a report confirms on its own; 0 turns this off. */
  confirmScore: number;
  /** Two failed resolutions at least this far apart close a report. */
  deadHours: number;
}

export type Decision = { action: "confirm"; note: string } | { action: "close"; note: string } | { action: "wait"; reason: string };

const HOUR = 60 * 60 * 1000;

/** What to do about one reported name, from its evidence and the probes so far. */
export function decide(hint: Pick<Hint, "domain" | "evidence" | "probes">, options: AutopilotOptions): Decision {
  const evidence = hint.evidence;
  if (!evidence) return { action: "wait", reason: "no evidence yet" };
  if (options.confirmScore > 0 && evidence.resolves && evidence.score >= options.confirmScore) {
    return { action: "confirm", note: `evidence ${evidence.score}: ${evidence.marks.join("; ")}`.slice(0, 200) };
  }
  const probes = hint.probes ?? [];
  const last = probes[probes.length - 1];
  const previous = probes[probes.length - 2];
  if (last && previous && !last.resolves && !previous.resolves && last.at - previous.at >= options.deadHours * HOUR) {
    const hours = Math.round((last.at - previous.at) / HOUR);
    return { action: "close", note: `did not resolve on two checks ${hours} hours apart` };
  }
  if (!evidence.resolves) return { action: "wait", reason: "does not resolve; checking again later" };
  return { action: "wait", reason: `evidence ${evidence.score}, below ${options.confirmScore}` };
}

/** Whether a name is due for another probe: none yet, or the last one is older than the dead-check spacing. */
export function probeDue(probes: readonly Probe[] | undefined, now: number, options: AutopilotOptions): boolean {
  const last = probes?.[probes.length - 1];
  return !last || now - last.at >= options.deadHours * HOUR;
}
