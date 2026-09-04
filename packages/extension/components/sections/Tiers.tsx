import { useAction, useApi } from "@/components/hooks";
import { ActionStatus, Address, Notice, Panel, Usdg } from "@/components/ui";
import { call } from "@/lib/rpc";
import { TIER_LIMITS } from "@/lib/tiers";

export function Tiers() {
  const view = useApi("tiers:view", {});
  const action = useAction(view.reload);

  if (view.error) return <Notice kind="error">{view.error}</Notice>;
  if (!view.data) return <p className="muted">Loading...</p>;
  const data = view.data;
  const nextTier = data.tier + 1;
  const canUnlock = data.configured && data.tokenSet && data.nextTierCost !== "0";

  return (
    <>
      <ActionStatus action={action} />
      {!data.configured ? <Notice>Set the BurnVault address in Settings to read your tier. Tier 0 limits apply meanwhile.</Notice> : null}
      <Panel title={`Current tier: ${data.tier}`}>
        <dl className="grid">
          <dt>Agent keys</dt>
          <dd>{data.limits.agentKeys}</dd>
          <dt>Global cap up to</dt>
          <dd><Usdg value={data.limits.globalCap} /></dd>
          <dt>Per-site cap up to</dt>
          <dd><Usdg value={data.limits.siteCap} /></dd>
          <dt>$PayHole token</dt>
          <dd>{data.tokenSet ? <Address value={data.token} short={false} /> : <span className="muted">not set yet</span>}</dd>
        </dl>
      </Panel>
      <Panel title="Tier table">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Tier</th>
                <th>Agent keys</th>
                <th>Global cap</th>
                <th>Per-site cap</th>
              </tr>
            </thead>
            <tbody>
              {TIER_LIMITS.map((limits, index) => (
                <tr key={index}>
                  <td>{index === TIER_LIMITS.length - 1 ? `${index} and above` : index}</td>
                  <td>{limits.agentKeys}</td>
                  <td><Usdg value={limits.globalCap} /></td>
                  <td><Usdg value={limits.siteCap} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
      <Panel title={`Unlock tier ${nextTier}`}>
        <p>
          Burns {data.nextTierCost === "0" ? "an amount not yet configured" : `${data.nextTierCost} token base units`} of $PayHole through the BurnVault. The token is only ever bought and burned; it never pays anyone.
        </p>
        <button type="button" className="primary" disabled={!canUnlock || action.busy} onClick={() => action.run(async () => `unlocked in ${(await call("tiers:unlock", { tier: nextTier })).txHashes.join(", ")}`)}>
          Unlock tier {nextTier}
        </button>
        {!data.tokenSet ? <p className="muted">Unlocking is disabled until the token address is set on the vault.</p> : null}
      </Panel>
    </>
  );
}
