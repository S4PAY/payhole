export type AnalyticsMetrics = {
  dau: number;
  paidUsers: number;
  blockedRequests: number;
  revenue: number;
};

type AnalyticsApiResponse = {
  metrics?: AnalyticsMetrics;
  error?: string;
};

export async function fetchAnalytics(
  token: string,
  fetchFn?: typeof fetch
): Promise<AnalyticsMetrics> {
  if (!token) {
    throw new Error('Admin token is required');
  }

  const client = fetchFn ?? (typeof fetch !== 'undefined' ? fetch : undefined);
  if (!client) {
    throw new Error('fetch is not available in this environment');
  }

  const response = await client('/api/admin/analytics', {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
    },
    cache: 'no-store',
  });

  const raw = await response.text();
  let parsed: AnalyticsApiResponse | null = null;

  if (raw) {
    try {
      parsed = JSON.parse(raw) as AnalyticsApiResponse;
    } catch (error) {
      parsed = null;
    }
  }

  if (!response.ok || !parsed?.metrics) {
    const message = parsed?.error ?? 'Failed to load analytics';
    throw new Error(message);
  }

  return parsed.metrics;
}


