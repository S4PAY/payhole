'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

export type AnalyticsMetrics = {
  dau: number;
  paidUsers: number;
  blockedRequests: number;
  revenue: {
    daily: number;
    monthly: number;
    currency: string;
  };
  updatedAt: string;
};

type State = {
  loading: boolean;
  error?: string;
  metrics: AnalyticsMetrics | null;
};

const ADMIN_TOKEN_STORAGE_KEY = 'payhole.admin.jwt';

function readStoredToken(): string | null {
  if (typeof window === 'undefined') {
    return null;
  }

  return window.localStorage.getItem(ADMIN_TOKEN_STORAGE_KEY);
}

function persistToken(token: string | null) {
  if (typeof window === 'undefined') {
    return;
  }

  if (!token) {
    window.localStorage.removeItem(ADMIN_TOKEN_STORAGE_KEY);
  } else {
    window.localStorage.setItem(ADMIN_TOKEN_STORAGE_KEY, token);
  }
}

export function useAdminAnalytics() {
  const [token, setToken] = useState<string | null>(() => readStoredToken());
  const [state, setState] = useState<State>({ loading: false, metrics: null });

  const fetchMetrics = useCallback(async (adminToken: string) => {
    const response = await fetch('/api/admin/analytics', {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${adminToken}`,
      },
      cache: 'no-store',
    });

    const payload = await response.json().catch(() => ({ error: 'Invalid response payload' }));

    if (!response.ok) {
      const message = payload?.error ?? 'Unable to load analytics data';
      const error = new Error(message) as Error & { status?: number };
      error.status = response.status;
      throw error;
    }

    return payload.metrics as AnalyticsMetrics;
  }, []);

  const refresh = useCallback(
    async (overrideToken?: string) => {
      const activeToken = overrideToken ?? token ?? readStoredToken();

      if (!activeToken) {
        setState({ loading: false, metrics: null, error: undefined });
        return;
      }

      setState((prev) => ({ ...prev, loading: true, error: undefined }));

      try {
        const metrics = await fetchMetrics(activeToken);
        persistToken(activeToken);
        setToken(activeToken);
        setState({ loading: false, metrics });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unable to load analytics data';
        if (error instanceof Error && 'status' in error && error.status === 401) {
          persistToken(null);
          setToken(null);
        }
        setState({ loading: false, metrics: null, error: message });
      }
    },
    [fetchMetrics, token]
  );

  const authenticate = useCallback(
    async (adminToken: string) => {
      await refresh(adminToken);
    },
    [refresh]
  );

  const logout = useCallback(() => {
    persistToken(null);
    setToken(null);
    setState({ loading: false, metrics: null, error: undefined });
  }, []);

  useEffect(() => {
    if (token) {
      void refresh(token);
    }
  }, [token, refresh]);

  return useMemo(
    () => ({
      token,
      loading: state.loading,
      error: state.error,
      metrics: state.metrics,
      authenticate,
      refresh,
      logout,
    }),
    [token, state, authenticate, refresh, logout]
  );
}


