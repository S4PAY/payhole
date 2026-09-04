import { useEffect, useState } from "react";
import { browser } from "wxt/browser";
import { useAction } from "@/components/hooks";
import { ActionStatus, Address, Panel } from "@/components/ui";
import type { RegistryView } from "@/lib/messages";
import { call } from "@/lib/rpc";

export function Registry() {
  const [domain, setDomain] = useState("");
  const [result, setResult] = useState<RegistryView | null>(null);
  const [current, setCurrent] = useState<{ hostname: string; view: RegistryView | null; error?: string } | null>(null);
  const action = useAction();

  useEffect(() => {
    browser.tabs
      .query({ url: ["http://*/*", "https://*/*"], lastFocusedWindow: true })
      .then(async (tabs) => {
        const active = tabs.find((t) => t.active) ?? tabs[0];
        if (!active?.url) return;
        const hostname = new URL(active.url).hostname;
        try {
          setCurrent({ hostname, view: await call("registry:lookup", { domain: hostname }) });
        } catch (e) {
          setCurrent({ hostname, view: null, error: e instanceof Error ? e.message : String(e) });
        }
      })
      .catch(() => undefined);
  }, []);

  return (
    <>
      <Panel title="Check a domain">
        <form
          className="row"
          onSubmit={(e) => {
            e.preventDefault();
            action.run(async () => {
              setResult(await call("registry:lookup", { domain }));
            });
          }}
        >
          <label>
            Domain
            <input type="text" value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="example.com" />
          </label>
          <button type="submit" className="primary" disabled={action.busy}>Look up</button>
        </form>
        <ActionStatus action={action} />
        {result ? (
          <dl className="grid" style={{ marginTop: 8 }}>
            <dt>Hostname</dt>
            <dd className="mono">{result.hostname}</dd>
            <dt>Domain hash</dt>
            <dd className="mono">{result.domainHash}</dd>
            <dt>Wallet</dt>
            <dd>{result.registered ? <Address value={result.wallet} short={false} /> : <span className="muted">not registered</span>}</dd>
          </dl>
        ) : null}
      </Panel>
      <Panel title="Current site">
        {!current ? (
          <p className="muted">No http(s) tab in this window.</p>
        ) : current.error ? (
          <p className="danger">{current.error}</p>
        ) : (
          <p>
            <span className="mono">{current.hostname}</span>:{" "}
            {current.view?.registered ? <span className="ok">registered, tips go to <Address value={current.view.wallet} /></span> : <span className="muted">not registered</span>}
          </p>
        )}
      </Panel>
      <Panel title="Register your own domain">
        <ol>
          <li>Publish a DNS TXT record at <code>_payhole.&lt;your-domain&gt;</code> with the value <code>payhole=0xYourWallet</code>.</li>
          <li>Call the verifier: <code>POST /attest</code> with <code>{"{"}"domain": "example.com", "wallet": "0xYourWallet"{"}"}</code>. It checks the record and signs an EIP-712 claim bound to the domain's current nonce and a deadline.</li>
          <li>Submit <code>CreatorRegistry.claim(domainHash, wallet, deadline, signature)</code> from any account. No stake, no token.</li>
        </ol>
        <p className="muted">Rotating a wallet is the same flow with a new TXT value. Tips go straight to the registered wallet.</p>
      </Panel>
    </>
  );
}
