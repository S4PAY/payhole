import { useCallback, useEffect, useRef, useState } from "react";

import type { Category } from "../dns/verdict";
import { LINKS } from "../links";
import { sendReport, type ReportResult } from "../report/client";
import { buildDelegatedFlag, parseProof, privateKeyToAddress, type Proof } from "../report/identity";
import { loadOrCreateKey, loadProof, saveProof } from "../report/store";

export interface Reporter {
  ready: boolean;
  /** This phone's reporter address. */
  address: string | null;
  /** The tier holder this phone reports for, once a proof is linked. */
  holder: string | null;
  link: (proofText: string) => Promise<string | null>;
  unlink: () => Promise<void>;
  report: (input: { name: string; category: Category | null; reason: string }) => Promise<{ result: ReportResult; fellBack: boolean }>;
}

/** The phone's reporter identity and the two ways a report can travel: as a hint, or as a tier holder's flag. */
export function useReporter(): Reporter {
  const key = useRef<Uint8Array | null>(null);
  const [address, setAddress] = useState<string | null>(null);
  const [proof, setProof] = useState<Proof | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    Promise.all([loadOrCreateKey(), loadProof()]).then(
      ([loaded, stored]) => {
        if (cancelled) return;
        key.current = loaded;
        const own = privateKeyToAddress(loaded);
        setAddress(own);
        setProof(stored?.peerId.toLowerCase() === own.toLowerCase() ? stored : null);
        setReady(true);
      },
      () => {
        if (!cancelled) setReady(true);
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  const link = useCallback(
    async (proofText: string): Promise<string | null> => {
      if (!address) return "The reporter key is not ready yet.";
      const parsed = parseProof(proofText, address);
      if (!parsed.ok) return parsed.error;
      await saveProof(parsed.proof);
      setProof(parsed.proof);
      return null;
    },
    [address],
  );

  const unlink = useCallback(async () => {
    await saveProof(null);
    setProof(null);
  }, []);

  const report = useCallback(
    async ({ name, category, reason }: { name: string; category: Category | null; reason: string }) => {
      const hint = () => sendReport(LINKS.reportUrl, { name, ...(category ? { category } : {}), ...(reason ? { reason } : {}) });
      if (!proof || !key.current) return { result: await hint(), fellBack: false };
      const message = buildDelegatedFlag(key.current, proof, { type: "flag", domain: name, reason: reason || "reported from a phone", ts: Date.now(), ...(category ? { category } : {}) });
      const signed = await sendReport(LINKS.reportUrl, { message });
      if (signed.status === "rejected" && signed.detail.includes("not accepted")) return { result: await hint(), fellBack: true };
      return { result: signed, fellBack: false };
    },
    [proof],
  );

  return { ready, address, holder: proof?.address ?? null, link, unlink, report };
}
