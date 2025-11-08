'use client';

import { useEffect, useMemo, useState } from 'react';

type AnalyticsSummary = {
  totalBlocked: number;
  blockedByReason: Record<string, number>;
  updatedAt: string | null;
};

const DEFAULT_SUMMARY: AnalyticsSummary = {
  totalBlocked: 0,
  blockedByReason: {},
  updatedAt: null,
};

export function useAnalyticsSummary(refreshMs = 10_000) {
  const [summary, setSummary] = useState<AnalyticsSummary>(DEFAULT_SUMMARY);
  const [error, setError] = useState<string | undefined>();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    async function load() {
      try {
        const response = await fetch('/api/analytics/summary', { cache: 'no-store' });
        if (!response.ok) {
          const payload = await response.json().catch(() => ({}));
          throw new Error(payload.error ?? 'Failed to fetch analytics summary');
        }
        const data = (await response.json()) as AnalyticsSummary;
        if (mounted) {
          setSummary({
            totalBlocked: data.totalBlocked ?? 0,
            blockedByReason: data.blockedByReason ?? {},
            updatedAt: data.updatedAt ?? null,
          });
          setError(undefined);
          setLoading(false);
        }
      } catch (err) {
        if (mounted) {
          const message = err instanceof Error ? err.message : 'Failed to fetch analytics summary';
          setError(message);
          setLoading(false);
        }
      }
    }

    load();

    const interval = setInterval(load, refreshMs);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, [refreshMs]);

  return useMemo(
    () => ({
      ...summary,
      error,
      loading,
    }),
    [summary, error, loading]
  );
}

