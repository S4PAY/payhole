import { useState } from "react";
import { useAction, useApi } from "@/components/hooks";
import { ActionStatus, Brand, Notice, Panel } from "@/components/ui";
import { Shield } from "@/components/sections/Shield";
import { Budget } from "@/components/sections/Budget";
import { Sites } from "@/components/sections/Sites";
import { Agents } from "@/components/sections/Agents";
import { Blocklist } from "@/components/sections/Blocklist";
import { Registry } from "@/components/sections/Registry";
import { Tips } from "@/components/sections/Tips";
import { Tiers } from "@/components/sections/Tiers";
import { SettingsPanel } from "@/components/sections/SettingsPanel";
import { call } from "@/lib/rpc";

const SHIELD_TABS = ["Shield", "Blocklist", "Settings"] as const;
const PAY_TABS = ["Budget", "Sites", "Agents", "Registry", "Tips", "Tiers"] as const;
type Tab = (typeof SHIELD_TABS)[number] | (typeof PAY_TABS)[number];

const PAY_TAB_SET: ReadonlySet<string> = new Set(PAY_TABS);

/** The pocket's tabs need a seed; the shield's tabs never do. */
function Locked({ exists, reload }: { exists: boolean; reload: () => void }) {
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"unlock" | "create" | "import">(exists ? "unlock" : "create");
  const [password2, setPassword2] = useState("");
  const [mnemonic, setMnemonic] = useState("");
  const [shown, setShown] = useState<string | null>(null);
  const action = useAction(reload);

  if (shown) {
    return (
      <Panel title="Write these words down">
        <p className="muted">They are shown once. Anyone with them controls every address of this pocket.</p>
        <div className="mnemonic">
          {shown.split(" ").map((word, i) => (
            <div key={i}>
              <span>{i + 1}.</span>
              {word}
            </div>
          ))}
        </div>
        <div className="row" style={{ marginTop: 12 }}>
          <button type="button" className="primary" onClick={() => { setShown(null); reload(); }}>I wrote them down</button>
        </div>
      </Panel>
    );
  }

  return (
    <Panel title={mode === "unlock" ? "Unlock the pocket" : mode === "create" ? "New pocket" : "Import a seed"}>
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          action.run(async () => {
            if (mode === "unlock") {
              await call("vault:unlock", { password });
              setPassword("");
              return;
            }
            if (password !== password2) throw new Error("passwords do not match");
            if (mode === "create") {
              const result = await call("vault:create", { password });
              setShown(result.mnemonic);
              return;
            }
            await call("vault:import", { mnemonic, password });
            setMnemonic("");
          });
        }}
      >
        {mode === "import" ? (
          <label>
            12 or 24 word mnemonic
            <textarea value={mnemonic} onChange={(e) => setMnemonic(e.target.value)} autoComplete="off" spellCheck={false} />
          </label>
        ) : null}
        <label>
          Password{mode !== "unlock" ? " (at least 8 characters)" : ""}
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={mode === "unlock" ? "current-password" : "new-password"} autoFocus />
        </label>
        {mode !== "unlock" ? (
          <label>
            Repeat password
            <input type="password" value={password2} onChange={(e) => setPassword2(e.target.value)} autoComplete="new-password" />
          </label>
        ) : null}
        <ActionStatus action={action} />
        <div className="row">
          <button type="submit" className="primary" disabled={action.busy}>{mode === "unlock" ? "Unlock" : mode === "create" ? "Create" : "Import"}</button>
          {!exists && mode === "create" ? <button type="button" onClick={() => setMode("import")}>Import a seed instead</button> : null}
          {!exists && mode === "import" ? <button type="button" onClick={() => setMode("create")}>Create a new one</button> : null}
        </div>
      </form>
    </Panel>
  );
}

export function App() {
  const status = useApi("vault:status", {});
  const settings = useApi("settings:get", {});
  const [tab, setTab] = useState<Tab>("Shield");
  const lock = useAction(status.reload);

  if (status.error) return <div className="page"><Notice kind="error">{status.error}</Notice></div>;
  if (settings.error) return <div className="page"><Notice kind="error">{settings.error}</Notice></div>;
  if (!status.data || !settings.data) return <div className="page muted">Loading...</div>;

  const payOn = settings.data.pay.enabled;
  const tabs: readonly Tab[] = payOn ? [...SHIELD_TABS, ...PAY_TABS] : SHIELD_TABS;
  const current: Tab = tabs.includes(tab) ? tab : "Shield";
  const needsVault = PAY_TAB_SET.has(current) && !status.data.unlocked;

  return (
    <div className="page">
      <div className="row between topbar">
        <Brand />
        {status.data.unlocked ? <button type="button" onClick={() => lock.run(async () => { await call("vault:lock", {}); })}>Lock pocket</button> : null}
      </div>
      <nav className="tabs">
        {tabs.map((name) => (
          <button key={name} type="button" className={name === current ? "active" : ""} onClick={() => setTab(name)}>
            {name}
          </button>
        ))}
      </nav>
      {current === "Shield" ? <Shield /> : null}
      {current === "Blocklist" ? <Blocklist /> : null}
      {current === "Settings" ? <SettingsPanel /> : null}
      {needsVault ? <Locked exists={status.data.exists} reload={() => { status.reload(); settings.reload(); }} /> : null}
      {!needsVault && current === "Budget" ? <Budget /> : null}
      {!needsVault && current === "Sites" ? <Sites /> : null}
      {!needsVault && current === "Agents" ? <Agents /> : null}
      {!needsVault && current === "Registry" ? <Registry /> : null}
      {!needsVault && current === "Tips" ? <Tips /> : null}
      {!needsVault && current === "Tiers" ? <Tiers /> : null}
    </div>
  );
}
