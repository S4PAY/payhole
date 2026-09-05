import { normalizeHostname } from "./hostname.js";

/**
 * Names a node never blocks, whatever a subscribed list or the swarm says. A rule is either an exact name
 * (`example.com`) or a suffix written with a leading dot (`.example.com`; `*.example.com` is accepted too),
 * which protects the name and everything under it. Hosts-file lines and `#` comments are accepted, so a
 * blocklist can be pasted in and inverted. Rules are plain strings so they round-trip through the same
 * cache files as blocklists: exact names as they are, suffixes with their leading dot.
 */
export function parseAllowlistText(text: string): { domains: Set<string>; invalid: number } {
  const domains = new Set<string>();
  let invalid = 0;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    if (line.length === 0) continue;
    const tokens = line.split(/\s+/);
    const names = tokens.length > 1 && isAddressToken(tokens[0]) ? tokens.slice(1) : tokens;
    for (const name of names) {
      const rule = parseRule(name);
      if (rule === null) invalid += 1;
      else domains.add(rule);
    }
  }
  return { domains, invalid };
}

function isAddressToken(token: string | undefined): boolean {
  return token !== undefined && (/^[0-9.]+$/.test(token) || token.includes(":"));
}

/** One rule: the normalized exact name, or the normalized name with a leading dot for a suffix rule. */
export function parseRule(name: string): string | null {
  let value = name;
  let suffix = false;
  if (value.startsWith("*.")) {
    suffix = true;
    value = value.slice(2);
  } else if (value.startsWith(".")) {
    suffix = true;
    value = value.slice(1);
  }
  const host = normalizeHostname(value);
  if (host === null) return null;
  return suffix ? `.${host}` : host;
}

export class Allowlist {
  private readonly exact = new Set<string>();
  private readonly suffixes = new Set<string>();

  constructor(rules: Iterable<string>) {
    for (const rule of rules) {
      if (rule.startsWith(".")) this.suffixes.add(rule.slice(1));
      else this.exact.add(rule);
    }
  }

  get size(): number {
    return this.exact.size + this.suffixes.size;
  }

  /** True when the normalized `domain` has an exact rule, or a suffix rule on itself or on a parent. */
  allows(domain: string): boolean {
    if (this.exact.has(domain)) return true;
    if (this.suffixes.size === 0) return false;
    let rest = domain;
    while (rest.length > 0) {
      if (this.suffixes.has(rest)) return true;
      const dot = rest.indexOf(".");
      if (dot === -1) break;
      rest = rest.slice(dot + 1);
    }
    return false;
  }

  /** `domains` without the protected names. The same set comes back when there is nothing to remove. */
  filter(domains: ReadonlySet<string>): ReadonlySet<string> {
    if (this.size === 0) return domains;
    let out: Set<string> | null = null;
    for (const domain of domains) {
      if (!this.allows(domain)) continue;
      out ??= new Set(domains);
      out.delete(domain);
    }
    return out ?? domains;
  }
}
