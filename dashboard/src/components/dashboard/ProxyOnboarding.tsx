'use client';

import Link from 'next/link';

import { usePaymentStatusContext } from '@/components/providers/PaymentStatusProvider';
import { getConfig } from '@/lib/config';

const steps = {
  android: [
    'Open device Settings → Network & internet → Private DNS.',
    'Switch to Private DNS provider hostname.',
    'Enter the provided DNS hostname and save.',
  ],
  ios: [
    'Install the configuration profile exposing PayHole DNS.',
    'Enable the profile under Settings → General → VPN & Device Management.',
    'Verify Safari loads without intrusive ads.',
  ],
  mac: [
    'Open System Settings → Network.',
    'Edit the Wi-Fi (or Ethernet) service and add the DNS IPs.',
    'Configure the HTTP proxy with the endpoint below.',
  ],
  windows: [
    'Open Settings → Network & Internet → Proxy.',
    'Enable Use a proxy server and enter the HTTP endpoint.',
    'Update adapter DNS settings to the PayHole DNS address.',
  ],
} as const;

const onboardingDocsHref = '/docs/proxy-onboarding';

export default function ProxyOnboarding() {
  const { verified } = usePaymentStatusContext();
  const { proxyHttpUrl, proxyDnsAddress } = getConfig();

  if (!verified) {
    return (
      <section className="surface-panel p-8 text-slate-100">
        <h3 className="text-lg font-semibold text-white">Proxy setup locked</h3>
        <p className="mt-2 text-sm text-slate-100/80">
          Submit your Solana payment signature to unlock proxy configuration steps and begin browsing ad-free.
        </p>
      </section>
    );
  }

  return (
    <section className="surface-glass p-8 text-slate-100">
      <header className="flex flex-col gap-2">
        <span className="badge-soft">Deployment guide</span>
        <h3 className="text-2xl font-semibold text-white">Roll out the PayHole profile everywhere</h3>
        <p className="text-sm text-slate-100/80">
          Configure PayHole at the network layer for cross-device protection. Use the endpoints below when updating your
          device settings.
        </p>
        <div className="mt-4">
          <Link
            href={onboardingDocsHref}
            className="inline-flex items-center gap-2 rounded-full border border-white/30 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-white transition hover:bg-white/10"
          >
            Open proxy tutorial
            <span aria-hidden>→</span>
          </Link>
        </div>
      </header>
      <dl className="mt-6 grid gap-4 sm:grid-cols-2">
        <div className="surface-panel px-4 py-3">
          <dt className="text-xs uppercase tracking-wide text-slate-200/70">HTTP Proxy Endpoint</dt>
          <dd className="mt-2 font-mono text-sm text-white">{proxyHttpUrl}</dd>
        </div>
        <div className="surface-panel px-4 py-3">
          <dt className="text-xs uppercase tracking-wide text-slate-200/70">DNS Sinkhole Address</dt>
          <dd className="mt-2 font-mono text-sm text-white">{proxyDnsAddress}</dd>
        </div>
      </dl>
      <div className="mt-6 grid gap-4 md:grid-cols-2">
        {Object.entries(steps).map(([key, instructions]) => (
          <article key={key} className="surface-panel p-5">
            <h4 className="text-sm font-semibold capitalize text-white">{key}</h4>
            <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm text-slate-100/80">
              {instructions.map((instruction) => (
                <li key={instruction}>{instruction}</li>
              ))}
            </ol>
          </article>
        ))}
      </div>
    </section>
  );
}

