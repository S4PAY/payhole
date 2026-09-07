import { useCallback, useEffect, useRef, useState } from "react";

import type { Category } from "../dns/verdict";
import { LINKS } from "../links";
import { fetchRewards, requestPayout, sendReport, type ReportResult, type RewardsSummary } from "../report/client";
import { buildDelegatedFlag, checksumAddress, isAddress, parseProof, privateKeyToAddress, signHint, type Proof } from "../report/identity";
import { loadOrCreateKey, loadProof, loadReports, loadWallet, saveProof, saveReports, saveWallet, type LocalReport } from "../report/store";

export interface Reporter {
  ready: boolean;
  /** This phone's reporter address. */
  address: string | null;
  /** The tier holder this phone reports for, once a proof is linked. */
  holder: string | null;
  /** Where bounties go: the wallet the person named, or the linked holder. */
  wallet: string | null;
  walletIsOwn: boolean;
  setWallet: (input: string) => Promise<string | null>;
  link: (proofText: string) => Promise<string | null>;
  unlink: () => Promise<void>;
  report: (input: { name: string; category: Category | null; reason: string }) => Promise<{ result: ReportResult; fellBack: boolean }>;
  /** Names this phone reported, newest first. */
  reports: LocalReport[];
  rewards: RewardsSummary | null;
  rewardsError: string | null;
  refreshRewards: () => Promise<void>;
  claim: () => Promise<{ status: string; detail: string | null }>;
}

/** The phone's reporter identity, its rewards wallet, and the two ways a report can travel: as a hint, or as a tier holder's flag. */
export function useReporter(): Reporter {
  const key = useRef<Uint8Array | null>(null);
  const [address, setAddress] = useState<string | null>(null);
  const [proof, setProof] = useState<Proof | null>(null);
  const [ownWallet, setOwnWallet] = useState<string | null>(null);
  const [reports, setReports] = useState<LocalReport[]>([]);
  const [rewards, setRewards] = useState<RewardsSummary | null>(null);
  const [rewardsError, setRewardsError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    Promise.all([loadOrCreateKey(), loadProof(), loadWallet(), loadReports()]).then(
      ([loaded, storedProof, storedWallet, storedReports]) => {
        if (cancelled) return;
        key.current = loaded;
        const own = privateKeyToAddress(loaded);
        setAddress(own);
        setProof(storedProof?.peerId.toLowerCase() === own.toLowerCase() ? storedProof : null);
        setOwnWallet(storedWallet);
        setReports(storedReports);
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

  const wallet = ownWallet ?? proof?.address ?? null;

  const refreshRewards = useCallback(async () => {
    if (!wallet) {
      setRewards(null);
      return;
    }
    try {
      setRewards(await fetchRewards(LINKS.rewardsUrl, wallet));
      setRewardsError(null);
    } catch (error) {
      setRewardsError(error instanceof Error ? error.message : String(error));
    }
  }, [wallet]);

  useEffect(() => {
    if (ready) void refreshRewards();
  }, [ready, refreshRewards]);

  const setWallet = useCallback(async (input: string): Promise<string | null> => {
    const trimmed = input.trim();
    if (trimmed.length === 0) {
      await saveWallet(null);
      setOwnWallet(null);
      return null;
    }
    if (!isAddress(trimmed)) return "That is not a wallet address. It starts with 0x and has 40 characters after it.";
    const clean = checksumAddress(trimmed);
    await saveWallet(clean);
    setOwnWallet(clean);
    return null;
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

  const remember = useCallback(
    async (domain: string, category: Category | null) => {
      const next: LocalReport[] = [{ domain, category, at: Date.now() }, ...reports.filter((entry) => entry.domain !== domain)].slice(0, 100);
      setReports(next);
      await saveReports(next);
    },
    [reports],
  );

  const report = useCallback(
    async ({ name, category, reason }: { name: string; category: Category | null; reason: string }) => {
      const signer = key.current;
      const hint = () => sendReport(LINKS.reportUrl, signer ? signHint(signer, name, category, reason, wallet) : { name, ...(category ? { category } : {}), ...(reason ? { reason } : {}) });
      let outcome: { result: ReportResult; fellBack: boolean };
      if (!proof || !signer) {
        outcome = { result: await hint(), fellBack: false };
      } else {
        const message = buildDelegatedFlag(signer, proof, { type: "flag", domain: name, reason: reason || "reported from a phone", ts: Date.now(), ...(category ? { category } : {}) });
        const signed = await sendReport(LINKS.reportUrl, { message });
        outcome = signed.status === "rejected" && signed.detail.includes("not accepted") ? { result: await hint(), fellBack: true } : { result: signed, fellBack: false };
      }
      if (outcome.result.status === "hinted" || outcome.result.status === "flagged" || outcome.result.status === "confirmed") {
        await remember(outcome.result.domain, category);
        void refreshRewards();
      }
      return outcome;
    },
    [proof, wallet, remember, refreshRewards],
  );

  const claim = useCallback(async () => {
    if (!wallet) return { status: "no_wallet", detail: "Add a rewards wallet first." };
    const outcome = await requestPayout(LINKS.claimUrl, wallet);
    await refreshRewards();
    return outcome;
  }, [wallet, refreshRewards]);

  return { ready, address, holder: proof?.address ?? null, wallet, walletIsOwn: ownWallet !== null, setWallet, link, unlink, report, reports, rewards, rewardsError, refreshRewards, claim };
}
