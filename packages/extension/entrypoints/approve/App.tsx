import { useState } from "react";
import { useApi } from "@/components/hooks";
import { Address, Notice, Panel, Usdg } from "@/components/ui";
import { formatUsdg, toBigint } from "@/lib/format";
import { call } from "@/lib/rpc";

export function App() {
  const id = new URLSearchParams(window.location.search).get("id") ?? "";
  const approval = useApi("approval:get", { id });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const answer = (approved: boolean) => {
    setBusy(true);
    call("approval:answer", { id, approved })
      .then(() => window.close())
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : String(e));
        setBusy(false);
      });
  };

  if (approval.loading) return <div className="page muted">Loading...</div>;
  if (approval.error) return <div className="page"><Notice kind="error">{approval.error}</Notice></div>;
  const request = approval.data;
  if (!request) {
    return (
      <div className="page">
        <Notice>This request is no longer pending.</Notice>
        <button type="button" onClick={() => window.close()}>Close</button>
      </div>
    );
  }
  const siteRemaining = toBigint(request.siteCap) - toBigint(request.siteSpent);
  const globalRemaining = toBigint(request.globalCap) - toBigint(request.globalSpent);
  return (
    <div className="page">
      <h1>Payment over cap</h1>
      <Panel>
        <p className="big"><Usdg value={request.amount} /></p>
        <dl className="grid">
          <dt>Site</dt>
          <dd className="mono">{request.origin}</dd>
          <dt>Resource</dt>
          <dd className="mono">{request.url}</dd>
          <dt>Pay to</dt>
          <dd><Address value={request.payTo} short={false} /></dd>
          <dt>Site cap left</dt>
          <dd>{formatUsdg(siteRemaining < 0n ? 0n : siteRemaining)} of <Usdg value={request.siteCap} /></dd>
          <dt>Global cap left</dt>
          <dd>{formatUsdg(globalRemaining < 0n ? 0n : globalRemaining)} of <Usdg value={request.globalCap} /></dd>
        </dl>
        <p className="muted">Approving pays this one request. Caps stay as they are; raise them in the dashboard for silent payments.</p>
        {error ? <Notice kind="error">{error}</Notice> : null}
        <div className="row">
          <button type="button" className="primary" disabled={busy} onClick={() => answer(true)}>Pay once</button>
          <button type="button" disabled={busy} onClick={() => answer(false)}>Deny</button>
        </div>
      </Panel>
    </div>
  );
}
