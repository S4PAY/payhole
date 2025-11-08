import { getConfig } from '@/lib/config';

export type ProxyHealth = {
  status: 'ok' | 'degraded';
};

export async function checkProxyHealth(fetchFn: typeof fetch = fetch): Promise<ProxyHealth> {
  const { proxyHealthUrl } = getConfig();
  const response = await fetchFn(proxyHealthUrl, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' },
  });

  if (!response.ok) {
    return { status: 'degraded' };
  }

  return { status: 'ok' };
}

