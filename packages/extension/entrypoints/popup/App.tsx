import { useEffect, useState } from "react";
import { browser } from "wxt/browser";
import { useAction, useApi } from "@/components/hooks";
import { ActionStatus, Address, LedgerTable, Notice, Panel, Usdg } from "@/components/ui";
import { call } from "@/lib/rpc";
import { formatUsdg, toBigint } from "@/lib/format";
import type { SiteCard, VaultStatus } from "@/lib/messages";

function openDashboard(): void {
  void browser.tabs.create({ url: browser.runtime.getURL("/dashboard.html") });
}

export function App() {
  const status = useApi("vault:status", {});
  if (status.loading && !status.data) return <div className="popup-body muted">Loading...</div>;
  if (status.error) return <div className="popup-body"><Notice kind="error">{status.error}</Notice></div>;
  if (!status.data) return null;
  if (!status.data.exists) return <Onboarding onDone={status.reload} />;
  if (!status.data.unlocked) return <Unlock onDone={status.reload} />;
  return <Main status={status.data} reload={status.reload} />;
}

function Onboarding({ onDone }: { onDone: () => void }) {
  const [mode, setMode] = useState<"choose" | "create" | "import" | "confirm">("choose");
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [mnemonic, setMnemonic] = useState("");
  const [imported, setImported] = useState("");
  const [check, setCheck] = useState<{ index: number; word: string }[]>([]);
  const [answers, setAnswers] = useState<string[]>(["", ""]);
  const action = useAction();

  const create = () => {
    if (password !== password2) {
      action.run(() => Promise.reject(new Error("passwords do not match")));
      return;
    }
    action.run(async () => {
      const result = await call("vault:create", { password });
      const words = result.mnemonic.split(" ");
      const first = Math.floor(Math.random() * words.length);
      let second = Math.floor(Math.random() * words.length);
      if (second === first) second = (first + 1) % words.length;
      setCheck([first, second].sort((a, b) => a - b).map((index) => ({ index, word: words[index] ?? "" })));
      setMnemonic(result.mnemonic);
      setMode("confirm");
    });
  };

  const confirm = () => {
    const ok = check.every((c, i) => (answers[i] ?? "").trim().toLowerCase() === c.word);
    if (!ok) {
      action.run(() => Promise.reject(new Error("the words do not match; check your backup")));
      return;
    }
    setMnemonic("");
    onDone();
  };

  const doImport = () => {
    if (password !== password2) {
      action.run(() => Promise.reject(new Error("passwords do not match")));
      return;
    }
    action.run(async () => {
      await call("vault:import", { mnemonic: imported, password });
      setImported("");
      onDone();
    });
  };

  return (
    <div className="popup-body">
      <h1>PayHole</h1>
      {mode === "choose" ? (
        <Panel>
          <p>Spending pocket for Robinhood Chain. Create a new seed or import one.</p>
          <div className="row">
            <button type="button" className="primary" onClick={() => setMode("create")}>Create seed</button>
            <button type="button" onClick={() => setMode("import")}>Import seed</button>
          </div>
        </Panel>
      ) : null}
      {mode === "create" || mode === "import" ? (
        <Panel title={mode === "create" ? "New seed" : "Import seed"}>
          <div className="stack">
            {mode === "import" ? (
              <label>
                12 or 24 word mnemonic
                <textarea value={imported} onChange={(e) => setImported(e.target.value)} autoComplete="off" spellCheck={false} />
              </label>
            ) : null}
            <label>
              Password (at least 8 characters)
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
            </label>
            <label>
              Repeat password
              <input type="password" value={password2} onChange={(e) => setPassword2(e.target.value)} autoComplete="new-password" />
            </label>
            <ActionStatus action={action} />
            <div className="row">
              <button type="button" className="primary" disabled={action.busy} onClick={mode === "create" ? create : doImport}>
                {mode === "create" ? "Create" : "Import"}
              </button>
              <button type="button" onClick={() => setMode("choose")}>Back</button>
            </div>
          </div>
        </Panel>
      ) : null}
      {mode === "confirm" ? (
        <Panel title="Write these words down">
          <p className="muted">They are shown once. Anyone with them controls every address of this wallet.</p>
          <div className="mnemonic">
            {mnemonic.split(" ").map((word, i) => (
              <div key={i}>
                <span>{i + 1}.</span>
                {word}
              </div>
            ))}
          </div>
          <div className="stack" style={{ marginTop: 8 }}>
            {check.map((c, i) => (
              <label key={c.index}>
                Word {c.index + 1}
                <input type="text" value={answers[i] ?? ""} autoComplete="off" onChange={(e) => setAnswers((a) => a.map((v, j) => (j === i ? e.target.value : v)))} />
              </label>
            ))}
            <ActionStatus action={action} />
            <button type="button" className="primary" onClick={confirm}>I wrote it down</button>
          </div>
        </Panel>
      ) : null}
    </div>
  );
}

function Unlock({ onDone }: { onDone: () => void }) {
  const [password, setPassword] = useState("");
  const action = useAction(onDone);
  return (
    <div className="popup-body">
      <h1>PayHole</h1>
      <Panel title="Unlock">
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            action.run(async () => {
              await call("vault:unlock", { password });
            });
          }}
        >
          <label>
            Password
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" autoFocus />
          </label>
          <ActionStatus action={action} />
          <div className="row">
            <button type="submit" className="primary" disabled={action.busy}>Unlock</button>
            <button type="button" onClick={openDashboard}>Dashboard</button>
          </div>
        </form>
      </Panel>
    </div>
  );
}

function Main({ status, reload }: { status: VaultStatus; reload: () => void }) {
  const [tabUrl, setTabUrl] = useState<string | null>(null);
  const [site, setSite] = useState<SiteCard | null>(null);
  const [siteError, setSiteError] = useState<string | null>(null);
  const recent = useApi("ledger:recent", { limit: 5 });
  const action = useAction(() => {
    reload();
    recent.reload();
  });

  useEffect(() => {
    browser.tabs
      .query({ active: true, currentWindow: true })
      .then((tabs) => setTabUrl(tabs[0]?.url ?? null))
      .catch(() => setTabUrl(null));
  }, []);

  useEffect(() => {
    if (!tabUrl || !/^https?:/.test(tabUrl)) {
      setSite(null);
      return;
    }
    call("site:current", { url: tabUrl })
      .then((card) => {
        setSite(card);
        setSiteError(null);
      })
      .catch((e: unknown) => setSiteError(e instanceof Error ? e.message : String(e)));
  }, [tabUrl]);

  return (
    <div className="popup-body">
      <div className="row between" style={{ marginBottom: 8 }}>
        <h1>PayHole</h1>
        <div className="row">
          <button type="button" onClick={openDashboard}>Dashboard</button>
          <button type="button" onClick={() => action.run(async () => { await call("vault:lock", {}); })}>Lock</button>
        </div>
      </div>
      {!status.budgetAccount ? <Notice>No BudgetAccount yet. Create one in the dashboard to start paying.</Notice> : null}
      <Panel title="This site">
        {siteError ? <Notice kind="error">{siteError}</Notice> : null}
        {!site ? (
          <p className="muted">Not an http(s) page.</p>
        ) : (
          <dl className="grid">
            <dt>Origin</dt>
            <dd className="mono">{site.origin}</dd>
            <dt>Address</dt>
            <dd>{site.address ? <Address value={site.address} /> : "-"}</dd>
            <dt>Spent</dt>
            <dd>
              {formatUsdg(toBigint(site.spent))} of <Usdg value={site.cap} /> {site.override ? <span className="muted">(override)</span> : null}
            </dd>
            <dt>Blocked</dt>
            <dd>{site.blocked ? <span className="danger">yes ({site.blocked.reason})</span> : "no"}</dd>
            <dt>Creator</dt>
            <dd>{site.creator ? site.creator.registered ? <span className="ok">registered <Address value={site.creator.wallet} /></span> : "not registered" : <span className="muted">registry not configured</span>}</dd>
          </dl>
        )}
      </Panel>
      <Panel title="Payments">
        <label className="inline">
          <input
            type="checkbox"
            checked={status.pausedAll}
            onChange={(e) => action.run(async () => { await call("settings:set", { patch: { pausedAll: e.target.checked } }); })}
          />
          Pause all payments
        </label>
        <ActionStatus action={action} />
        <LedgerTable entries={recent.data ?? []} />
      </Panel>
    </div>
  );
}
