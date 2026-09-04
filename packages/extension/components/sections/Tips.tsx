import { useState } from "react";
import { useAction, useApi } from "@/components/hooks";
import { ActionStatus, LedgerTable, Notice, Panel, Usdg } from "@/components/ui";
import { formatAmount, parseUsdg, toBigint } from "@/lib/format";
import { call } from "@/lib/rpc";

export function Tips() {
  const view = useApi("tips:view", {});
  const action = useAction(view.reload);
  const [amount, setAmount] = useState<string | null>(null);
  const [hours, setHours] = useState<string | null>(null);
  const [float, setFloat] = useState<string | null>(null);

  if (view.error) return <Notice kind="error">{view.error}</Notice>;
  if (!view.data) return <p className="muted">Loading...</p>;
  const { settings, history, total, configured } = view.data;

  return (
    <>
      <ActionStatus action={action} />
      {!configured ? <Notice>Tips need the CreatorRegistry address (Settings) and a BudgetAccount.</Notice> : null}
      <Panel title="Creator tips">
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            action.run(async () => {
              await call("settings:set", {
                patch: {
                  tips: {
                    ...settings,
                    amount: amount === null ? settings.amount : parseUsdg(amount).toString(),
                    intervalHours: hours === null ? settings.intervalHours : Math.max(1, Number(hours)),
                    float: float === null ? settings.float : parseUsdg(float).toString(),
                  },
                },
              });
              setAmount(null);
              setHours(null);
              setFloat(null);
              return "tip settings saved";
            });
          }}
        >
          <label className="inline">
            <input
              type="checkbox"
              checked={settings.enabled}
              onChange={(e) => action.run(async () => { await call("settings:set", { patch: { tips: { ...settings, enabled: e.target.checked } } }); })}
            />
            Tip registered creators on visit
          </label>
          <div className="row">
            <label>
              Amount per tip (USDG)
              <input type="text" inputMode="decimal" value={amount ?? formatAmount(toBigint(settings.amount))} onChange={(e) => setAmount(e.target.value)} />
            </label>
            <label>
              Once per domain every (hours)
              <input type="number" min={1} value={hours ?? String(settings.intervalHours)} onChange={(e) => setHours(e.target.value)} />
            </label>
            <label>
              Float pulled from the account when the owner runs short (USDG)
              <input type="text" inputMode="decimal" value={float ?? formatAmount(toBigint(settings.float))} onChange={(e) => setFloat(e.target.value)} />
            </label>
            <button type="submit" disabled={action.busy}>Save</button>
          </div>
        </form>
        <p className="muted">The owner account pays tips directly; it needs a little ETH for gas. Total tipped: <Usdg value={total} />.</p>
      </Panel>
      <Panel title="Tip history">
        <LedgerTable entries={history} />
      </Panel>
    </>
  );
}
