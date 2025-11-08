'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { clearUnlock, loadUnlock, saveUnlock } from '@/lib/unlockStorage';

type BaseState = {
  walletAddress: string | null;
  verified: boolean;
  loading: boolean;
  verifying: boolean;
  remainingDays: number | null;
  expiresAt: string | null;
  token: string | null;
  error?: string;
};

const DEFAULT_STATE: BaseState = {
  walletAddress: null,
  verified: false,
  loading: false,
  verifying: false,
  remainingDays: null,
  expiresAt: null,
  token: null,
  error: undefined,
};

export type PaymentStatusValue = BaseState & {
  refresh: () => Promise<void>;
  verifyPayment: (signature: string) => Promise<void>;
  clearError: () => void;
};

function createInitialState(walletAddress: string | null): BaseState {
  if (walletAddress) {
    const stored = loadUnlock(walletAddress);
    if (stored) {
      return {
        ...DEFAULT_STATE,
        walletAddress,
        token: stored.token,
        expiresAt: stored.expiresAt ?? null,
      };
    }
  }

  return {
    ...DEFAULT_STATE,
    walletAddress,
  };
}

async function parseJson<T>(response: Response): Promise<T> {
  try {
    return (await response.json()) as T;
  } catch (error) {
    throw new Error('Unable to parse response from payments service');
  }
}

type StatusResponse = {
  verified: boolean;
  expiresAt?: string | null;
  remainingDays?: number | null;
  error?: string;
};

type PayResponse = {
  verified: boolean;
  expiresAt?: string | null;
  remainingDays?: number | null;
  wallet?: string;
  token?: string;
  error?: string;
};

export default function usePaymentStatus(walletAddress: string | null): PaymentStatusValue {
  const [state, setState] = useState<BaseState>(() => createInitialState(walletAddress));

  const clearError = useCallback(() => {
    setState((prev) => ({ ...prev, error: undefined }));
  }, []);

  const refresh = useCallback(async () => {
    if (!walletAddress) {
      setState(createInitialState(null));
      return;
    }

    const stored = loadUnlock(walletAddress);
    const token = stored?.token ?? null;

    setState((prev) => ({
      ...prev,
      walletAddress,
      token,
      expiresAt: stored?.expiresAt ?? prev.expiresAt,
      loading: true,
      error: undefined,
    }));

    if (!token) {
      setState((prev) => ({
        ...prev,
        walletAddress,
        loading: false,
        verified: false,
        token: null,
        error: prev.error ?? 'Payment verification required.',
      }));
      return;
    }

    try {
      const response = await fetch('/api/payments/status', {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        cache: 'no-store',
      });

      const data = await parseJson<StatusResponse>(response);

      if (!response.ok) {
        if (response.status === 401) {
          clearUnlock(walletAddress);
        }
        throw new Error(data.error ?? 'Unable to retrieve payment status');
      }

      setState((prev) => ({
        ...prev,
        walletAddress,
        loading: false,
        verified: Boolean(data.verified),
        remainingDays:
          typeof data.remainingDays === 'number' ? data.remainingDays : prev.remainingDays,
        expiresAt: data.expiresAt ?? prev.expiresAt,
        token,
        error: undefined,
      }));
    } catch (error) {
      setState((prev) => ({
        ...prev,
        walletAddress,
        loading: false,
        verified: false,
        token: null,
        error: error instanceof Error ? error.message : 'Failed to retrieve payment status',
      }));
    }
  }, [walletAddress]);

  const verifyPayment = useCallback(
    async (signature: string) => {
      const normalizedSignature = signature.trim();

      if (!walletAddress) {
        setState((prev) => ({
          ...prev,
          error: 'Connect your wallet before verifying payment.',
        }));
        throw new Error('Wallet not connected');
      }

      if (!normalizedSignature) {
        setState((prev) => ({
          ...prev,
          error: 'A Solana transaction signature is required.',
        }));
        throw new Error('Missing signature');
      }

      setState((prev) => ({
        ...prev,
        verifying: true,
        error: undefined,
      }));

      try {
        const response = await fetch('/api/payments/pay', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ wallet: walletAddress, signature: normalizedSignature }),
        });

        const data = await parseJson<PayResponse>(response);

        if (!response.ok) {
          throw new Error(data.error ?? 'Payment verification failed');
        }

        if (data.token) {
          saveUnlock({
            wallet: walletAddress,
            token: data.token,
            expiresAt: data.expiresAt ?? null,
            storedAt: new Date().toISOString(),
          });
        }

        setState((prev) => ({
          ...prev,
          verifying: false,
          verified: Boolean(data.verified),
          token: data.token ?? prev.token,
          error: undefined,
          remainingDays:
            typeof data.remainingDays === 'number'
              ? data.remainingDays
              : prev.remainingDays,
          expiresAt: data.expiresAt ?? prev.expiresAt,
        }));
      } catch (error) {
        clearUnlock(walletAddress);
        setState((prev) => ({
          ...prev,
          verifying: false,
          verified: false,
          token: null,
          error: error instanceof Error ? error.message : 'Payment verification failed',
        }));
        throw error;
      }
    },
    [walletAddress]
  );

  useEffect(() => {
    setState(createInitialState(walletAddress));

    if (!walletAddress) {
      return;
    }

    void refresh();
  }, [walletAddress, refresh]);

  return useMemo(
    () => ({
      ...state,
      walletAddress,
      refresh,
      verifyPayment,
      clearError,
    }),
    [state, walletAddress, refresh, verifyPayment, clearError]
  );
}
