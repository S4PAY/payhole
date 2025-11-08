'use client';

import { AnalyticsMetrics } from '@/hooks/useAdminAnalytics';

type AnalyticsCardsProps = {
  metrics: AnalyticsMetrics;
};

const cardStyles =
  'rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md';

function formatNumber(value: number): string {
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1)}M`;
  }
  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(1)}K`;
  }
  return value.toLocaleString();
}

export default function AnalyticsCards({ metrics }: AnalyticsCardsProps) {
  return (
    <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      <article className={cardStyles} data-testid="metric-dau">
        <h3 className="text-sm font-medium text-slate-500">Daily Active Users</h3>
        <p className="mt-2 text-2xl font-semibold text-slate-900">{formatNumber(metrics.dau)}</p>
      </article>

      <article className={cardStyles} data-testid="metric-paid-users">
        <h3 className="text-sm font-medium text-slate-500">Paid Users</h3>
        <p className="mt-2 text-2xl font-semibold text-slate-900">{formatNumber(metrics.paidUsers)}</p>
      </article>

      <article className={cardStyles} data-testid="metric-blocked-requests">
        <h3 className="text-sm font-medium text-slate-500">Blocked Requests</h3>
        <p className="mt-2 text-2xl font-semibold text-slate-900">{formatNumber(metrics.blockedRequests)}</p>
      </article>

      <article className={cardStyles} data-testid="metric-revenue">
        <h3 className="text-sm font-medium text-slate-500">Revenue ({metrics.revenue.currency})</h3>
        <div className="mt-2 flex flex-col text-slate-900">
          <span className="text-2xl font-semibold">
            {metrics.revenue.daily.toLocaleString(undefined, { maximumFractionDigits: 2 })}
          </span>
          <span className="text-xs text-slate-500">
            Monthly: {metrics.revenue.monthly.toLocaleString(undefined, { maximumFractionDigits: 2 })}
          </span>
        </div>
      </article>
    </section>
  );
}


