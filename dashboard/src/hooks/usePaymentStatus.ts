'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

type BaseState = {
  walletAddress: string | null;
  verified: boolean;
  loading: boolean;
  verifying: boolean;
  remainingDays: number | null;
  expiresAt: string | null;
  error?: string;
};

const DEFAULT_STATE: BaseState = {
  walletAddress: null,
  verified: false,
  loading: false,
  verifying: false,
  remainingDays: null,
  expiresAt: null,
  error: undefined,
};

const TOKEN_STORAGE_KEY = 'payhole.unlock.jwt';

type StatusResponse = {
  verified?: boolean;
  wallet?: string;
  expiresAt?: string | null;
  remainingDays?: number | null;
  error?: string;
};

type PayResponse = {
  verified?: boolean;
  token?: string;
  expiresAt?: string | null;
  remainingDays?: number | null;
  wallet?: string;
  error?: string;
};

export type PaymentStatusValue = BaseState & {
  token: string | null;
  refresh: (overrideToken?: string) => Promise<void>;
  verifyPayment: (signature: string) => Promise<void>;
  clearError: () => void;
  clearToken: () => void;
};

function createInitialState(walletAddress: string | null): BaseState {
  return {
    ...DEFAULT_STATE,
    walletAddress,
  };
}

function readStoredToken(): string | null {
  if (typeof window === 'undefined') {
    return null;
  }

  return window.localStorage.getItem(TOKEN_STORAGE_KEY);
}

function writeStoredToken(token: string | null) {
  if (typeof window === 'undefined') {
    return;
  }

  if (!token) {
    window.localStorage.removeItem(TOKEN_STORAGE_KEY);
    return;
  }

  window.localStorage.setItem(TOKEN_STORAGE_KEY, token);
}

function parseJson<T>(raw: string): T | null {
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw) as T;
  } catch (error) {
    return null;
  }
}

export default function usePaymentStatus(walletAddress: string | null): PaymentStatusValue {
  const [state, setState] = useState<BaseState>(() => createInitialState(walletAddress));
  const [token, setToken] = useState<string | null>(() => readStoredToken());

  const clearError = useCallback(() => {
    setState((prev) => ({ ...prev, error: undefined }));
  }, []);

  const persistToken = useCallback((value: string | null) => {
    writeStoredToken(value);
    setToken(value);
  }, []);

  const refresh = useCallback(
    async (overrideToken?: string) => {
      const activeWallet = walletAddress;
      const candidateToken = overrideToken ?? token ?? readStoredToken();

      if (!activeWallet || !candidateToken) {
        if (!candidateToken) {
          persistToken(null);
        }

        setState(createInitialState(activeWallet));
        return;
      }

      setState((prev) => ({
        ...prev,
        walletAddress: activeWallet,
        loading: true,
        error: undefined,
      }));

      try {
        const response = await fetch('/api/payments/status', {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${candidateToken}`,
          },
          cache: 'no-store',
        });

        const data = parseJson<StatusResponse>(await response.text());

        if (!response.ok || !data?.verified) {
          if (response.status === 401 || response.status === 404) {
            persistToken(null);
          }

          const message = data?.error ?? 'Unable to retrieve payment status';
          throw new Error(message);
        }

        persistToken(candidateToken);

        setState((prev) => ({
          ...prev,
          walletAddress: activeWallet,
          loading: false,
          verified: true,
          remainingDays:
            typeof data.remainingDays === 'number' ? data.remainingDays : prev.remainingDays,
          expiresAt: data.expiresAt ?? prev.expiresAt,
          error: undefined,
        }));
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to retrieve payment status';
        setState((prev) => ({
          ...prev,
          walletAddress: activeWallet,
          loading: false,
          verified: false,
          remainingDays: null,
          expiresAt: null,
          error: message,
        }));
      }
    },
    [persistToken, token, walletAddress]
  );

  const verifyPayment = useCallback(
    async (signature: string) => {
      const normalizedSignature = signature.trim();

      if (!walletAddress) {
        const message = 'Connect your wallet before verifying payment.';
        setState((prev) => ({ ...prev, error: message }));
        throw new Error(message);
      }

      if (!normalizedSignature) {
        const message = 'A Solana transaction signature is required.';
        setState((prev) => ({ ...prev, error: message }));
        throw new Error(message);
      }

      setState((prev) => ({ ...prev, verifying: true, error: undefined }));

      try {
        const response = await fetch('/api/payments/pay', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ wallet: walletAddress, signature: normalizedSignature }),
          cache: 'no-store',
        });

        const data = parseJson<PayResponse>(await response.text());

        if (!response.ok || !data?.token) {
          const message = data?.error ?? 'Payment verification failed';
          throw new Error(message);
        }

        persistToken(data.token);

        setState((prev) => ({
          ...prev,
          verifying: false,
          verified: Boolean(data.verified ?? true),
          remainingDays:
            typeof data.remainingDays === 'number' ? data.remainingDays : prev.remainingDays,
          expiresAt: data.expiresAt ?? prev.expiresAt,
          error: undefined,
        }));

        await refresh(data.token);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Payment verification failed';
        setState((prev) => ({
          ...prev,
          verifying: false,
          verified: false,
          error: message,
        }));
        throw error;
      }
    },
    [persistToken, refresh, walletAddress]
  );

  const clearToken = useCallback(() => {
    persistToken(null);
    setState((prev) => ({
      ...prev,
      verified: false,
      remainingDays: null,
      expiresAt: null,
    }));
  }, [persistToken]);

  useEffect(() => {
    setState((prev) => ({ ...prev, walletAddress }));

    if (!walletAddress) {
      return;
    }

    let cancelled = false;

    (async () => {
      await refresh();
      if (cancelled) {
        return;
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [walletAddress, refresh]);

  return useMemo(
    () => ({
      ...state,
      walletAddress,
      token,
      refresh,
      verifyPayment,
      clearError,
      clearToken,
    }),
    [state, walletAddress, token, refresh, verifyPayment, clearError, clearToken]
  );
}

