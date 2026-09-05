import { useCallback, useEffect, useRef, useState } from "react";

import type { NativeState } from "../../modules/payhole-dns";
import { dns, OFF_STATE, type DnsPlatform } from "../native/dns";
import { validateSettings, type ResolverSettings } from "../store/settings";

export interface Protection {
  state: NativeState;
  busy: boolean;
  message: string | null;
  supported: boolean;
  platform: DnsPlatform;
  /** Turns protection on with the given settings, or off when it is on or half-installed. */
  toggle(): Promise<void>;
  /** Re-applies a new resolver to a running tunnel or an installed profile. */
  applyResolver(settings: ResolverSettings): Promise<void>;
  refresh(): Promise<void>;
  openSettings(): void;
  dismissMessage(): void;
}

const POLL_MS = 2000;

function describe(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

export function useProtection(settings: ResolverSettings): Protection {
  const [state, setState] = useState<NativeState>(OFF_STATE);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const mounted = useRef(true);

  const refresh = useCallback(async () => {
    try {
      const next = await dns.getState();
      if (mounted.current) setState(next);
    } catch (error) {
      if (mounted.current) setMessage(describe(error));
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    void refresh();
    const unsubscribe = dns.subscribe((next) => {
      if (mounted.current) setState({ ...OFF_STATE, ...next });
    });
    const timer = setInterval(() => void refresh(), POLL_MS);
    return () => {
      mounted.current = false;
      unsubscribe();
      clearInterval(timer);
    };
  }, [refresh]);

  const start = useCallback(async (current: ResolverSettings) => {
    const validation = validateSettings(current);
    if (!validation.ok) {
      setMessage(validation.error);
      return;
    }
    if (dns.platform === "android") {
      await dns.requestNotificationPermission().catch(() => false);
      const consented = await dns.prepare();
      if (!consented) {
        setMessage("Android did not grant the VPN permission, so the tunnel cannot start.");
        return;
      }
    }
    await dns.start(validation.active);
  }, []);

  const run = useCallback(
    async (work: () => Promise<void>) => {
      setBusy(true);
      setMessage(null);
      try {
        await work();
        await refresh();
      } catch (error) {
        setMessage(describe(error));
      } finally {
        if (mounted.current) setBusy(false);
      }
    },
    [refresh],
  );

  const toggle = useCallback(
    () =>
      run(async () => {
        const active = state.status === "on" || state.status === "connecting" || state.needsUserAction;
        if (active) await dns.stop();
        else await start(settings);
      }),
    [run, start, settings, state],
  );

  const applyResolver = useCallback(
    (next: ResolverSettings) =>
      run(async () => {
        const active = state.status === "on" || state.status === "connecting" || state.needsUserAction;
        if (active) await start(next);
      }),
    [run, start, state],
  );

  return {
    state,
    busy,
    message,
    supported: dns.supported,
    platform: dns.platform,
    toggle,
    applyResolver,
    refresh,
    openSettings: () => dns.openSettings(),
    dismissMessage: () => setMessage(null),
  };
}
