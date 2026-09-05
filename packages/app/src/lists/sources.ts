/** The block lists loaded on the public resolver, with a GitHub freshness lookup for each. */

export interface ListSource {
  id: string;
  name: string;
  summary: string;
  approximateEntries: string;
  license: string;
  homepage: string;
  repo: string;
  path: string;
}

export const LIST_SOURCES: readonly ListSource[] = [
  {
    id: "scamsniffer",
    name: "ScamSniffer scam database",
    summary:
      "Phishing pages, wallet drainers, fake airdrops, and impersonation sites reported across web3, published daily as JSON.",
    approximateEntries: "about 350,000 domains",
    license: "GPL-3.0",
    homepage: "https://github.com/scamsniffer/scam-database",
    repo: "scamsniffer/scam-database",
    path: "blacklist/domains.json",
  },
  {
    id: "phishing-database",
    name: "Phishing.Database active domains",
    summary:
      "Phishing domains confirmed live by automated testing, across banks, mail providers, parcel services, and everything else that gets impersonated.",
    approximateEntries: "about 390,000 domains",
    license: "MIT",
    homepage: "https://github.com/Phishing-Database/Phishing.Database",
    repo: "Phishing-Database/Phishing.Database",
    path: "phishing-domains-ACTIVE.txt",
  },
  {
    id: "stevenblack",
    name: "StevenBlack unified hosts",
    summary:
      "The long-running merge of ad, tracker, and malware host lists that most home DNS blockers start from.",
    approximateEntries: "about 100,000 hosts",
    license: "MIT",
    homepage: "https://github.com/StevenBlack/hosts",
    repo: "StevenBlack/hosts",
    path: "hosts",
  },
];

interface CommitLike {
  commit?: { committer?: { date?: unknown }; author?: { date?: unknown } };
}

/** Pulls the commit date out of a GitHub commits API payload, or null if it is not there. */
export function parseCommitDate(payload: unknown): Date | null {
  if (!Array.isArray(payload) || payload.length === 0) return null;
  const first = payload[0] as CommitLike;
  const raw = first.commit?.committer?.date ?? first.commit?.author?.date;
  if (typeof raw !== "string") return null;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** When the list file last changed upstream. Any failure (offline, rate limit) yields null. */
export async function fetchLastUpdated(
  source: ListSource,
  fetchImpl: typeof fetch = fetch,
): Promise<Date | null> {
  try {
    const url = `https://api.github.com/repos/${source.repo}/commits?path=${encodeURIComponent(source.path)}&per_page=1`;
    const response = await fetchImpl(url, { headers: { accept: "application/vnd.github+json" } });
    if (!response.ok) return null;
    return parseCommitDate(await response.json());
  } catch {
    return null;
  }
}

/** "today", "yesterday", or "N days ago" relative to `now`. */
export function formatAge(date: Date, now: Date = new Date()): string {
  const dayMs = 24 * 60 * 60 * 1000;
  const days = Math.floor((now.getTime() - date.getTime()) / dayMs);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  return `${days} days ago`;
}
