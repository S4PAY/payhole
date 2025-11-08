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
      return { label: 'Proxy Status: \u2705 Secured', badge: 'bg-emerald-500/20 text-emerald-100' };
    }
    if (paymentStatus.verified) {
      return {
        label: 'Proxy Status: Payment Verified — Connect device',
        badge: 'bg-amber-500/20 text-amber-100',
      };
    }
    if (healthError) {
      return { label: 'Proxy Status: Not Protected', badge: 'bg-rose-500/20 text-rose-100' };
    }
    return { label: 'Proxy Status: Unknown', badge: 'bg-white/10 text-slate-100' };
  }, [health, paymentStatus.verified, healthError]);

  return (
    <section
      id="proxy"
      className="surface-glass relative grid gap-8 p-8 text-slate-100 md:grid-cols-2"
    >
      <div className="flex flex-col gap-5">
        <div className="space-y-2">
          <span className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wide ${statusLabel.badge}`}>
            {statusLabel.label}
          </span>
          <h2 className="text-2xl font-semibold text-white">Monitor and enroll every device</h2>
          <p className="text-sm text-slate-100/80">
            {paymentStatus.verified
              ? 'Route DNS + HTTP traffic through PayHole to remain protected across the entire estate.'
              : 'Verify your wallet to unlock the PayHole proxy, populate analytics, and remove intrusive ads.'}
          </p>
        </div>

        <div className="surface-panel space-y-3 p-5">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-200/70">Blocked requests</h3>
          <p className="text-3xl font-semibold text-white">{totalBlocked.toLocaleString()}</p>
          <ul className="space-y-1 text-xs text-slate-100/80">
            {Object.entries(blockedByReason).map(([reason, count]) => (
              <li key={reason} className="flex items-center justify-between">
                <span className="capitalize text-slate-200/70">{reason.replace(/_/g, ' ')}</span>
              <span className="font-semibold text-white">{count}</span>
              </li>
            ))}
            {updatedAt ? (
              <li className="text-[11px] text-slate-200/60">Updated {new Date(updatedAt).toLocaleTimeString()}</li>
            ) : null}
          </ul>
        </div>

        <div className="surface-panel space-y-3 p-5">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-200/70">Setup steps</h3>
          <ol className="space-y-2 text-sm text-slate-100/80">
            <li>
              <strong className="text-white">DNS:</strong> Set your resolver to{' '}
              <code className="rounded bg-white/20 px-1 py-0.5 text-xs text-white">{PROXY_DNS_ADDR}</code>
            </li>
            <li>
              <strong className="text-white">HTTP Proxy:</strong>{' '}
              <a
                className="text-indigo-200 underline decoration-dotted underline-offset-4 hover:text-indigo-100"
                href={`${PROXY_HTTP_URL.replace(/\/$/, '')}/auto-config`}
              >
                Download auto-config script
              </a>
            </li>
            <li>
              <strong className="text-white">Mobile:</strong> Scan the QR code or open the configuration profile on your device.
            </li>
          </ol>
        </div>

        {healthError ? <p className="text-sm text-rose-200">Proxy unreachable: {healthError}</p> : null}
      </div>

      <div className="surface-panel flex flex-col items-center justify-center gap-4 p-6">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-200/70">Mobile Onboarding</h3>
        {qrDataUrl ? (
          <img
            src={qrDataUrl}
            alt="PayHole proxy QR code"
            className="rounded-3xl border border-white/10 bg-white/90 p-4 shadow-lg"
            width={220}
            height={220}
          />
        ) : (
          <div className="flex h-[220px] w-[220px] items-center justify-center rounded-3xl border border-dashed border-white/20 text-sm text-slate-200/70">
            Generating QR…
          </div>
        )}
        <p className="text-xs text-slate-100/70 text-center">
          Scan on iOS or Android to install the PayHole DNS + proxy profile instantly.
        </p>
      </div>
    </section>
  );
}

