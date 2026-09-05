import type { HistoryBucket } from "../../modules/payhole-dns";
import { formatCount } from "../theme";

export interface Bar {
  /** Height of the whole slice in pixels. */
  total: number;
  /** Height of the blocked part, drawn over the base of the slice. */
  blocked: number;
}

/**
 * Pixel heights for each slice, scaled so the busiest one fills `height`. Anything that is not
 * zero gets at least two pixels so a single blocked lookup still shows.
 */
export function scaleBars(buckets: readonly HistoryBucket[], height: number): Bar[] {
  const peak = buckets.reduce((max, bucket) => Math.max(max, bucket.queries, bucket.blocked), 0);
  if (peak <= 0) return buckets.map(() => ({ total: 0, blocked: 0 }));
  const px = (value: number) => (value <= 0 ? 0 : Math.max(2, Math.round((value / peak) * height)));
  return buckets.map((bucket) => ({
    total: px(Math.max(bucket.queries, bucket.blocked)),
    blocked: px(bucket.blocked),
  }));
}

export interface HistorySummary {
  queries: number;
  blocked: number;
  /** Lookups in the busiest slice. */
  peak: number;
  /** Slices with at least one lookup. */
  activeSlices: number;
}

export function summarizeHistory(buckets: readonly HistoryBucket[]): HistorySummary {
  return buckets.reduce<HistorySummary>(
    (summary, bucket) => ({
      queries: summary.queries + bucket.queries,
      blocked: summary.blocked + bucket.blocked,
      peak: Math.max(summary.peak, bucket.queries),
      activeSlices: summary.activeSlices + (bucket.queries > 0 ? 1 : 0),
    }),
    { queries: 0, blocked: 0, peak: 0, activeSlices: 0 },
  );
}

/** One line under the chart. */
export function describeHistory(summary: HistorySummary): string {
  if (summary.queries === 0) return "Nothing recorded yet. Slices fill in as your phone looks names up.";
  const share = summary.blocked === 0 ? "nothing blocked so far" : `${formatCount(summary.blocked)} blocked`;
  return `Busiest half hour: ${formatCount(summary.peak)} lookups. ${capitalize(share)} in the last 24 hours.`;
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
