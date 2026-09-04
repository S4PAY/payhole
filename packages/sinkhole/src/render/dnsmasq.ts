import { isIP } from "node:net";

export interface DnsmasqSettings {
  /** Address dnsmasq binds; an IP literal. */
  listen: string;
  port: number;
  /** Upstream resolvers as `ip` or `ip#port`. */
  upstream: string[];
  cacheSize: number;
  /** Absolute path of the rendered blocklist, included with `conf-file=`. */
  blocklistFile: string;
  /** Unprivileged user dnsmasq switches to after binding; omitted when undefined. */
  user?: string | undefined;
}

/** Validates one `UPSTREAM_DNS` entry: an IPv4 or IPv6 literal with an optional `#port`. */
export function isUpstream(value: string): boolean {
  const [host, port, ...rest] = value.split("#");
  if (rest.length > 0 || host === undefined || isIP(host) === 0) return false;
  if (port === undefined) return true;
  return /^\d{1,5}$/.test(port) && Number(port) >= 1 && Number(port) <= 65535;
}

function safe(value: string, name: string): string {
  if (/[\r\n\0]/.test(value)) throw new Error(`${name} must not contain line breaks`);
  return value;
}

/**
 * Renders the main dnsmasq configuration. Query logging is deliberately absent: the Sinkhole never
 * observes what is resolved, only which names are blocked.
 */
export function renderDnsmasqConfig(settings: DnsmasqSettings): string {
  if (isIP(settings.listen) === 0) throw new Error("listen must be an IP address");
  if (!Number.isInteger(settings.port) || settings.port < 1 || settings.port > 65535) throw new Error("port out of range");
  if (settings.upstream.length === 0) throw new Error("at least one upstream resolver is required");
  for (const server of settings.upstream) {
    if (!isUpstream(server)) throw new Error(`upstream ${JSON.stringify(server)} is not ip or ip#port`);
  }
  if (!Number.isInteger(settings.cacheSize) || settings.cacheSize < 0) throw new Error("cacheSize must be a non-negative integer");
  const lines = [
    "# Rendered by the PayHole Sinkhole agent. Edits are overwritten.",
    `port=${settings.port}`,
    `listen-address=${settings.listen}`,
    "bind-interfaces",
    "no-resolv",
    "no-poll",
    "no-hosts",
    "domain-needed",
    "bogus-priv",
    `cache-size=${settings.cacheSize}`,
    "local-ttl=60",
    ...settings.upstream.map((server) => `server=${server}`),
    ...(settings.user ? [`user=${safe(settings.user, "user")}`] : []),
    `conf-file=${safe(settings.blocklistFile, "blocklistFile")}`,
    "",
  ];
  return lines.join("\n");
}

/**
 * Renders the blocklist include: one `address=/<domain>/0.0.0.0` per domain, which makes dnsmasq answer
 * the domain and every subdomain with 0.0.0.0, plus the matching `::` line so AAAA lookups are sunk too.
 * Output is sorted and de-duplicated so two renders of the same set are byte-identical.
 */
export function renderBlocklistConfig(domains: Iterable<string>): string {
  const sorted = [...new Set(domains)].sort();
  const lines = ["# Rendered by the PayHole Sinkhole agent. Edits are overwritten.", `# ${sorted.length} blocked domains`];
  for (const domain of sorted) {
    if (/[\s/#]/.test(domain)) throw new Error(`refusing to render unsafe domain ${JSON.stringify(domain)}`);
    lines.push(`address=/${domain}/0.0.0.0`);
    lines.push(`address=/${domain}/::`);
  }
  lines.push("");
  return lines.join("\n");
}

/** Command line for dnsmasq as the agent spawns it. */
export function dnsmasqArgs(configFile: string): string[] {
  return ["--keep-in-foreground", "--no-resolv", "--log-facility=-", `--conf-file=${configFile}`];
}
