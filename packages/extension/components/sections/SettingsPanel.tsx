import { useEffect, useState } from "react";
import { useAction, useApi } from "@/components/hooks";
import { ActionStatus, Notice, Panel } from "@/components/ui";
import { formatAmount, parseUsdg, toBigint } from "@/lib/format";
import { call } from "@/lib/rpc";
import type { Settings } from "@/lib/settings";

interface Form {
  rpcUrl: string;
  chainId: string;
  usdg: string;
  budgetAccountFactory: string;
  burnVault: string;
  creatorRegistry: string;
  budgetAccount: string;
  defaultSiteCap: string;
  globalCap: string;
  topUpChunk: string;
  feePercent: string;
  autoLockMinutes: string;
}

function toForm(s: Settings): Form {
  return {
    rpcUrl: s.rpcUrl,
    chainId: String(s.chainId),
    usdg: s.usdg,
    budgetAccountFactory: s.budgetAccountFactory,
    burnVault: s.burnVault,
    creatorRegistry: s.creatorRegistry,
    budgetAccount: s.budgetAccount,
    defaultSiteCap: formatAmount(toBigint(s.defaultSiteCap)),
    globalCap: formatAmount(toBigint(s.globalCap)),
    topUpChunk: formatAmount(toBigint(s.topUpChunk)),
    feePercent: String(s.feePercent),
    autoLockMinutes: String(s.autoLockMinutes),
  };
}

function toPatch(f: Form): Partial<Settings> {
  return {
    rpcUrl: f.rpcUrl.trim(),
    chainId: Number(f.chainId),
    usdg: f.usdg.trim() as Settings["usdg"],
    budgetAccountFactory: f.budgetAccountFactory.trim(),
    burnVault: f.burnVault.trim(),
    creatorRegistry: f.creatorRegistry.trim(),
    budgetAccount: f.budgetAccount.trim(),
    defaultSiteCap: parseUsdg(f.defaultSiteCap).toString(),
    globalCap: parseUsdg(f.globalCap).toString(),
    topUpChunk: parseUsdg(f.topUpChunk).toString(),
    feePercent: Number(f.feePercent),
    autoLockMinutes: Number(f.autoLockMinutes),
  };
}

export function SettingsPanel() {
  const view = useApi("settings:get", {});
  const action = useAction(view.reload);
  const [form, setForm] = useState<Form | null>(null);
  const status = useApi("vault:status", {});
  const destroy = useAction(() => window.location.reload());

  useEffect(() => {
    if (view.data) setForm(toForm(view.data));
  }, [view.data]);

  if (view.error) return <Notice kind="error">{view.error}</Notice>;
  if (!form) return <p className="muted">Loading...</p>;
  const field = (key: keyof Form, label: string, type = "text") => (
    <label key={key}>
      {label}
      <input type={type} value={form[key]} onChange={(e) => setForm({ ...form, [key]: e.target.value })} />
    </label>
  );

  return (
    <>
      <ActionStatus action={action} />
      <Panel title="Settings">
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            action.run(async () => {
              await call("settings:set", { patch: toPatch(form) });
              return "settings saved";
            });
          }}
        >
          <h3>Chain</h3>
          {field("rpcUrl", "RPC URL", "url")}
          {field("chainId", "Chain id", "number")}
          {field("usdg", "USDG token address")}
          <h3>Contracts</h3>
          {field("budgetAccountFactory", "BudgetAccountFactory")}
          {field("burnVault", "BurnVault")}
          {field("creatorRegistry", "CreatorRegistry")}
          {field("budgetAccount", "BudgetAccount (yours)")}
          <h3>Spending</h3>
          {field("defaultSiteCap", "Default per-site cap (USDG)")}
          {field("globalCap", "Global cap for site payments before a prompt (USDG)")}
          {field("topUpChunk", "Top-up chunk pushed to a site address (USDG)")}
          {field("feePercent", "Top-up fee burned through the vault (percent)", "number")}
          <h3>Security</h3>
          {field("autoLockMinutes", "Auto-lock after idle minutes", "number")}
          <div className="row">
            <button type="submit" className="primary" disabled={action.busy}>Save</button>
            <button type="button" onClick={() => view.data && setForm(toForm(view.data))}>Reset</button>
          </div>
        </form>
      </Panel>
      {status.data?.exists && !status.data.unlocked ? (
        <Panel title="Remove seed">
          <p className="danger">Deletes the encrypted seed from this browser. Only the mnemonic backup can restore the wallet afterwards.</p>
          <ActionStatus action={destroy} />
          <button type="button" className="danger" disabled={destroy.busy} onClick={() => { if (window.confirm("Remove the encrypted seed from this browser?")) destroy.run(async () => { await call("vault:destroy", {}); }); }}>
            Remove seed
          </button>
        </Panel>
      ) : null}
    </>
  );
}
