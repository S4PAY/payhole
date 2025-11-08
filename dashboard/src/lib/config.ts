const DEFAULT_PROXY_HTTP_URL = 'http://localhost:8080';
const DEFAULT_PROXY_DNS_ADDR = '127.0.0.1:5353';

export type AppConfig = {
  proxyHttpUrl: string;
  proxyDnsAddress: string;
  proxyHealthUrl: string;
};

let cachedConfig: AppConfig | null = null;

export function getConfig(): AppConfig {
  if (cachedConfig) {
    return cachedConfig;
  }

  const proxyHttpUrl = process.env.NEXT_PUBLIC_PROXY_HTTP_URL || DEFAULT_PROXY_HTTP_URL;
  const proxyDnsAddress = process.env.NEXT_PUBLIC_PROXY_DNS_ADDR || DEFAULT_PROXY_DNS_ADDR;
  const proxyHealthUrl =
    process.env.NEXT_PUBLIC_PROXY_HEALTH_URL || `${proxyHttpUrl.replace(/\/$/, '')}/health`;

  cachedConfig = {
    proxyHttpUrl,
    proxyDnsAddress,
    proxyHealthUrl,
  };

  return cachedConfig;
}

export function resetConfigForTests() {
  cachedConfig = null;
}

