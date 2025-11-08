'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { AnalyticsMetrics, fetchAnalytics } from '@/lib/analytics';

const ADMIN_TOKEN_STORAGE_KEY = 'payhole.admin.jwt';

type LoadingState = 'idle' | 'loading' | 'error' | 'success';

const METRIC_LABELS: Record<keyof AnalyticsMetrics, string> = {
  dau: 'Daily Active Users',
  paidUsers: 'Active Paid Users',
  blockedRequests: 'Blocked Requests',
  revenue: 'Revenue (USDC)',
};

function formatValue(key: keyof AnalyticsMetrics, value: number) {
  if (key === 'revenue') {
    return `${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDC`;
  }
  return value.toLocaleString();
}

export default function AdminAnalyticsPage() {
  const [token, setToken] = useState<string>('');
  const [metrics, setMetrics] = useState<AnalyticsMetrics | null>(null);
  const [status, setStatus] = useState<LoadingState>('idle');
  const [error, setError] = useState<string | null>(null);

  const loadAnalytics = useCallback(
    async (jwt: string) => {
      setStatus('loading');
      setError(null);
      try {
        const data = await fetchAnalytics(jwt);
        setMetrics(data);
        setStatus('success');
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unable to load analytics';
        setError(message);
        setStatus('error');
        setMetrics(null);
      }
    },
    []
  );

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    const storedToken = window.localStorage.getItem(ADMIN_TOKEN_STORAGE_KEY);
    if (storedToken) {
      setToken(storedToken);
      void loadAnalytics(storedToken);
    }
  }, [loadAnalytics]);

  const handleSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const trimmed = token.trim();
      if (!trimmed) {
        setError('Enter a valid admin JWT before loading analytics.');
        setStatus('error');
        return;
      }
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(ADMIN_TOKEN_STORAGE_KEY, trimmed);
      }
      await loadAnalytics(trimmed);
    },
    [token, loadAnalytics]
  );

  const metricEntries = useMemo(() => {
    if (!metrics) {
      return [];
    }
    return Object.entries(METRIC_LABELS).map(([key, label]) => ({
      key: key as keyof AnalyticsMetrics,
      label,
      value: metrics[key as keyof AnalyticsMetrics],
    }));
  }, [metrics]);

  return (
    <main className="mx-auto flex min-h-screen max-w-4xl flex-col gap-8 px-6 py-12">
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold text-slate-900">Admin Analytics</h1>
        <p className="text-sm text-slate-600">
          Provide an admin JWT to unlock daily analytics covering user growth, revenue, and network enforcement trends.
        </p>
      </header>

      <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <form className="flex flex-col gap-4 sm:flex-row sm:items-end" onSubmit={handleSubmit}>
          <div className="flex-1">
            <label className="text-sm font-medium text-slate-700" htmlFor="admin-token">
              Admin JWT
            </label>
            <input
              id="admin-token"
              name="admin-token"
              type="password"
              className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm text-slate-900 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200"
              placeholder="Paste admin token"
              value={token}
              onChange={(event) => {
                setToken(event.target.value);
                setError(null);
              }}
              autoComplete="off"
            />
            <p className="mt-2 text-xs text-slate-500">
              Token is stored locally only. Tokens issued by the payments service grant 30-day access.
            </p>
          </div>
          <div className="flex gap-2">
            <button
              type="submit"
              className="inline-flex items-center justify-center rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:bg-slate-300"
              disabled={status === 'loading'}
            >
              {status === 'loading' ? 'Loading…' : 'Load Analytics'}
            </button>
            <button
              type="button"
              className="inline-flex items-center justify-center rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-400"
              onClick={() => {
                if (typeof window !== 'undefined') {
                  window.localStorage.removeItem(ADMIN_TOKEN_STORAGE_KEY);
                }
                setToken('');
                setMetrics(null);
                setStatus('idle');
                setError(null);
              }}
            >
              Clear Token
            </button>
          </div>
        </form>
        {error ? (
          <p className="mt-4 rounded-lg border border-rose-200 bg-rose-50 px-4 py-2 text-sm text-rose-700" role="alert">
            {error}
          </p>
        ) : null}
      </section>

      {metricEntries.length > 0 && (
        <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-xl font-semibold text-slate-900">Network Pulse</h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            {metricEntries.map(({ key, label, value }) => (
              <article
                key={key}
                className="rounded-lg border border-slate-200 bg-slate-50 px-5 py-4 shadow-sm"
                data-testid={`metric-${key}`}
              >
                <p className="text-xs uppercase tracking-wide text-slate-500">{label}</p>
                <p className="mt-2 text-2xl font-semibold text-slate-900">{formatValue(key, value)}</p>
              </article>
            ))}
          </div>
        </section>
      )}
    </main>
  );
}


