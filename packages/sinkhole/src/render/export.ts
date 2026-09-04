import type { MergedEntry } from "../blocklist.js";

export const EXPORT_FORMATS = ["hosts", "dnsmasq", "plain", "json"] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

export function isExportFormat(value: string): value is ExportFormat {
  return (EXPORT_FORMATS as readonly string[]).includes(value);
}

function byDomain(a: MergedEntry, b: MergedEntry): number {
  return a.domain < b.domain ? -1 : a.domain > b.domain ? 1 : 0;
}

/** Renders the merged blocklist in one of the supported download formats. */
export function renderExport(format: ExportFormat, entries: MergedEntry[], generatedAt: string): { body: string; contentType: string } {
  const sorted = [...entries].sort(byDomain);
  const header = `# PayHole Sinkhole blocklist, ${sorted.length} entries, generated ${generatedAt}`;
  switch (format) {
    case "hosts":
      return { contentType: "text/plain; charset=utf-8", body: [header, ...sorted.map((e) => `0.0.0.0 ${e.domain}`), ""].join("\n") };
    case "dnsmasq":
      return { contentType: "text/plain; charset=utf-8", body: [header, ...sorted.map((e) => `address=/${e.domain}/0.0.0.0`), ""].join("\n") };
    case "plain":
      return { contentType: "text/plain; charset=utf-8", body: sorted.map((e) => `${e.domain}\n`).join("") };
    case "json":
      return {
        contentType: "application/json; charset=utf-8",
        body: JSON.stringify({ version: 1, generatedAt, count: sorted.length, entries: sorted }, null, 2) + "\n",
      };
  }
}
