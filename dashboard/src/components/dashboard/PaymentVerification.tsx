'use client';

import { FormEvent, useState } from 'react';

import { usePaymentStatusContext } from '@/components/providers/PaymentStatusProvider';

export default function PaymentVerification() {
  const { verified, verifyPayment, verifying, error, clearError, refresh, expiresAt } =
    usePaymentStatusContext();
  const [signature, setSignature] = useState('');
  const [successMessage, setSuccessMessage] = useState('');

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

  if (verified) {
    return (
      <section className="rounded-xl border border-emerald-200 bg-emerald-50 p-6 text-emerald-900">
        <h3 className="text-lg font-semibold">Access Granted</h3>
        <p className="mt-2 text-sm">
          Your wallet is verified. Explore the proxy onboarding steps below to activate PayHole across your devices.
        </p>
        <div className="mt-3 flex flex-col gap-2 text-sm">
          {expiresAt ? (
            <p>
              Unlock expires on <strong>{new Date(expiresAt).toLocaleString()}</strong>.
            </p>
          ) : null}
          <button
            type="button"
            onClick={() => refresh()}
            className="inline-flex w-fit items-center justify-center rounded-lg border border-emerald-300 bg-white px-3 py-1.5 text-sm font-medium text-emerald-700 transition hover:bg-emerald-100"
          >
            Refresh unlock status
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <h3 className="text-lg font-semibold text-slate-900">Submit Payment Proof</h3>
      <p className="mt-2 text-sm text-slate-600">
        Paste the Solana transaction signature produced by the PayHole purchase flow. A valid signature unlocks proxy
        configuration for 30 days.
      </p>
      <form className="mt-4 flex flex-col gap-3" onSubmit={handleSubmit}>
        <label className="text-sm font-medium text-slate-700" htmlFor="payment-signature">
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
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-400"
          placeholder="5kzq..."
          required
        />
        <button
          type="submit"
          className="inline-flex items-center justify-center rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:bg-slate-400"
          disabled={verifying}
        >
          {verifying ? 'Verifying…' : 'Verify Payment'}
        </button>
      </form>
      {error ? (
        <p className="mt-3 text-sm text-rose-600" role="alert">
          {error}
        </p>
      ) : null}
      {successMessage ? (
        <p className="mt-3 text-sm text-emerald-600" role="status">
          {successMessage}
        </p>
      ) : null}
    </section>
  );
}

