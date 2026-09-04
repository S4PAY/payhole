import { useCallback, useEffect, useState } from "react";
import { call } from "@/lib/rpc";
import type { Api, ApiName } from "@/lib/messages";
import { errorText } from "@/lib/format";

export interface Loaded<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  reload: () => void;
}

/** Loads one API view and exposes a reload for after mutations. */
export function useApi<K extends ApiName>(type: K, params: Api[K]["params"], deps: unknown[] = []): Loaded<Api[K]["result"]> {
  const [data, setData] = useState<Api[K]["result"] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    call(type, params)
      .then((result) => {
        if (cancelled) return;
        setData(result);
        setError(null);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(errorText(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [type, tick, ...deps]);
  return { data, error, loading, reload };
}

export interface Action {
  run: (task: () => Promise<string | void>) => void;
  busy: boolean;
  message: string | null;
  error: string | null;
  clear: () => void;
}

/** Runs a mutation and keeps its outcome for display. */
export function useAction(onDone?: () => void): Action {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = useCallback(
    (task: () => Promise<string | void>) => {
      setBusy(true);
      setMessage(null);
      setError(null);
      task()
        .then((text) => {
          setMessage(text ?? "done");
          onDone?.();
        })
        .catch((e: unknown) => setError(errorText(e)))
        .finally(() => setBusy(false));
    },
    [onDone],
  );
  const clear = useCallback(() => {
    setMessage(null);
    setError(null);
  }, []);
  return { run, busy, message, error, clear };
}
