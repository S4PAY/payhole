import { useState } from "react";
import { useAction, useApi } from "@/components/hooks";
import { ActionStatus, Notice, Panel, Usdg } from "@/components/ui";
import { formatAmount, formatTimestamp, parseUsdg, toBigint } from "@/lib/format";
import { call } from "@/lib/rpc";

export function Sites() {
  const view = useApi("sites:list", {});
  const action = useAction(view.reload);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [newOrigin, setNewOrigin] = useState("");
  const [newCap, setNewCap] = useState("");

  if (view.error) return <Notice kind="error">{view.error}</Notice>;
  if (!view.data) return <p className="muted">Loading...</p>;

  const save = (origin: string) => {
    const text = edits[origin];
    if (text === undefined) return;
    action.run(async () => {
      await call("site:setCap", { origin, cap: parseUsdg(text).toString() });
      setEdits((e) => {
        const next = { ...e };
        delete next[origin];
        return next;
      });
      return `cap for ${origin} saved`;
    });
  };

  return (
    <>
      <ActionStatus action={action} />
      <Panel title="Spend per site">
        {view.data.length === 0 ? <p className="muted">No sites yet. Caps are the lifetime amount each origin may spend before a prompt.</p> : null}
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Origin</th>
                <th>Spent</th>
                <th>Cap (USDG)</th>
                <th>Payments</th>
                <th>Last</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {view.data.map((row) => (
                <tr key={row.origin}>
                  <td className="mono">
                    {row.origin}
                    {row.blocked ? <span className="danger"> blocked</span> : null}
                  </td>
                  <td>{formatAmount(toBigint(row.spent))}</td>
                  <td>
                    <div className="row">
                      <input
                        type="text"
                        inputMode="decimal"
                        style={{ width: 100 }}
                        value={edits[row.origin] ?? formatAmount(toBigint(row.cap))}
                        onChange={(e) => setEdits((prev) => ({ ...prev, [row.origin]: e.target.value }))}
                      />
                      <button type="button" disabled={action.busy || edits[row.origin] === undefined} onClick={() => save(row.origin)}>Save</button>
                      {row.override ? (
                        <button type="button" disabled={action.busy} onClick={() => action.run(async () => { await call("site:setCap", { origin: row.origin, cap: null }); })}>
                          Use default
                        </button>
                      ) : (
                        <span className="muted">default</span>
                      )}
                    </div>
                  </td>
                  <td>{row.count}</td>
                  <td>{row.lastAt ? formatTimestamp(row.lastAt) : "-"}</td>
                  <td>
                    {!row.blocked ? (
                      <button
                        type="button"
                        className="danger"
                        disabled={action.busy}
                        onClick={() => action.run(async () => { await call("blocklist:add", { domain: new URL(row.origin).hostname, reason: "other" }); })}
                      >
                        Block
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
      <Panel title="Set a cap for a site">
        <form
          className="row"
          onSubmit={(e) => {
            e.preventDefault();
            action.run(async () => {
              await call("site:setCap", { origin: newOrigin, cap: parseUsdg(newCap).toString() });
              setNewOrigin("");
              setNewCap("");
            });
          }}
        >
          <label>
            Origin or URL
            <input type="text" value={newOrigin} onChange={(e) => setNewOrigin(e.target.value)} placeholder="https://example.com" />
          </label>
          <label>
            Cap (USDG)
            <input type="text" inputMode="decimal" value={newCap} onChange={(e) => setNewCap(e.target.value)} placeholder="1.00" />
          </label>
          <button type="submit" disabled={action.busy}>Save</button>
        </form>
        <p className="muted">
          Default cap: <Usdg value={view.data.find((r) => !r.override)?.cap ?? "0"} /> (Settings). The on-chain site cap is raised to the configured cap the first time a site is funded.
        </p>
      </Panel>
    </>
  );
}
