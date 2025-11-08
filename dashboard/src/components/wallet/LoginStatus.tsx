'use client';

import { FormEvent, ReactNode, useMemo, useState } from 'react';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import { useWallet } from '@solana/wallet-adapter-react';
import { usePaymentStatusContext } from '@/components/providers/PaymentStatusProvider';

type StatusVariant = 'positive' | 'negative' | 'pending';

function shorten(address: string | null): string {
  if (!address) {
    return 'Not connected';
  }

  return `${address.slice(0, 4)}…${address.slice(-4)}`;
}

function StatusPill({ label, state }: { label: ReactNode; state: StatusVariant }) {
  const styles: Record<StatusVariant, string> = {
    positive: 'bg-emerald-100 text-emerald-700 border border-emerald-200',
    negative: 'bg-red-100 text-red-700 border border-red-200',
    pending: 'bg-amber-100 text-amber-700 border border-amber-200',
  };

  const dotStyles: Record<StatusVariant, string> = {
    positive: 'bg-emerald-500',
    negative: 'bg-red-500',
    pending: 'bg-amber-500 animate-pulse',
  };

  return (
    <span
      className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-sm font-medium ${styles[state]}`}
      data-testid={`status-pill-${state}`}
    >
      <span className={`size-2 rounded-full ${dotStyles[state]}`} />
      {label}
    </span>
  );
}

export default function LoginStatus() {
  const { publicKey, connected } = useWallet();
  const paymentStatus = usePaymentStatusContext();
  const [signature, setSignature] = useState('');
  const [submissionError, setSubmissionError] = useState<string | undefined>();

  const walletAddress = useMemo(
    () => (connected && publicKey ? publicKey.toBase58() : null),
    [connected, publicKey]
  );

  const walletState: StatusVariant = connected ? 'positive' : 'negative';
  const paymentState: StatusVariant = paymentStatus.verifying
    ? 'pending'
    : paymentStatus.verified
      ? 'positive'
      : 'negative';

  const paymentLabel = paymentStatus.verifying
    ? 'Verifying payment…'
    : paymentStatus.verified
      ? 'Payment verified'
      : 'Payment required';

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!signature.trim()) {
      setSubmissionError('Provide the Solana signature from your USDC payment.');
      return;
    }

    try {
      setSubmissionError(undefined);
      await paymentStatus.verifyPayment(signature.trim());
      setSignature('');
    } catch (error) {
      if (error instanceof Error) {
        setSubmissionError(error.message);
      } else {
        setSubmissionError('Unable to verify payment. Try again.');
      }
    }
  };

  return (
    <section className="flex flex-col gap-6 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <div>
        <h1 className="text-3xl font-semibold text-slate-900">Connection Status</h1>
        <p className="mt-2 max-w-2xl text-sm text-slate-600">
          Connect your wallet and verify your PayHole payment to unlock proxy and dashboard controls.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-4">
        <WalletMultiButton className="btn-wallet" data-testid="wallet-multi-button" />
        <StatusPill
          label={walletAddress ? `Wallet: ${shorten(walletAddress)}` : 'Wallet disconnected'}
          state={walletState}
        />
        <StatusPill label={paymentLabel} state={paymentState} />
      </div>

      {paymentStatus.verified && (
        <div className="flex flex-col gap-1 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800" data-testid="payment-summary">
          <p>Premium access active for {shorten(walletAddress)}.</p>
          {typeof paymentStatus.remainingDays === 'number' && (
            <p>{paymentStatus.remainingDays} day(s) remaining on this unlock.</p>
          )}
          {paymentStatus.expiresAt && (
            <p>Token expires on {new Date(paymentStatus.expiresAt).toUTCString()}.</p>
          )}
        </div>
      )}

      {!paymentStatus.verified && connected && (
        <form className="flex flex-col gap-3" onSubmit={handleSubmit}>
          <label className="text-sm font-medium text-slate-700" htmlFor="signature">
            Paste your Solana transaction signature to verify payment
          </label>
          <div className="flex flex-col gap-3 sm:flex-row">
            <input
              id="signature"
              name="signature"
              className="w-full flex-1 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm text-slate-900 shadow-sm focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-200"
              placeholder="5NX8…"
              value={signature}
              onChange={(event) => {
                setSignature(event.target.value);
                if (submissionError) {
                  setSubmissionError(undefined);
                }
                if (paymentStatus.error) {
                  paymentStatus.clearError();
                }
              }}
              disabled={paymentStatus.verifying}
              autoComplete="off"
              data-testid="signature-input"
            />
            <button
              type="submit"
              className="inline-flex items-center justify-center rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:bg-slate-300"
              disabled={paymentStatus.verifying}
              data-testid="verify-button"
            >
              {paymentStatus.verifying ? 'Verifying…' : 'Verify payment'}
            </button>
          </div>
          <p className="text-xs text-slate-500">
            PayHole never stores your signature. We forward it to the payments service to confirm USDC settlement on Solana, granting 30-day proxy access.
          </p>
          {(submissionError || paymentStatus.error) && (
            <p className="text-sm font-medium text-red-600" data-testid="verification-error">
              {submissionError ?? paymentStatus.error}
            </p>
          )}
        </form>
      )}

      {!connected && (
        <p className="text-xs text-slate-500" data-testid="wallet-help">
          Connect a Solana wallet (Phantom or Solflare) to begin verifying payment.
        </p>
      )}
    </section>
  );
}

