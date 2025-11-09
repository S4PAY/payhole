import Link from 'next/link';

export const metadata = {
  title: 'Proxy Onboarding Tutorial | PayHole',
  description:
    'Step-by-step instructions for configuring PayHole proxy and DNS interception across Android, iOS, macOS, and Windows devices.',
};

export default function ProxyOnboardingDocs() {
  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-8 px-6 py-12 text-slate-100">
      <header className="space-y-3">
        <span className="badge-soft">Documentation</span>
        <h1 className="text-3xl font-semibold text-white">Proxy Onboarding Playbook</h1>
        <p className="text-base text-slate-100/80">
          Follow this guide to deploy PayHole at the network edge. Configure the DNS sinkhole and HTTP proxy once, then
          enroll every device on your network for real-time tracker interception and micropayment unlocks.
        </p>
      </header>

      <section className="surface-panel p-6">
        <h2 className="text-xl font-semibold text-white">Core Endpoints</h2>
        <p className="mt-2 text-sm text-slate-100/80">
          Update devices with the same endpoints that power the dashboard:
        </p>
        <dl className="mt-4 grid gap-4 sm:grid-cols-2">
          <div>
            <dt className="text-xs uppercase tracking-wide text-slate-200/70">HTTP Proxy Endpoint</dt>
            <dd className="mt-2 font-mono text-sm text-white">{process.env.NEXT_PUBLIC_PROXY_HTTP_URL}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-slate-200/70">DNS Sinkhole Address</dt>
            <dd className="mt-2 font-mono text-sm text-white">{process.env.NEXT_PUBLIC_PROXY_DNS_ADDR}</dd>
          </div>
        </dl>
        <div className="mt-4 text-sm text-slate-100/70">
          Need the automatic device profile?{' '}
          <a
            href={`${(process.env.NEXT_PUBLIC_PROXY_HTTP_URL ?? '').replace(/\/$/, '')}/auto-config`}
            className="text-indigo-300 underline decoration-indigo-500/60 underline-offset-2 hover:text-indigo-200"
          >
            Download the auto-config bundle
          </a>{' '}
          and distribute it via your MDM or onboarding flow.
        </div>
      </section>

      <section className="surface-panel space-y-6 p-6">
        <h2 className="text-xl font-semibold text-white">Platform Playbooks</h2>

        <article>
          <h3 className="text-lg font-semibold text-white">Android</h3>
          <ol className="mt-2 list-decimal space-y-2 pl-5 text-sm text-slate-100/80">
            <li>Open device Settings → Network &amp; internet → Private DNS.</li>
            <li>Switch to Private DNS provider hostname.</li>
            <li>Enter the PayHole DNS hostname and save.</li>
          </ol>
        </article>

        <article>
          <h3 className="text-lg font-semibold text-white">iOS</h3>
          <ol className="mt-2 list-decimal space-y-2 pl-5 text-sm text-slate-100/80">
            <li>Install the configuration profile exposing PayHole DNS.</li>
            <li>Enable the profile under Settings → General → VPN &amp; Device Management.</li>
            <li>Verify Safari and in-app browsers render without intrusive ads.</li>
          </ol>
        </article>

        <article>
          <h3 className="text-lg font-semibold text-white">macOS</h3>
          <ol className="mt-2 list-decimal space-y-2 pl-5 text-sm text-slate-100/80">
            <li>Open System Settings → Network and select the active service.</li>
            <li>Add the PayHole DNS address to the DNS Servers list.</li>
            <li>Configure the HTTP proxy tab with the PayHole endpoint and save.</li>
          </ol>
        </article>

        <article>
          <h3 className="text-lg font-semibold text-white">Windows</h3>
          <ol className="mt-2 list-decimal space-y-2 pl-5 text-sm text-slate-100/80">
            <li>Open Settings → Network &amp; Internet → Proxy.</li>
            <li>Enable “Use a proxy server” and enter the PayHole HTTP endpoint.</li>
            <li>Update adapter DNS settings to the PayHole DNS address.</li>
          </ol>
        </article>
      </section>

      <section className="surface-panel p-6">
        <h2 className="text-xl font-semibold text-white">Next Steps</h2>
        <ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-slate-100/80">
          <li>Monitor <Link href="/admin/analytics" className="text-indigo-300 underline hover:text-indigo-200">Network Stats</Link> for real-time interception telemetry.</li>
          <li>Audit <Link href="/admin" className="text-indigo-300 underline hover:text-indigo-200">x402 Activity</Link> to reconcile SPL payments against premium requests.</li>
          <li>Configure creator payout rules under <Link href="/admin" className="text-indigo-300 underline hover:text-indigo-200">Creator Tools</Link> to automate tipping flows.</li>
        </ul>
      </section>
    </main>
  );
}

