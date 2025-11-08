type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

function resolveHealthUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_PROXY_HEALTH_URL;
  if (explicit) {
    return explicit;
  }
  const endpoint = process.env.NEXT_PUBLIC_PROXY_ENDPOINT_URL;
  if (endpoint) {
    const trimmed = endpoint.endsWith('/') ? endpoint.slice(0, -1) : endpoint;
    return `${trimmed}/health`;
  }
  return 'http://localhost:8080/health';
}

export async function checkProxyHealth(fetcher: Fetcher = fetch): Promise<boolean> {
  try {
    const url = resolveHealthUrl();
    const response = await fetcher(url, {
      method: 'GET',
      cache: 'no-store',
    });
    return response.ok;
  } catch (error) {
    return false;
  }
}

export { resolveHealthUrl };


