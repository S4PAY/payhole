'use client';

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
};

export default function ProxyOnboarding() {
  const { verified } = usePaymentStatusContext();
  const { proxyHttpUrl, proxyDnsAddress } = getConfig();

  if (!verified) {
    return (
      <section className="rounded-xl border border-slate-200 bg-white p-6">
        <h3 className="text-lg font-semibold text-slate-900">Proxy Setup Locked</h3>
        <p className="mt-2 text-sm text-slate-600">
          Submit your Solana payment signature to unlock proxy configuration steps and begin browsing ad-free.
        </p>
      </section>
    );
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <header className="flex flex-col gap-2">
        <h3 className="text-lg font-semibold text-slate-900">Proxy Onboarding</h3>
        <p className="text-sm text-slate-600">
          Configure PayHole at the network layer for cross-device protection. Use the endpoints below when updating your
          device settings.
        </p>
      </header>
      <dl className="mt-4 grid gap-4 sm:grid-cols-2">
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
          <dt className="text-xs uppercase tracking-wide text-slate-500">HTTP Proxy Endpoint</dt>
          <dd className="mt-1 font-mono text-sm text-slate-900">{proxyHttpUrl}</dd>
        </div>
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
          <dt className="text-xs uppercase tracking-wide text-slate-500">DNS Sinkhole Address</dt>
          <dd className="mt-1 font-mono text-sm text-slate-900">{proxyDnsAddress}</dd>
        </div>
      </dl>
      <div className="mt-6 grid gap-4 md:grid-cols-2">
        {Object.entries(steps).map(([key, instructions]) => (
          <article key={key} className="rounded-lg border border-slate-200 p-4">
            <h4 className="text-sm font-semibold capitalize text-slate-800">{key}</h4>
            <ol className="mt-2 list-decimal space-y-2 pl-5 text-sm text-slate-600">
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

