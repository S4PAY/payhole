import { useState, type ReactNode } from "react";
import { describeReport, type ReportResult } from "@/lib/report";
import { call } from "@/lib/rpc";
import { CATEGORY_LABELS, REPORT_CATEGORIES, describeVerdict, isDangerous, type Category, type Verdict } from "@/lib/shield";
import { errorText } from "@/lib/format";

const SOURCE_WORDS: Record<string, string> = { list: "subscribed list", swarm: "swarm", manual: "operator", local: "extension" };

export type Tone = "accent" | "danger" | "muted";

/** The small uppercase label above a card's subject. */
export function Eyebrow({ tone = "accent", children }: { tone?: Tone; children: ReactNode }) {
  return <div className={`eyebrow ${tone}`}>{children}</div>;
}

export function CategoryTag({ category }: { category: Category | null }) {
  if (!category) return null;
  return <span className={`tag ${isDangerous(category) ? "danger" : ""}`}>{CATEGORY_LABELS[category]}</span>;
}

/** What the resolver said about a name: the subject line, the tag, the sentence, and where it came from. */
export function VerdictView({ verdict, big = false }: { verdict: Verdict; big?: boolean }) {
  const tone: Tone = verdict.blocked && !verdict.allowlisted ? "danger" : "accent";
  const label = verdict.allowlisted ? "Allowlisted" : verdict.blocked ? "Blocked" : "Not blocked";
  const sources = verdict.sources.map((s) => SOURCE_WORDS[s] ?? s).join(", ");
  return (
    <div className="stack tight">
      <div className="row between">
        <Eyebrow tone={tone}>{label}</Eyebrow>
        {verdict.blocked ? <CategoryTag category={verdict.category} /> : null}
      </div>
      <div className={big ? "subject big" : "subject"}>{verdict.domain}</div>
      <p className="lead">{describeVerdict(verdict)}</p>
      {verdict.sources.length > 1 || verdict.reporters > 0 ? (
        <p className="muted small">
          {sources}
          {verdict.reporters > 0 ? `, ${verdict.reporters} reporter${verdict.reporters === 1 ? "" : "s"}` : ""}
        </p>
      ) : null}
      {verdict.reasons.length > 0 ? <p className="muted small">{verdict.reasons.join("; ")}</p> : null}
    </div>
  );
}

/** Report a name to the resolver: pick what it is, add a note, send. */
export function ReportForm({ name, onDone }: { name: string; onDone?: (result: ReportResult) => void }) {
  const [category, setCategory] = useState<Category>("phishing");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [line, setLine] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const send = async () => {
    setBusy(true);
    setLine(null);
    try {
      const result = await call("shield:report", { name, category, reason });
      setLine(describeReport(result));
      setFailed(result.status === "invalid" || result.status === "rejected");
      onDone?.(result);
    } catch (error) {
      setLine(errorText(error));
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="stack">
      <div className="chips">
        {REPORT_CATEGORIES.map((c) => (
          <button key={c} type="button" className={`chip ${c === category ? "active" : ""}`} onClick={() => setCategory(c)}>
            {CATEGORY_LABELS[c]}
          </button>
        ))}
      </div>
      <input type="text" value={reason} placeholder="Note, optional" maxLength={200} onChange={(e) => setReason(e.target.value)} />
      <div className="row">
        <button type="button" className="primary" disabled={busy} onClick={() => void send()}>
          {busy ? "Sending" : "Send report"}
        </button>
        {line ? <span className={failed ? "danger small" : "ok small"}>{line}</span> : null}
      </div>
    </div>
  );
}

/** Paste a link or a name and ask the resolver. */
export function CheckForm({ onResult, autoFocus = false }: { onResult: (host: string, verdict: Verdict) => void; autoFocus?: boolean }) {
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async () => {
    if (input.trim().length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const result = await call("shield:check", { input });
      onResult(result.host, result.verdict);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form
      className="stack"
      onSubmit={(e) => {
        e.preventDefault();
        void run();
      }}
    >
      <input type="text" value={input} placeholder="Link or domain" autoFocus={autoFocus} spellCheck={false} autoComplete="off" onChange={(e) => setInput(e.target.value)} />
      <div className="row">
        <button type="submit" className="primary" disabled={busy || input.trim().length === 0}>
          {busy ? "Checking" : "Check"}
        </button>
        {error ? <span className="danger small">{error}</span> : null}
      </div>
    </form>
  );
}
