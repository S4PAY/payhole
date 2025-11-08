'use client';

import { useEffect, useMemo, useState } from 'react';
import { usePaymentStatusContext } from '@/components/providers/PaymentStatusProvider';
import { checkProxyHealth } from '@/lib/proxyHealth';

const PLATFORM_STEPS: Record<string, string[]> = {
  Android: [
    'Open Wi-Fi settings and edit your active network.',
    'Enable advanced options and set proxy to “Manual”.',
    'Enter the PayHole endpoint as the proxy hostname and port.',
    'Save and reconnect to apply system-wide filtering.',
  ],
  iOS: [
    'Navigate to Settings → Wi-Fi and tap the ⓘ icon next to your network.',
    'Under “HTTP Proxy”, switch to “Manual”.',
    'Fill in the PayHole proxy endpoint and port.',
    'Tap “Save”; Safari and in-app traffic will now route through PayHole.',
  ],
  macOS: [
    'Open System Settings → Network and select your primary interface.',
    'Click “Details”, then open the “Proxies” tab.',
    'Check “Web Proxy (HTTP)” and “Secure Web Proxy (HTTPS)”.',
    'Enter the PayHole host and port, save, and apply.',
  ],
  Windows: [
    'Open Settings → Network & Internet → Proxy.',
    'Enable “Use a proxy server”.',
    'Enter the PayHole endpoint address and port.',
    'Click “Save” to enforce proxy routing across the OS.',
  ],
};

type HealthState = 'checking' | 'online' | 'offline';

export default function ProxySetup() {
  const paymentStatus = usePaymentStatusContext();
  const [health, setHealth] = useState<HealthState>('checking');

  const proxyEndpoint = useMemo(
    () => process.env.NEXT_PUBLIC_PROXY_ENDPOINT_URL ?? 'http://localhost:8080',
    []
  );

  useEffect(() => {
    if (!paymentStatus.verified) {
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        const ok = await checkProxyHealth();
        if (!cancelled) {
          setHealth(ok ? 'online' : 'offline');
        }
      } catch (error) {
        if (!cancelled) {
          setHealth('offline');
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [paymentStatus.verified]);

  if (!paymentStatus.verified) {
    return null;
  }

  return (
    <section className="flex flex-col gap-6 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <header className="flex flex-col gap-2">
        <h2 className="text-2xl font-semibold text-slate-900">Proxy & DNS Onboarding</h2>
        <p className="text-sm text-slate-600">
          Your wallet is verified. Route your traffic through PayHole to block intrusive ads and enforce x402 payments by default.
        </p>
      </header>

      <div className="flex flex-wrap items-center gap-3 text-sm">
        <span className="rounded-md border border-slate-300 bg-slate-50 px-3 py-2 font-mono text-slate-800">
          {proxyEndpoint}
        </span>
        <span
          className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-medium ${
            health === 'online'
              ? 'bg-emerald-100 text-emerald-700'
              : health === 'offline'
                ? 'bg-red-100 text-red-700'
                : 'bg-amber-100 text-amber-700'
          }`}
          data-testid="proxy-health"
        >
          <span
            className={`size-2 rounded-full ${
              health === 'online'
                ? 'bg-emerald-500'
                : health === 'offline'
                  ? 'bg-red-500'
                  : 'bg-amber-500 animate-pulse'
            }`}
          />
          Proxy health: {health === 'checking' ? 'Checking…' : health === 'online' ? 'Online' : 'Offline'}
        </span>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {Object.entries(PLATFORM_STEPS).map(([platform, steps]) => (
          <div key={platform} className="rounded-lg border border-slate-200 bg-slate-50 p-4">
            <h3 className="text-sm font-semibold text-slate-900">{platform}</h3>
            <ol className="mt-2 list-decimal space-y-1 pl-5 text-xs text-slate-600">
              {steps.map((step, idx) => (
                <li key={idx}>{step}</li>
              ))}
            </ol>
          </div>
        ))}
      </div>

      <p className="text-xs text-slate-500">
        Tip: Pair the proxy with encrypted DNS (`dns-proxy.payhole`) to ensure trackers cannot downgrade to plain queries. PayHole processes everything locally—no behavioural tracking, ever.
      </p>
    </section>
  );
}

