import { useEffect, useState } from "react";
import { browser } from "wxt/browser";
import { useApi } from "@/components/hooks";
import { CheckForm, Eyebrow, ReportForm, VerdictView } from "@/components/shield";
import { Brand, Notice } from "@/components/ui";
import { errorText } from "@/lib/format";
import type { ShieldStatus } from "@/lib/messages";
import { call } from "@/lib/rpc";
import type { Verdict } from "@/lib/shield";

function openDashboard(): void {
  void browser.tabs.create({ url: browser.runtime.getURL("/dashboard.html") });
}

function minutesLeft(until: number): number {
  return Math.max(1, Math.ceil((until - Date.now()) / 60_000));
}

/** The toolbar popup: this site's verdict, a report button, a check box, and the pocket when it is on. */
export function App() {
  const [tabUrl, setTabUrl] = useState<string | null>(null);
  const [status, setStatus] = useState<ShieldStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reporting, setReporting] = useState(false);
  const [checked, setChecked] = useState<{ host: string; verdict: Verdict } | null>(null);
  const settings = useApi("settings:get", {});
  const vault = useApi("vault:status", {});

  useEffect(() => {
    browser.tabs
      .query({ active: true, currentWindow: true })
      .then((tabs) => setTabUrl(tabs[0]?.url ?? ""))
      .catch(() => setTabUrl(""));
  }, []);

  useEffect(() => {
    if (tabUrl === null) return;
    call("shield:status", { url: tabUrl })
      .then((s) => {
        setStatus(s);
        setError(s.error);
      })
      .catch((e: unknown) => setError(errorText(e)));
  }, [tabUrl]);

  const enable = () =>
    call("settings:set", { patch: { shield: { enabled: true, resolver: status?.resolver ?? "https://dns.payhole.org" } } })
      .then(() => setStatus((s) => (s ? { ...s, enabled: true } : s)))
      .catch((e: unknown) => setError(errorText(e)));

  const payOn = settings.data?.pay.enabled === true;

  return (
    <div className="popup-body">
      <div className="row between topbar">
        <Brand compact />
        <button type="button" onClick={openDashboard}>Dashboard</button>
      </div>

      {status && !status.enabled ? (
        <Notice kind="error">
          <div className="row between">
            <span>Shield off.</span>
            <button type="button" onClick={() => void enable()}>Turn on</button>
          </div>
        </Notice>
      ) : null}

      <section className="panel">
        {!status && !error ? <p className="muted">Checking this site</p> : null}
        {error ? <Notice kind="error">{error}</Notice> : null}
        {status && !status.host && !error ? (
          <div className="stack tight">
            <Eyebrow tone="muted">This tab</Eyebrow>
            <p className="lead">Not a website. Nothing to check.</p>
          </div>
        ) : null}
        {status?.verdict ? (
          <>
            <VerdictView verdict={status.verdict} />
            {status.allowedUntil ? <p className="warn small">Opened on purpose. {minutesLeft(status.allowedUntil)} min left.</p> : null}
            {!status.verdict.blocked ? (
              <div className="row actions">
                <button type="button" onClick={() => setReporting((r) => !r)}>{reporting ? "Cancel" : "Report this site"}</button>
              </div>
            ) : null}
            {reporting && status.host ? <ReportForm name={status.host} /> : null}
          </>
        ) : null}
      </section>

      <section className="panel">
        <div className="stack">
          <Eyebrow>Check a link</Eyebrow>
          <CheckForm onResult={(host, verdict) => setChecked({ host, verdict })} />
          {checked ? <VerdictView verdict={checked.verdict} /> : null}
          {checked && !checked.verdict.blocked ? <ReportForm name={checked.host} /> : null}
        </div>
      </section>

      {payOn ? (
        <section className="panel">
          <div className="row between">
            <div className="stack tight">
              <Eyebrow>Pay</Eyebrow>
              <p className="lead">{vault.data ? (vault.data.unlocked ? "Pocket unlocked." : vault.data.exists ? "Pocket locked." : "No pocket yet.") : "Loading"}</p>
            </div>
            <button type="button" onClick={openDashboard}>Open</button>
          </div>
        </section>
      ) : null}
    </div>
  );
}
