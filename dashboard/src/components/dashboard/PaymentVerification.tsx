'use client';

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { usePaymentStatusContext } from '@/components/providers/PaymentStatusProvider';
import { getPaymentConfig } from '@/lib/paymentConfig';

export default function PaymentVerification() {
  const { verified, verifyPayment, verifying, error, clearError, refresh, expiresAt } =
    usePaymentStatusContext();
  const paymentConfig = useMemo(() => getPaymentConfig(), []);
  const [signature, setSignature] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [copyStatus, setCopyStatus] = useState<'wallet' | 'link' | null>(null);
  const copyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSuccessMessage('');

    try {
      await verifyPayment(signature.trim());
      setSignature('');
      setSuccessMessage('Payment verified. Proxy onboarding is now unlocked.');
    } catch (err) {
      // error state is handled via context; nothing to do here
    }
  };

  const handleCopy = useCallback(
    async (value: string, status: 'wallet' | 'link') => {
      if (!value) {
        return;
      }

      try {
        if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(value);
          setCopyStatus(status);
          if (copyTimeoutRef.current) {
            clearTimeout(copyTimeoutRef.current);
          }
          copyTimeoutRef.current = setTimeout(() => setCopyStatus(null), 2000);
        }
      } catch {
        setCopyStatus(null);
      }
    },
    []
  );

  useEffect(() => {
    return () => {
      if (copyTimeoutRef.current) {
        clearTimeout(copyTimeoutRef.current);
      }
    };
  }, []);

  if (verified) {
    return (
      <section className="surface-glass relative overflow-hidden p-8 text-emerald-100">
        <div className="absolute inset-0 bg-gradient-to-br from-emerald-400/20 via-transparent to-emerald-500/10" />
        <div className="relative z-10 space-y-4">
          <span className="badge-soft border-emerald-300/40 bg-emerald-500/20 text-emerald-100">
            Access granted
          </span>
        <h3 className="text-2xl font-semibold text-white">Proxy onboarding unlocked</h3>
        <p className="text-sm leading-relaxed text-emerald-100/80">
          Your wallet is verified. Explore the proxy onboarding steps below to activate PayHole across all devices in
          your network. Changes to rules and payment policies now sync instantly.
        </p>
        <div className="flex flex-wrap items-center gap-4 text-sm text-emerald-100/80">
          {expiresAt ? (
            <p>
              Unlock expires on <strong>{new Date(expiresAt).toLocaleString()}</strong>.
            </p>
          ) : null}
          <button
            type="button"
            onClick={() => refresh()}
            className="inline-flex w-fit items-center justify-center rounded-full border border-emerald-300/60 bg-white/90 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-emerald-700 shadow-sm transition hover:bg-white"
          >
            Refresh unlock status
          </button>
        </div>
        </div>
      </section>
    );
  }

  return (
    <section className="surface-glass relative overflow-hidden p-8 text-slate-100">
      <div className="absolute inset-0 bg-gradient-to-br from-white/10 via-transparent to-white/5" />
      <div className="relative z-10 space-y-3">
        <span className="badge-soft">Submit payment proof</span>
        <h3 className="text-2xl font-semibold text-white">Authenticate premium access</h3>
        <p className="max-w-2xl text-sm text-slate-100/80">
          Send <strong className="text-white">{paymentConfig.displayAmount} USDC</strong> to the PayHole treasury wallet
          using your preferred Solana wallet. Once the transfer confirms on-chain, paste the transaction signature to
          provision a 30-day unlock token across your network.
        </p>
      </div>

      {paymentConfig.treasuryAddress ? (
        <div className="relative z-10 mt-6 grid gap-4 lg:grid-cols-2">
          <article className="surface-panel space-y-3 p-5 text-slate-100/90">
            <h4 className="text-sm font-semibold uppercase tracking-wide text-slate-200/70">Treasury wallet</h4>
            <p className="break-all font-mono text-sm text-white">{paymentConfig.treasuryAddress}</p>
            <button
              type="button"
              className="inline-flex items-center justify-center rounded-full border border-white/30 bg-white/90 px-3 py-1.5 text-xs font-semibold text-slate-900 shadow transition hover:bg-white"
              onClick={() => handleCopy(paymentConfig.treasuryAddress ?? '', 'wallet')}
            >
              {copyStatus === 'wallet' ? 'Copied' : 'Copy wallet address'}
            </button>
          </article>
          <article className="surface-panel space-y-3 p-5 text-slate-100/90">
            <h4 className="text-sm font-semibold uppercase tracking-wide text-slate-200/70">Quick actions</h4>
            <p className="text-sm text-slate-100/80">
              Launch a Solana Pay request or open the transfer in Phantom. Use the copied signature once the transfer
              settles.
            </p>
            <div className="flex flex-wrap gap-2">
              {paymentConfig.solanaPayUrl ? (
                <a
                  className="inline-flex items-center justify-center rounded-full bg-white px-4 py-2 text-xs font-semibold text-slate-900 shadow transition hover:-translate-y-0.5 hover:shadow-lg"
                  href={paymentConfig.solanaPayUrl}
                >
                  Open in wallet
                </a>
              ) : null}
              {paymentConfig.phantomUrl ? (
                <a
                  className="inline-flex items-center justify-center rounded-full border border-white/30 px-4 py-2 text-xs font-semibold text-white transition hover:bg-white/10"
                  href={paymentConfig.phantomUrl}
                  rel="noreferrer"
                  target="_blank"
                >
                  Open in Phantom
                </a>
              ) : null}
              {paymentConfig.solanaPayUrl ? (
                <button
                  type="button"
                  className="inline-flex items-center justify-center rounded-full border border-white/30 bg-white/10 px-4 py-2 text-xs font-semibold text-white transition hover:bg-white/20"
                  onClick={() => handleCopy(paymentConfig.solanaPayUrl ?? '', 'link')}
                >
                  {copyStatus === 'link' ? 'Copied link' : 'Copy Solana Pay link'}
                </button>
              ) : null}
            </div>
          </article>
        </div>
      ) : (
        <div className="relative z-10 mt-6 rounded-2xl border border-amber-400/40 bg-amber-500/20 p-4 text-sm text-amber-100">
          Admins: set <code className="font-mono">NEXT_PUBLIC_TREASURY_WALLET</code> and{' '}
          <code className="font-mono">NEXT_PUBLIC_PAYMENT_AMOUNT_USDC</code> to display payment instructions.
        </div>
      )}

      <form className="relative z-10 mt-6 flex flex-col gap-3" onSubmit={handleSubmit}>
        <label className="text-xs font-semibold uppercase tracking-wide text-slate-200/70" htmlFor="payment-signature">
          Transaction Signature
        </label>
        <input
          id="payment-signature"
          name="payment-signature"
          value={signature}
          onChange={(event) => {
            setSignature(event.target.value);
            if (error) {
              clearError();
            }
          }}
          className="w-full rounded-xl border border-white/20 bg-white/95 px-4 py-3 text-sm font-medium text-slate-900 shadow focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-400"
          placeholder="5kzq..."
          required
        />
        <button
          type="submit"
          className="inline-flex items-center justify-center rounded-full bg-indigo-500 px-6 py-2.5 text-sm font-semibold text-white shadow transition hover:bg-indigo-400 disabled:cursor-not-allowed disabled:bg-slate-400"
          disabled={verifying}
        >
          {verifying ? 'Verifying…' : 'Verify Payment'}
        </button>
      </form>
      {error ? (
        <p className="relative z-10 mt-3 text-sm text-rose-200" role="alert">
          {error}
        </p>
      ) : null}
      {successMessage ? (
        <p className="relative z-10 mt-3 text-sm text-emerald-200" role="status">
          {successMessage}
        </p>
      ) : null}
      {copyStatus ? (
        <p className="relative z-10 mt-3 text-xs text-slate-200/70" role="status">
          Copied {copyStatus === 'wallet' ? 'treasury address' : 'Solana Pay link'} to clipboard.
        </p>
      ) : null}
    </section>
  );
}
