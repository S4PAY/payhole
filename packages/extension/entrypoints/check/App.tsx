import { useEffect, useState } from "react";
import { browser } from "wxt/browser";
import { CheckForm, ReportForm, VerdictView } from "@/components/shield";
import { Brand, Notice } from "@/components/ui";
import { errorText } from "@/lib/format";
import { call } from "@/lib/rpc";
import { hostnameOf, parseCheckPage, type Verdict } from "@/lib/shield";

function openDashboard(): void {
  void browser.tabs.create({ url: browser.runtime.getURL("/dashboard.html") });
}

/** Back to wherever the person came from, or close a tab that has nowhere to go back to. */
async function goBack(): Promise<void> {
  if (history.length > 1) {
    history.back();
    return;
  }
  const tab = await browser.tabs.getCurrent();
  if (tab?.id !== undefined) await browser.tabs.remove(tab.id);
}

/**
 * Two jobs on one page: the wall a blocked navigation lands on, and the answer for a link checked from the
 * context menu. Opened plain, it is a check box.
 */
export function App() {
  const [url] = useState(() => parseCheckPage(location));
  const [host, setHost] = useState<string | null>(() => (url ? hostnameOf(url) : null));
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reporting, setReporting] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!url) return;
    call("shield:status", { url })
      .then((status) => {
        if (status.error) setError(status.error);
        setVerdict(status.verdict);
        // Opened on purpose a moment ago and caught by a rule that was still being dropped: carry on.
        if (status.allowedUntil !== null) location.replace(url);
      })
      .catch((e: unknown) => setError(errorText(e)));
  }, [url]);

  const openOnce = async () => {
    if (!host || !url) return;
    setBusy(true);
    try {
      await call("shield:allowOnce", { host });
      location.replace(url);
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
    }
  };

  const blocked = verdict !== null && verdict.blocked && !verdict.allowlisted;

  return (
    <div className="check-page">
      <div className="row between topbar">
        <Brand />
        <button type="button" onClick={openDashboard}>Dashboard</button>
      </div>
      <section className={`panel wall ${blocked ? "danger" : ""}`}>
        {url && !host ? <Notice>Not a website address. Nothing to check.</Notice> : null}
        {url && host && !verdict && !error ? <p className="muted">Asking the resolver</p> : null}
        {error ? <Notice kind="error">{error}</Notice> : null}
        {verdict ? <VerdictView verdict={verdict} big /> : null}
        {!url ? (
          <div className="stack">
            <div className="eyebrow accent">Check a link</div>
            <CheckForm
              autoFocus
              onResult={(name, result) => {
                setHost(name);
                setVerdict(result);
                setReporting(false);
              }}
            />
          </div>
        ) : null}
        {verdict ? (
          <div className="row actions">
            {url && blocked ? (
              <>
                <button type="button" className="primary" onClick={() => void goBack()}>Go back</button>
                <button type="button" className="danger" disabled={busy} onClick={() => void openOnce()}>Open once, 10 minutes</button>
              </>
            ) : null}
            {url && !blocked ? (
              <button type="button" className="primary" onClick={() => location.replace(url)}>Open</button>
            ) : null}
            {!blocked && host ? (
              <button type="button" onClick={() => setReporting((r) => !r)}>{reporting ? "Cancel" : "Report"}</button>
            ) : null}
            {host ? (
              <a href={`https://payhole.org/check.html?name=${encodeURIComponent(host)}`} target="_blank" rel="noreferrer" className="link-button">
                On payhole.org
              </a>
            ) : null}
          </div>
        ) : null}
        {reporting && host ? <ReportForm name={host} onDone={() => undefined} /> : null}
      </section>
      {verdict ? (
        <p className="muted small">
          {blocked ? "Blocked: no PayHole phone or browser loads it. Open once lets this browser through for ten minutes." : "Not blocked: nothing known today, not a promise. Report it if it is a scam and the network learns."}
        </p>
      ) : null}
    </div>
  );
}
