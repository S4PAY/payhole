import { useCallback, useEffect, useState } from "react";

import { storage } from "../store/persist";
import { DEFAULT_SETTINGS, loadSettings, saveSettings, type ResolverSettings } from "../store/settings";

export interface SettingsHandle {
  ready: boolean;
  value: ResolverSettings;
  update(next: ResolverSettings): Promise<void>;
}

/** Resolver settings backed by AsyncStorage; `ready` flips once the stored value has been read. */
export function useSettings(): SettingsHandle {
  const [value, setValue] = useState<ResolverSettings>(DEFAULT_SETTINGS);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void loadSettings(storage).then((loaded) => {
      if (cancelled) return;
      setValue(loaded);
      setReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const update = useCallback(async (next: ResolverSettings) => {
    setValue(next);
    await saveSettings(storage, next);
  }, []);

  return { ready, value, update };
}
