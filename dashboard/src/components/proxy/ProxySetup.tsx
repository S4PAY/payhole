import { useMemo } from 'react';

const ProxySetup: React.FC = () => {
  const proxyBaseUrl = process.env.NEXT_PUBLIC_PROXY_HTTP_URL ?? '';

  const autoConfigUrl = `${proxyBaseUrl.replace(/\/$/, '')}/auto-config`;

  return (
    <div className="grid gap-6 md:grid-cols-2">
      <div className="space-y-4">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
          Setup Steps
        </h3>
        <ol className="space-y-2 text-sm text-slate-600">
          <li>
            <strong>DNS:</strong> Set your resolver to{' '}
            <code className="rounded bg-slate-200 px-1 py-0.5 text-xs">
              {process.env.NEXT_PUBLIC_PROXY_DNS_ADDR}
            </code>
          </li>
          <li>
            <strong>HTTP Proxy:</strong>{' '}
            <a
              className="text-indigo-600 underline hover:text-indigo-500"
              href={autoConfigUrl}
            >
              Download auto-config script
            </a>
          </li>
          <li>
            <strong>Mobile:</strong> Scan the QR code or open the configuration profile on your device.
          </li>
        </ol>
      </div>
      <div className="flex flex-col items-center justify-center gap-4 rounded-lg border border-slate-200 bg-slate-50 p-6">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
          Mobile Onboarding
        </h3>
        <img
          src={`${proxyBaseUrl.replace(/\/$/, '')}/auto-config/qr`}
          alt="PayHole proxy QR"
          className="rounded-lg border border-slate-200 bg-white p-2 shadow-sm"
          width={220}
          height={220}
        />
        <p className="text-xs text-slate-600 text-center">
          Scan on iOS or Android to install the PayHole DNS + proxy profile instantly.
        </p>
      </div>
    </div>
  );
};

export default ProxySetup;
