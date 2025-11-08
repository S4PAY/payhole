'use client';

import { createContext, ReactNode, useCallback, useContext, useMemo, useState } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { useEffect } from 'react';

export type PaymentStatus = {
  loading: boolean;
  verified: boolean;
  wallet: string | null;
  expiresAt: string | null;
  remainingDays: number | null;
  lastChecked: string | null;
  error: string | null;
};

type PaymentContextValue = {
  status: PaymentStatus;
  verifyPayment: (signature: string) => Promise<void>;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
};

const PaymentStatusContext = createContext<PaymentContextValue | undefined>(undefined);

const initialStatus: PaymentStatus = {
  loading: false,
  verified: false,
  wallet: null,
  expiresAt: null,
  remainingDays: null,
  lastChecked: null,
  error: null,
};

type PaymentsProviderProps = {
  children: ReactNode;
};

async function fetchStatusRequest(): Promise<Omit<PaymentStatus, 'loading'>> {
  const response = await fetch('/api/payments/status', {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
  });

  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({ error: 'status_failed' }));
    const message = errorBody.error ?? 'Unable to verify payment status';
    throw new Error(message);
  }

  const data = await response.json();

  return {
    verified: true,
    wallet: data.wallet ?? null,
    expiresAt: data.expiresAt ?? null,
    remainingDays: typeof data.remainingDays === 'number' ? data.remainingDays : null,
    lastChecked: new Date().toISOString(),
    error: null,
  };
}

export function PaymentsProvider({ children }: PaymentsProviderProps) {
  const { publicKey, connected } = useWallet();
  const walletAddress = useMemo(() => (connected && publicKey ? publicKey.toBase58() : null), [connected, publicKey]);

  const [status, setStatus] = useState<PaymentStatus>(initialStatus);

  const refresh = useCallback(async () => {
    if (!walletAddress) {
      setStatus((prev) => ({ ...initialStatus, error: null }));
      return;
    }

    setStatus((prev) => ({ ...prev, loading: true, wallet: walletAddress, error: null }));

    try {
      const result = await fetchStatusRequest();
      setStatus((prev) => ({ ...prev, ...result, loading: false }));
    } catch (error) {
      setStatus((prev) => ({
        ...initialStatus,
        wallet: walletAddress,
        loading: false,
        error: error instanceof Error ? error.message : 'Unable to verify payment status',
      }));
    }
  }, [walletAddress]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const verifyPayment = useCallback(
    async (signature: string) => {
      if (!walletAddress) {
        throw new Error('Connect your wallet before verifying payment.');
      }

      setStatus((prev) => ({ ...prev, loading: true, error: null }));

      try {
        const response = await fetch('/api/payments/pay', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ wallet: walletAddress, signature }),
        });

        if (!response.ok) {
          const errorBody = await response.json().catch(() => ({ error: 'verify_failed' }));
          throw new Error(errorBody.error ?? 'Payment verification failed');
        }

        const payload = await response.json();
        setStatus({
          loading: false,
          verified: true,
          wallet: walletAddress,
          expiresAt: payload.expiresAt ?? null,
          remainingDays: typeof payload.remainingDays === 'number' ? payload.remainingDays : 30,
          lastChecked: new Date().toISOString(),
          error: null,
        });
      } catch (error) {
        setStatus((prev) => ({
          ...prev,
          loading: false,
          error: error instanceof Error ? error.message : 'Payment verification failed',
        }));
        throw error;
      }
    },
    [walletAddress]
  );

  const logout = useCallback(async () => {
    await fetch('/api/payments/logout', { method: 'POST', credentials: 'include' });
    setStatus(initialStatus);
  }, []);

  const value = useMemo<PaymentContextValue>(
    () => ({
      status,
      verifyPayment,
      refresh,
      logout,
    }),
    [status, verifyPayment, refresh, logout]
  );

  return <PaymentStatusContext.Provider value={value}>{children}</PaymentStatusContext.Provider>;
}

export function usePayments() {
  const context = useContext(PaymentStatusContext);
  if (!context) {
    throw new Error('usePayments must be used within a PaymentsProvider');
  }
  return context;
}

