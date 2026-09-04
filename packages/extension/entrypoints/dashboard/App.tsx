import { useState } from "react";
import { useAction, useApi } from "@/components/hooks";
import { ActionStatus, Notice, Panel } from "@/components/ui";
import { Budget } from "@/components/sections/Budget";
import { Sites } from "@/components/sections/Sites";
import { Agents } from "@/components/sections/Agents";
import { Blocklist } from "@/components/sections/Blocklist";
import { Registry } from "@/components/sections/Registry";
import { Tips } from "@/components/sections/Tips";
import { Tiers } from "@/components/sections/Tiers";
import { SettingsPanel } from "@/components/sections/SettingsPanel";
import { call } from "@/lib/rpc";

const TABS = ["Budget", "Sites", "Agents", "Blocklist", "Registry", "Tips", "Tiers", "Settings"] as const;
type Tab = (typeof TABS)[number];

export function App() {
  const status = useApi("vault:status", {});
  const [tab, setTab] = useState<Tab>("Budget");
  const [password, setPassword] = useState("");
  const unlock = useAction(status.reload);

  if (status.loading && !status.data) return <div className="page muted">Loading...</div>;
  if (status.error) return <div className="page"><Notice kind="error">{status.error}</Notice></div>;
  if (!status.data) return null;

  if (!status.data.exists) {
    return (
      <div className="page">
        <h1>PayHole</h1>
        <Notice>No seed yet. Open the PayHole toolbar popup to create or import one.</Notice>
        <SettingsPanel />
      </div>
    );
  }

  if (!status.data.unlocked) {
    return (
      <div className="page">
        <h1>PayHole</h1>
        <Panel title="Unlock">
          <form
            className="stack"
            onSubmit={(e) => {
              e.preventDefault();
              unlock.run(async () => {
                await call("vault:unlock", { password });
                setPassword("");
              });
            }}
          >
            <label>
              Password
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" autoFocus />
            </label>
            <ActionStatus action={unlock} />
            <div className="row">
              <button type="submit" className="primary" disabled={unlock.busy}>Unlock</button>
            </div>
          </form>
        </Panel>
        <SettingsPanel />
      </div>
    );
  }

  return (
    <div className="page">
      <div className="row between">
        <h1>PayHole</h1>
        <button type="button" onClick={() => unlock.run(async () => { await call("vault:lock", {}); })}>Lock</button>
      </div>
      <nav className="tabs">
        {TABS.map((name) => (
          <button key={name} type="button" className={name === tab ? "active" : ""} onClick={() => setTab(name)}>
            {name}
          </button>
        ))}
      </nav>
      {tab === "Budget" ? <Budget /> : null}
      {tab === "Sites" ? <Sites /> : null}
      {tab === "Agents" ? <Agents /> : null}
      {tab === "Blocklist" ? <Blocklist /> : null}
      {tab === "Registry" ? <Registry /> : null}
      {tab === "Tips" ? <Tips /> : null}
      {tab === "Tiers" ? <Tiers /> : null}
      {tab === "Settings" ? <SettingsPanel /> : null}
    </div>
  );
}
