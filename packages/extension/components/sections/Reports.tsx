import { useState } from "react";
import { useAction, useApi } from "@/components/hooks";
import { CategoryTag } from "@/components/shield";
import { ActionStatus, CopyButton, Notice, Panel } from "@/components/ui";
import { formatTimestamp } from "@/lib/format";
import { describeEntry, describePayout } from "@/lib/reporter";
import { call } from "@/lib/rpc";

const LINK_PAGE = "https://payhole.org/link.html";

function short(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

/** This browser's reporter key, the wallet bounties go to, and what became of every report. */
export function Reports() {
  const status = useApi("reporter:status", {});
  const rewards = useApi("reporter:rewards", {});
  const action = useAction(() => {
    status.reload();
    rewards.reload();
  });
  const [proof, setProof] = useState("");
  const [wallet, setWallet] = useState<string | null>(null);
  const [payoutLine, setPayoutLine] = useState<string | null>(null);

  if (status.error) return <Notice kind="error">{status.error}</Notice>;
  if (!status.data) return <p className="muted">Loading...</p>;
  const me = status.data;
  const summary = rewards.data;
  const byDomain = new Map((summary?.entries ?? []).map((entry) => [entry.domain, entry]));
  const canClaim = summary !== null && summary !== undefined && summary.owed >= summary.minPayout && summary.eligible?.ok !== false && summary.claim === null;

  return (
    <>
      <ActionStatus action={action} />
      <Panel title="Your reporter key">
        <div className="stack">
          <div className="subject">{me.address ?? "not ready"}</div>
          {me.holder ? (
            <p className="lead">Linked to {short(me.holder)}. Reports count as its flags.</p>
          ) : (
            <p className="muted small">Signs every report. Link a tier holder's wallet on the link page and reports count as that wallet's flags.</p>
          )}
          <div className="row">
            {me.address ? <CopyButton text={me.address} label="Copy key" /> : null}
            {me.holder ? (
              <button type="button" onClick={() => action.run(async () => { await call("reporter:unlink", {}); })}>Unlink</button>
            ) : (
              <a className="link-button" href={`${LINK_PAGE}?key=${encodeURIComponent(me.address ?? "")}`} target="_blank" rel="noreferrer">Link page</a>
            )}
          </div>
          {!me.holder ? (
            <div className="stack">
              <label>
                Proof from the link page
                <textarea value={proof} onChange={(e) => setProof(e.target.value)} spellCheck={false} placeholder='{"peerId": ...}' />
              </label>
              <div className="row">
                <button type="button" className="primary" disabled={action.busy || proof.trim().length === 0} onClick={() => action.run(async () => { await call("reporter:link", { proof }); setProof(""); return "linked"; })}>
                  Link
                </button>
              </div>
            </div>
          ) : null}
        </div>
      </Panel>
      <Panel title="Rewards wallet">
        <div className="stack">
          <p className="muted small">{me.wallet ? `Rewards to ${short(me.wallet)}${me.walletIsOwn ? "" : " (linked)"}.` : "Add a wallet and confirmed first reports pay it in USDG."}</p>
          <div className="row">
            <input type="text" value={wallet ?? ""} placeholder="0x..." spellCheck={false} onChange={(e) => setWallet(e.target.value)} style={{ maxWidth: 460 }} />
            <button type="button" disabled={action.busy || wallet === null} onClick={() => action.run(async () => { await call("reporter:setWallet", { wallet: wallet ?? "" }); setWallet(null); return "saved"; })}>
              Save
            </button>
          </div>
        </div>
      </Panel>
      <Panel title="Your reports">
        <div className="stack">
          {summary ? (
            <p className="lead">{`Owed ${summary.owed.toFixed(2)} USDG · paid ${summary.paid.toFixed(2)}${summary.pending > 0 ? ` · ${summary.pending} waiting` : ""}${summary.claim?.paidAt === null ? ` · ${summary.claim.amount.toFixed(2)} on its way` : ""}`}</p>
          ) : me.wallet ? (
            <p className="muted small">{rewards.error ?? "Loading"}</p>
          ) : (
            <p className="muted small">Add a rewards wallet to see earnings.</p>
          )}
          {me.reports.length === 0 ? <p className="muted small">Nothing reported from this browser yet.</p> : null}
          {me.reports.length > 0 ? (
            <div className="table-wrap">
              <table>
                <tbody>
                  {me.reports.slice(0, 30).map((report) => {
                    const entry = byDomain.get(report.domain);
                    return (
                      <tr key={report.domain}>
                        <td className="mono">{report.domain}</td>
                        <td><CategoryTag category={report.category} /></td>
                        <td className="muted">{entry ? describeEntry(entry) : "waiting"}</td>
                        <td className="muted">{formatTimestamp(report.at)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : null}
          {summary?.eligible && !summary.eligible.ok ? (
            <p className="muted small">
              {summary.eligible.required > 0
                ? `Payout needs a tier or $10 of PAYHOLE: ${summary.eligible.required.toLocaleString()} now. Holds ${summary.eligible.tokens.toLocaleString()}.`
                : "Payout needs a tier or $10 of PAYHOLE. Price unavailable, retry soon."}
            </p>
          ) : null}
          <div className="row">
            <button
              type="button"
              className="primary"
              disabled={action.busy || !canClaim}
              onClick={() => action.run(async () => { const outcome = await call("reporter:claim", {}); setPayoutLine(describePayout(outcome, summary?.minPayout ?? 10, summary?.owed ?? 0)); })}
            >
              {`Request payout (min ${summary?.minPayout ?? 10} USDG)`}
            </button>
            <button type="button" onClick={() => rewards.reload()}>Refresh</button>
            {payoutLine ? <span className="muted small">{payoutLine}</span> : null}
          </div>
        </div>
      </Panel>
    </>
  );
}
