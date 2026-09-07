import { useState } from "react";
import { useAction, useApi } from "@/components/hooks";
import { CategoryTag } from "@/components/shield";
import { ActionStatus, Notice, Panel } from "@/components/ui";
import { formatTimestamp } from "@/lib/format";
import { call } from "@/lib/rpc";

/** The shield's switches and what it did this session. */
export function Shield() {
  const settings = useApi("settings:get", {});
  const recent = useApi("shield:recent", {});
  const action = useAction(() => {
    settings.reload();
    recent.reload();
  });
  const [resolver, setResolver] = useState<string | null>(null);

  if (settings.error) return <Notice kind="error">{settings.error}</Notice>;
  if (!settings.data) return <p className="muted">Loading...</p>;
  const shield = settings.data.shield;
  const pay = settings.data.pay;
  const events = recent.data ?? [];

  return (
    <>
      <ActionStatus action={action} />
      <Panel title="Shield">
        <div className="stack">
          <label className="inline">
            <input
              type="checkbox"
              checked={shield.enabled}
              onChange={(e) => action.run(async () => { await call("settings:set", { patch: { shield: { ...shield, enabled: e.target.checked } } }); })}
            />
            Check every site and stop the listed ones
          </label>
          <p className="muted small">Each new site is asked about once at the public resolver, the same answer the app gets. No page content leaves the browser, only the name.</p>
          <label>
            Resolver
            <input type="url" value={resolver ?? shield.resolver} onChange={(e) => setResolver(e.target.value)} />
          </label>
          <div className="row">
            <button
              type="button"
              disabled={action.busy || resolver === null || resolver === shield.resolver}
              onClick={() => action.run(async () => { await call("settings:set", { patch: { shield: { ...shield, resolver: (resolver ?? shield.resolver).trim() } } }); setResolver(null); })}
            >
              Save
            </button>
            <button type="button" onClick={() => setResolver("https://dns.payhole.org")}>Default</button>
          </div>
        </div>
      </Panel>
      <Panel title={`This session (${events.length})`}>
        {events.length === 0 ? <p className="muted">Nothing stopped yet.</p> : null}
        {events.length > 0 ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>When</th>
                  <th>Name</th>
                  <th>What</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {events.map((event) => (
                  <tr key={`${event.at}-${event.host}`}>
                    <td>{formatTimestamp(event.at)}</td>
                    <td className="mono">{event.host}</td>
                    <td><CategoryTag category={event.category} /></td>
                    <td className={event.action === "blocked" ? "danger" : "warn"}>{event.action === "blocked" ? "stopped" : "opened once"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </Panel>
      <Panel title="Pay module">
        <div className="stack">
          <label className="inline">
            <input
              type="checkbox"
              checked={pay.enabled}
              onChange={(e) => action.run(async () => { await call("settings:set", { patch: { pay: { enabled: e.target.checked } } }); })}
            />
            The x402 spending pocket
          </label>
          <p className="muted small">Pays sites that answer HTTP 402 in USDG on Robinhood Chain from capped per-site addresses. Off by default; the shield needs none of it.</p>
          {pay.enabled ? (
            <label className="inline">
              <input
                type="checkbox"
                checked={settings.data.pausedAll}
                onChange={(e) => action.run(async () => { await call("settings:set", { patch: { pausedAll: e.target.checked } }); })}
              />
              Pause all payments
            </label>
          ) : null}
        </div>
      </Panel>
    </>
  );
}
