'use client';

import { useEffect, useMemo, useState } from 'react';
import QRCode from 'qrcode';
import { usePaymentStatusContext } from '@/components/providers/PaymentStatusProvider';
import { useAnalyticsSummary } from '@/hooks/useAnalyticsSummary';

type ProxyHealthState = 'secured' | 'unprotected' | 'unknown';

const PROXY_HEALTH_URL = process.env.NEXT_PUBLIC_PROXY_HEALTH_URL ?? 'http://localhost:8080/health';
const PROXY_DNS_ADDR = process.env.NEXT_PUBLIC_PROXY_DNS_ADDR ?? 'proxy:5353';
const PROXY_HTTP_URL = process.env.NEXT_PUBLIC_PROXY_HTTP_URL ?? 'http://localhost:8080';

export default function ProxyStatusCard() {
  const paymentStatus = usePaymentStatusContext();
  const { totalBlocked, blockedByReason, updatedAt } = useAnalyticsSummary();
  const [health, setHealth] = useState<ProxyHealthState>('unknown');
  const [qrDataUrl, setQrDataUrl] = useState<string>('');
  const [healthError, setHealthError] = useState<string | undefined>();

  useEffect(() => {
    let mounted = true;

    async function fetchHealth() {
      try {
        const response = await fetch(PROXY_HEALTH_URL, { cache: 'no-store' });
        if (!response.ok) {
          throw new Error(`Proxy health request failed (${response.status})`);
        }
        if (mounted) {
          setHealth('secured');
          setHealthError(undefined);
        }
      } catch (error) {
        if (mounted) {
          setHealth(paymentStatus.verified ? 'unprotected' : 'unknown');
          setHealthError(error instanceof Error ? error.message : 'Proxy health unavailable');
        }
      }
    }

    fetchHealth();
    const id = setInterval(fetchHealth, 15_000);
    return () => {
      mounted = false;
      clearInterval(id);
    };
  }, [paymentStatus.verified]);

  useEffect(() => {
    const onboardingUrl = `${PROXY_HTTP_URL.replace(/\/$/, '')}/setup?source=qr`;
    QRCode.toDataURL(onboardingUrl, { margin: 1, width: 220 }).then(setQrDataUrl).catch(() => {
      setQrDataUrl('');
    });
  }, []);

  const statusLabel = useMemo(() => {
    if (health === 'secured' && paymentStatus.verified) {
      return { label: 'Proxy Status: ✅ Secured', tone: 'text-emerald-500' };
    }
    if (paymentStatus.verified) {
      return { label: 'Proxy Status: ⚠️ Payment Verified — Connect device', tone: 'text-amber-500' };
    }
    if (healthError) {
      return { label: 'Proxy Status: ❌ Not Protected', tone: 'text-rose-500' };
    }
    return { label: 'Proxy Status: ❓ Unknown', tone: 'text-slate-500' };
  }, [health, paymentStatus.verified, healthError]);

  return (
    <section className="grid gap-6 rounded-xl border border-slate-200 bg-white p-6 shadow-sm md:grid-cols-2">
      <div className="flex flex-col gap-4">
        <div>
          <h2 className="text-xl font-semibold text-slate-900">{statusLabel.label}</h2>
          <p className="mt-1 text-sm text-slate-600">
            {paymentStatus.verified
              ? 'Route DNS + HTTP traffic through PayHole to stay protected.'
              : 'Verify your wallet to unlock the PayHole proxy and remove intrusive ads.'}
          </p>
        </div>

        <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Blocked Requests</h3>
          <p className="mt-2 text-2xl font-semibold text-slate-900">{totalBlocked.toLocaleString()}</p>
          <ul className="mt-2 space-y-1 text-xs text-slate-600">
            {Object.entries(blockedByReason).map(([reason, count]) => (
              <li key={reason} className="flex items-center justify-between">
                <span>{reason.replace(/_/g, ' ')}</span>
                <span>{count}</span>
              </li>
            ))}
            {updatedAt ? (
              <li className="text-[11px] text-slate-500">Updated {new Date(updatedAt).toLocaleTimeString()}</li>
            ) : null}
          </ul>
        </div>

        <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Setup Steps</h3>
          <ol className="mt-2 space-y-2 text-sm text-slate-600">
            <li>
              <strong>DNS:</strong> Set your resolver to <code className="rounded bg-slate-200 px-1 py-0.5 text-xs">{PROXY_DNS_ADDR}</code>
            </li>
            <li>
              <strong>HTTP Proxy:</strong>{' '}
              <a
                className="text-indigo-600 underline hover:text-indigo-500"
                href={`${PROXY_HTTP_URL.replace(/\/$/, '')}/auto-config`}
              >
                Download auto-config script
              </a>
            </li>
            <li>
              <strong>Mobile:</strong> Scan the QR code or open the configuration profile on your device.
            </li>
          </ol>
        </div>

        {healthError ? <p className="text-sm text-rose-500">Proxy unreachable: {healthError}</p> : null}
      </div>

      <div className="flex flex-col items-center justify-center gap-4 rounded-lg border border-slate-200 bg-slate-50 p-6">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Mobile Onboarding</h3>
        {qrDataUrl ? (
          <img
            src={qrDataUrl}
            alt="PayHole proxy QR code"
            className="rounded-lg border border-slate-200 bg-white p-2 shadow-sm"
            width={220}
            height={220}
          />
        ) : (
          <div className="flex h-[220px] w-[220px] items-center justify-center rounded-lg border border-dashed border-slate-300 text-sm text-slate-400">
            Generating QR…
          </div>
        )}
        <p className="text-xs text-slate-600 text-center">
          Scan on iOS or Android to install the PayHole DNS + proxy profile instantly.
        </p>
      </div>
    </section>
  );
}

