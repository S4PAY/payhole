import { useState } from "react";
import { useAction, useApi } from "@/components/hooks";
import { ActionStatus, Address, AmountField, CopyButton, Notice, Panel, Usdg } from "@/components/ui";
import { formatTimestamp, parseUsdg } from "@/lib/format";
import { call } from "@/lib/rpc";

interface Exported {
  privateKey: string;
  address: string;
  budgetAccount: string;
  env: string;
}

export function Agents() {
  const view = useApi("agents:list", {});
  const action = useAction(view.reload);
  const [label, setLabel] = useState("");
  const [cap, setCap] = useState("");
  const [days, setDays] = useState("30");
  const [exported, setExported] = useState<Exported | null>(null);

  if (view.error) return <Notice kind="error">{view.error}</Notice>;
  if (!view.data) return <p className="muted">Loading...</p>;
  const data = view.data;

  return (
    <>
      <ActionStatus action={action} />
      {!data.budgetAccount ? <Notice>Create the BudgetAccount first (Budget).</Notice> : null}
      <Panel
        title={`Session keys (${data.live} live of ${data.limit} allowed)`}
        actions={
          <button type="button" className="danger" disabled={action.busy || data.agents.length === 0} onClick={() => action.run(async () => `all keys revoked in ${(await call("agents:revokeAll", {})).txHash}`)}>
            Revoke all
          </button>
        }
      >
        {data.agents.length === 0 ? <p className="muted">No agent keys yet.</p> : null}
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>Label</th>
                <th>Address</th>
                <th>State</th>
                <th>Cap</th>
                <th>Spent</th>
                <th>Remaining</th>
                <th>Expiry</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {data.agents.map((agent) => (
                <tr key={agent.index}>
                  <td>{agent.index}</td>
                  <td>{agent.label}</td>
                  <td><Address value={agent.address} /></td>
                  <td className={agent.live ? "ok" : "muted"}>{agent.live ? "live" : agent.revokedAt ? "revoked" : "not live"}</td>
                  <td><Usdg value={agent.cap} /></td>
                  <td><Usdg value={agent.spent} /></td>
                  <td><Usdg value={agent.remaining} /></td>
                  <td>{agent.expiry ? formatTimestamp(agent.expiry * 1000) : "-"}</td>
                  <td className="row">
                    <button type="button" disabled={action.busy} onClick={() => action.run(async () => { setExported(await call("agents:export", { index: agent.index })); })}>
                      Export
                    </button>
                    {agent.live ? (
                      <button type="button" className="danger" disabled={action.busy} onClick={() => action.run(async () => `revoked in ${(await call("agents:revoke", { address: agent.address })).txHash}`)}>
                        Revoke
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
      {exported ? (
        <Panel title="Exported key" actions={<button type="button" onClick={() => setExported(null)}>Close</button>}>
          <p className="danger">This private key spends from your BudgetAccount up to its cap. Hand it only to the agent that needs it.</p>
          <pre>{exported.env}</pre>
          <div className="row">
            <CopyButton text={exported.env} label="Copy environment" />
            <CopyButton text={exported.privateKey} label="Copy key only" />
          </div>
          <p className="muted">
            Use with the CLI: <code>payhole status</code>, <code>payhole pay &lt;url&gt;</code>. The key needs a little ETH for gas to pull USDG from the account.
          </p>
        </Panel>
      ) : null}
      <Panel title="New session key">
        <form
          className="row"
          onSubmit={(e) => {
            e.preventDefault();
            action.run(async () => {
              const expiry = Math.floor(Date.now() / 1000) + Math.max(1, Number(days)) * 86_400;
              const agent = await call("agents:create", { label, cap: parseUsdg(cap).toString(), expiry });
              setLabel("");
              setCap("");
              return `created key ${agent.index} at ${agent.address}`;
            });
          }}
        >
          <label>
            Label
            <input type="text" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="research-agent" />
          </label>
          <AmountField label="Cap (USDG)" value={cap} onChange={setCap} />
          <label>
            Valid for (days)
            <input type="number" min={1} value={days} onChange={(e) => setDays(e.target.value)} />
          </label>
          <button type="submit" className="primary" disabled={action.busy || !data.budgetAccount}>Create</button>
        </form>
      </Panel>
    </>
  );
}
