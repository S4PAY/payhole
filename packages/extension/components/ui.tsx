import type { ReactNode } from "react";
import { formatAmount, formatTimestamp, formatUsdg, shortAddress, toBigint } from "@/lib/format";
import type { LedgerEntry } from "@/lib/ledger";
import type { Action } from "./hooks";

/** Logo mark and wordmark, the way the site's nav shows them. */
export function Brand({ compact = false }: { compact?: boolean }) {
  const size = compact ? 24 : 28;
  return (
    <div className={compact ? "brand compact" : "brand"}>
      <img src="/logo.png" alt="" width={size} height={size} />
      <span className="brand-name">PayHole</span>
    </div>
  );
}

export function Panel({ title, children, actions }: { title?: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <section className="panel">
      {title || actions ? (
        <div className="row between" style={{ marginBottom: 8 }}>
          {title ? <h2>{title}</h2> : <span />}
          {actions}
        </div>
      ) : null}
      {children}
    </section>
  );
}

export function Notice({ kind = "info", children }: { kind?: "info" | "error" | "ok"; children: ReactNode }) {
  return <div className={`notice ${kind === "info" ? "" : kind}`}>{children}</div>;
}

/** Shows the outcome of the last action, if any. */
export function ActionStatus({ action }: { action: Action }) {
  if (action.error) return <Notice kind="error">{action.error}</Notice>;
  if (action.message) return <Notice kind="ok">{action.message}</Notice>;
  return null;
}

export function Usdg({ value }: { value: string | bigint }) {
  const amount = typeof value === "bigint" ? value : toBigint(value);
  return <span>{formatUsdg(amount)}</span>;
}

export function Address({ value, short = true }: { value: string; short?: boolean }) {
  return (
    <span className="mono" title={value}>
      {short ? shortAddress(value) : value}
    </span>
  );
}

export function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard.writeText(text);
      }}
    >
      {label}
    </button>
  );
}

export function LedgerTable({ entries, showOrigin = true }: { entries: LedgerEntry[]; showOrigin?: boolean }) {
  if (entries.length === 0) return <p className="muted">No payments yet.</p>;
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>When</th>
            {showOrigin ? <th>Site</th> : null}
            <th>Amount</th>
            <th>Status</th>
            <th>Detail</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => (
            <tr key={entry.id}>
              <td>{formatTimestamp(entry.settledAt)}</td>
              {showOrigin ? <td className="mono">{entry.origin.replace(/^https?:\/\//, "")}</td> : null}
              <td>{formatAmount(toBigint(entry.amount))}</td>
              <td className={entry.status === "failed" || entry.status === "refused" ? "danger" : entry.status === "settled" ? "ok" : ""}>{entry.status}</td>
              <td className="mono">
                {entry.txHash ? shortAddress(entry.txHash) : ""}
                {entry.note ? <span className="muted"> {entry.note}</span> : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Text input for USDG amounts, validated on submit by the caller through parseUsdg. */
export function AmountField({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string }) {
  return (
    <label>
      {label}
      <input type="text" inputMode="decimal" value={value} placeholder={placeholder ?? "0.00"} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}
