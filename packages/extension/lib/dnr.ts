import type { Browser } from "wxt/browser";

/** Session rule ids for navigation retries live in this range; ids rotate inside it. */
export const NAVIGATION_RULE_ID_MIN = 100_000;
export const NAVIGATION_RULE_ID_MAX = 199_999;
export const NAVIGATION_RULE_TTL_MS = 60_000;

let nextId = NAVIGATION_RULE_ID_MIN;

export function allocateRuleId(): number {
  const id = nextId;
  nextId = nextId >= NAVIGATION_RULE_ID_MAX ? NAVIGATION_RULE_ID_MIN : nextId + 1;
  return id;
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Condition matching exactly one URL. `urlFilter` anchors with `|`; URLs that contain filter metacharacters use an
 * anchored `regexFilter` instead. Both are matched against the punycode, percent-encoded form Chrome sees.
 */
export function exactUrlCondition(url: string): Pick<Browser.declarativeNetRequest.RuleCondition, "urlFilter" | "regexFilter" | "isUrlFilterCaseSensitive"> {
  const href = new URL(url).href;
  if (/[|^*]/.test(href)) return { regexFilter: `^${escapeRegex(href)}$`, isUrlFilterCaseSensitive: true };
  return { urlFilter: `|${href}|`, isUrlFilterCaseSensitive: true };
}

/** A session rule that attaches the payment header to one tab's next top-level request for `url`. */
export function navigationRule(
  id: number,
  url: string,
  tabId: number,
  headerName: string,
  headerValue: string,
): Browser.declarativeNetRequest.Rule {
  return {
    id,
    priority: 1,
    action: {
      type: "modifyHeaders",
      requestHeaders: [{ header: headerName, operation: "set", value: headerValue }],
    },
    condition: {
      ...exactUrlCondition(url),
      resourceTypes: ["main_frame"],
      tabIds: [tabId],
    },
  };
}

export function isNavigationRuleId(id: number): boolean {
  return id >= NAVIGATION_RULE_ID_MIN && id <= NAVIGATION_RULE_ID_MAX;
}
