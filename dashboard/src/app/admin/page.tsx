'use client';

import { FormEvent, useState } from 'react';
import AnalyticsCards from '@/components/admin/AnalyticsCards';
import { useAdminAnalytics } from '@/hooks/useAdminAnalytics';

export default function AdminPage() {
  const { metrics, loading, error, token, authenticate, logout, refresh } = useAdminAnalytics();
  const [inputToken, setInputToken] = useState('');

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    await authenticate(inputToken.trim());
    setInputToken('');
  };

  return (
    <main className="mx-auto flex min-h-screen max-w-5xl flex-col gap-8 px-6 py-12">
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold text-slate-900">Admin Analytics</h1>
        <p className="text-sm text-slate-600">
          Review real-time PayHole telemetry. Access requires an admin JWT issued by the payments service.
        </p>
      </header>

      {!token && (
        <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-900">Admin Authentication</h2>
          <p className="mt-2 text-sm text-slate-600">
            Provide a valid admin token to unlock analytics. Tokens expire after issuance and should be stored securely.
          </p>
          <form className="mt-4 flex flex-col gap-3" onSubmit={handleSubmit}>
            <label htmlFor="admin-token" className="text-sm font-medium text-slate-700">
              Admin JWT
            </label>
            <input
              id="admin-token"
              name="admin-token"
              value={inputToken}
              onChange={(event) => setInputToken(event.target.value)}
              className="w-full rounded-lg border border-slate-300 px-4 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200"
              placeholder="eyJhbGciOiJIUzI1..."
              autoComplete="off"
              required
            />
            <button
              type="submit"
              className="inline-flex items-center justify-center rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:bg-slate-400"
              disabled={loading}
            >
              {loading ? 'Verifying…' : 'Unlock analytics'}
            </button>
          </form>
          {error ? (
            <p className="mt-3 text-sm text-rose-600" role="alert">
              {error}
            </p>
          ) : null}
        </section>
      )}

      {token && (
        <section className="flex flex-col gap-4 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">Overview</h2>
              <p className="text-sm text-slate-600">
                Metrics refresh on demand. Last sync:{' '}
                {metrics?.updatedAt ? new Date(metrics.updatedAt).toLocaleString() : 'pending'}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => refresh()}
                className="inline-flex items-center justify-center rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={loading}
              >
                {loading ? 'Refreshing…' : 'Refresh'}
              </button>
              <button
                type="button"
                onClick={logout}
                className="inline-flex items-center justify-center rounded-lg border border-rose-200 bg-rose-50 px-3 py-1.5 text-sm font-medium text-rose-700 hover:bg-rose-100"
              >
                Sign out
              </button>
            </div>
          </div>
          {error ? (
            <p className="text-sm text-rose-600" role="alert">
              {error}
            </p>
          ) : null}
          {metrics ? <AnalyticsCards metrics={metrics} /> : null}
        </section>
      )}
    </main>
  );
}


