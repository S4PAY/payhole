/** Everything the spending policy looks at; all amounts are USDG base units. */
export interface PolicyInput {
  amount: bigint;
  paused: boolean;
  blocked: boolean;
  siteCap: bigint;
  siteSpent: bigint;
  globalCap: bigint;
  globalSpent: bigint;
  /** A prompt was already shown for this observed offer. */
  alreadyPrompted: boolean;
  /** A payment was already attached to this request; a second 402 is never paid. */
  alreadyAttempted: boolean;
}

export type PolicyDecision = { kind: "pay" } | { kind: "prompt" } | { kind: "refuse"; reason: RefusalReason };

export type RefusalReason = "already-attempted" | "paused" | "blocked" | "prompt-shown" | "no-offer";

/**
 * Silent under both caps, one prompt over either cap, refusal for paused, blocked, repeated, or already prompted
 * offers. Pure so the same rules run in tests and in the background.
 */
export function decide(input: PolicyInput): PolicyDecision {
  if (input.alreadyAttempted) return { kind: "refuse", reason: "already-attempted" };
  if (input.paused) return { kind: "refuse", reason: "paused" };
  if (input.blocked) return { kind: "refuse", reason: "blocked" };
  const underSite = input.siteSpent + input.amount <= input.siteCap;
  const underGlobal = input.globalSpent + input.amount <= input.globalCap;
  if (underSite && underGlobal) return { kind: "pay" };
  if (input.alreadyPrompted) return { kind: "refuse", reason: "prompt-shown" };
  return { kind: "prompt" };
}

export function describeRefusal(reason: RefusalReason): string {
  switch (reason) {
    case "already-attempted":
      return "a payment was already attached to this request";
    case "paused":
      return "payments are paused";
    case "blocked":
      return "the site is on the blocklist";
    case "prompt-shown":
      return "the request was already declined";
    case "no-offer":
      return "no acceptable payment option";
  }
}
