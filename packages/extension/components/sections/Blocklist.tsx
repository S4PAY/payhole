import { useState } from "react";
import { useAction, useApi } from "@/components/hooks";
import { ActionStatus, Notice, Panel } from "@/components/ui";
import { BLOCK_REASONS, EXPORT_FORMATS, type BlockReason, type ExportFormat } from "@/lib/blocklist";
import { formatTimestamp } from "@/lib/format";
import { call } from "@/lib/rpc";

export function Blocklist() {
  const view = useApi("blocklist:view", {});
  const action = useAction(view.reload);
  const [domain, setDomain] = useState("");
  const [reason, setReason] = useState<BlockReason>("tracker");
  const [format, setFormat] = useState<ExportFormat>("hostnames");
  const [exportText, setExportText] = useState<string | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);

  if (view.error) return <Notice kind="error">{view.error}</Notice>;
  if (!view.data) return <p className="muted">Loading...</p>;
  const data = view.data;
  const sync = data.sync;

  return (
    <>
      <ActionStatus action={action} />
      <Panel title="Flag a hostname">
        <form
          className="row"
          onSubmit={(e) => {
            e.preventDefault();
            action.run(async () => {
              await call("blocklist:add", { domain, reason });
              setDomain("");
            });
          }}
        >
          <label>
            Hostname
            <input type="text" value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="tracker.example" />
          </label>
          <label>
            Reason
            <select value={reason} onChange={(e) => setReason(e.target.value as BlockReason)}>
              {BLOCK_REASONS.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          </label>
          <button type="submit" className="primary" disabled={action.busy}>Block</button>
        </form>
        <p className="muted">Blocked hostnames and all their subdomains get no payments; their 402s are refused. The Sinkhole turns the same list into DNS answers.</p>
      </Panel>
      <Panel title={`Blocked (${data.entries.length})`}>
        {data.entries.length === 0 ? <p className="muted">Nothing blocked.</p> : null}
        <div className="table-wrap">
          <table>
            <tbody>
              {data.entries.map((entry) => (
                <tr key={entry.domain}>
                  <td className="mono">{entry.domain}</td>
                  <td>{entry.reason}</td>
                  <td className="muted">{formatTimestamp(entry.flaggedAt)}</td>
                  <td>
                    <button type="button" disabled={action.busy} onClick={() => action.run(async () => { await call("blocklist:remove", { domain: entry.domain }); })}>Remove</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
      <Panel title="Export">
        <div className="row">
          <select value={format} onChange={(e) => setFormat(e.target.value as ExportFormat)}>
            {EXPORT_FORMATS.map((f) => (
              <option key={f} value={f}>{f}</option>
            ))}
          </select>
          <button type="button" onClick={() => action.run(async () => { setExportText((await call("blocklist:export", { format })).text); })}>Show</button>
          {exportText !== null ? (
            <button type="button" onClick={() => { void navigator.clipboard.writeText(exportText); }}>Copy</button>
          ) : null}
        </div>
        {exportText !== null ? <pre style={{ marginTop: 8 }}>{exportText || "(empty)"}</pre> : null}
      </Panel>
      <Panel title="Sinkhole sync">
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            action.run(async () => {
              await call("settings:set", { patch: { sinkhole: { url: url ?? data.sinkhole.url, token: token ?? data.sinkhole.token } } });
              setUrl(null);
              setToken(null);
              return "sinkhole settings saved; syncing";
            });
          }}
        >
          <label>
            Sinkhole URL (the extension PUTs {"<url>/api/blocklist"})
            <input type="url" value={url ?? data.sinkhole.url} onChange={(e) => setUrl(e.target.value)} placeholder="https://sinkhole.example" />
          </label>
          <label>
            Bearer token
            <input type="password" value={token ?? data.sinkhole.token} onChange={(e) => setToken(e.target.value)} autoComplete="off" />
          </label>
          <div className="row">
            <button type="submit" disabled={action.busy}>Save</button>
            <button type="button" disabled={action.busy || !data.sinkhole.url} onClick={() => action.run(async () => { const s = await call("blocklist:sync", {}); return s.lastError ? `sync failed: ${s.lastError}` : "synced"; })}>
              Sync now
            </button>
          </div>
        </form>
        <dl className="grid" style={{ marginTop: 8 }}>
          <dt>Last attempt</dt>
          <dd>{sync.lastAttemptAt ? formatTimestamp(sync.lastAttemptAt) : "never"}</dd>
          <dt>Last success</dt>
          <dd>{sync.lastSuccessAt ? formatTimestamp(sync.lastSuccessAt) : "never"}</dd>
          <dt>Status</dt>
          <dd className={sync.lastError ? "danger" : "ok"}>{sync.lastError ?? (sync.lastStatus ? `HTTP ${sync.lastStatus}` : "-")}</dd>
        </dl>
        <p className="muted">Syncs on every change and every 15 minutes.</p>
      </Panel>
    </>
  );
}
