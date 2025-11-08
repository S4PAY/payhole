'use client';

import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import { useWallet } from '@solana/wallet-adapter-react';

import { usePaymentStatusContext } from '@/components/providers/PaymentStatusProvider';

type StatusPillProps = {
  label: string;
  active: boolean;
};

function StatusPill({ label, active }: StatusPillProps) {
  return (
    <span
      className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-sm font-medium ${
        active ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-600'
      }`}
    >
      <span
        className={`size-2 rounded-full ${active ? 'bg-emerald-500' : 'bg-slate-500'}`}
        aria-hidden
      />
      {label}
    </span>
  );
}

export default function ConnectionBanner() {
  const { connected, publicKey } = useWallet();
  const { verified, expiresAt } = usePaymentStatusContext();

  const walletLabel = connected && publicKey ? `Wallet Connected (${publicKey.toBase58().slice(0, 4)}…${publicKey.toBase58().slice(-4)})` : 'Wallet Disconnected';
  const paymentLabel = verified
    ? `Payment Verified${expiresAt ? ` · Expires ${new Date(expiresAt).toLocaleDateString()}` : ''}`
    : 'Payment Pending';

  return (
    <section className="flex flex-col gap-4 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold text-slate-900">Connection Status</h2>
          <p className="mt-1 text-sm text-slate-600">
            Connect your wallet and verify payment to unlock PayHole’s proxy onboarding and analytics.
          </p>
        </div>
        <WalletMultiButton className="btn-wallet" data-testid="connection-banner-wallet" />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <StatusPill label={walletLabel} active={connected} />
        <StatusPill label={paymentLabel} active={verified} />
      </div>
    </section>
  );
}

