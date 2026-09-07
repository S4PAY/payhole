import { useCallback, useEffect, useState } from "react";
import { Linking, Share, StyleSheet, View } from "react-native";
import * as Clipboard from "expo-clipboard";

import { describeVerdict, extractName, fetchVerdict, shareText, type Category, type Verdict } from "../dns/verdict";
import { useReporter, type Reporter } from "../hooks/useReporter";
import { LINKS } from "../links";
import { describePayout, describeReport, type RewardEntry } from "../report/client";
import { ago } from "../time";
import { colors } from "../theme";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { CategoryTag } from "../ui/CategoryTag";
import { Choice } from "../ui/Choice";
import { Field } from "../ui/Field";
import { Screen } from "../ui/Screen";
import { Body, Eyebrow, Mono, Muted, Subtitle } from "../ui/Typo";

interface CheckScreenProps {
  /** Text handed over by the share sheet, consumed once. */
  shared: string | null;
  onSharedConsumed: () => void;
}

const SOURCE_WORDS: Record<string, string> = {
  swarm: "confirmed by the swarm",
  list: "on a subscribed list",
  manual: "blocked by an operator",
  local: "flagged by the extension",
};

const REPORT_KINDS: { category: Category; title: string; detail: string }[] = [
  { category: "drainer", title: "Wallet drainer", detail: "Asks you to connect or sign, then empties the wallet." },
  { category: "phishing", title: "Phishing", detail: "Pretends to be a service you use and asks for a login, a seed, or a code." },
  { category: "counterfeit", title: "Counterfeit token", detail: "Sells or airdrops a token that impersonates a real one." },
  { category: "infra", title: "Drainer infrastructure", detail: "The backend a drainer kit talks to, not the page itself." },
];

/** A shared text that is the proof JSON from the link page rather than something to check. */
function looksLikeProof(text: string): boolean {
  const trimmed = text.trim();
  return trimmed.startsWith("{") && trimmed.includes('"peerId"') && trimmed.includes('"signature"');
}

export function CheckScreen({ shared, onSharedConsumed }: CheckScreenProps) {
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reporter = useReporter();

  const check = useCallback(async (text: string) => {
    const name = extractName(text);
    setVerdict(null);
    if (name === null) {
      setError("Nothing in that text looks like a web address. Paste a link or a domain name.");
      return;
    }
    setError(null);
    setBusy(true);
    try {
      setVerdict(await fetchVerdict(name, LINKS.verdictUrl));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, []);

  const [linkNote, setLinkNote] = useState<string | null>(null);
  // A proof shared from the link page waits here until the reporter key has loaded from the keystore.
  const [pendingProof, setPendingProof] = useState<string | null>(null);

  useEffect(() => {
    if (shared === null) return;
    onSharedConsumed();
    if (looksLikeProof(shared)) {
      setPendingProof(shared);
      return;
    }
    setInput(shared);
    void check(shared);
  }, [shared, onSharedConsumed, check]);

  const { ready: reporterReady, link: linkReporter } = reporter;
  useEffect(() => {
    if (pendingProof === null || !reporterReady) return;
    const text = pendingProof;
    setPendingProof(null);
    linkReporter(text).then(
      (problem) => setLinkNote(problem ?? "Linked."),
      (e: unknown) => setLinkNote(e instanceof Error ? e.message : String(e)),
    );
  }, [pendingProof, reporterReady, linkReporter]);

  const share = async () => {
    if (!verdict) return;
    await Share.share({ message: shareText(verdict) });
  };

  return (
    <Screen eyebrow="Check" title="Check a link" intro="Paste a link or share one from any app. The resolver says whether PayHole blocks it and why.">
      <Card>
        <Field label="Link or domain" value={input} onChangeText={setInput} placeholder="https://claim-airdrop.example/connect" keyboardType="url" />
        <Button
          label={busy ? "Checking" : "Check"}
          disabled={busy || input.trim().length === 0}
          onPress={() => {
            void check(input);
          }}
        />
        {error === null ? null : <Muted style={styles.error}>{error}</Muted>}
      </Card>

      {verdict === null ? null : (
        <Card tone={verdict.blocked ? "danger" : "default"}>
          <View style={styles.head}>
            <Eyebrow color={verdict.blocked ? colors.danger : colors.accent}>{verdict.blocked ? "Blocked" : verdict.allowlisted ? "Allowlisted" : "Not blocked"}</Eyebrow>
            {verdict.blocked ? <CategoryTag category={verdict.category} /> : null}
          </View>
          <Mono selectable style={styles.domain}>
            {verdict.domain}
          </Mono>
          <Body>{describeVerdict(verdict)}</Body>
          {verdict.sources.length > 0 ? (
            <Muted>{verdict.sources.map((s) => SOURCE_WORDS[s] ?? s).join(", ")}{verdict.reporters > 0 ? `, ${verdict.reporters} reporter${verdict.reporters === 1 ? "" : "s"}` : ""}</Muted>
          ) : null}
          {verdict.reasons.length > 0 ? <Muted>{verdict.reasons.join("; ")}</Muted> : null}
          <View style={styles.actions}>
            <Button
              label="Share this verdict"
              variant="ghost"
              onPress={() => {
                void share();
              }}
            />
          </View>
        </Card>
      )}

      {verdict !== null && !verdict.blocked && !verdict.allowlisted ? <ReportCard key={verdict.domain} domain={verdict.domain} reporter={reporter} /> : null}

      <ReporterCard reporter={reporter} sharedNote={linkNote} />

      <YourReportsCard reporter={reporter} />

      <Card>
        <Subtitle>What the answer means</Subtitle>
        <Muted>Blocked: no PayHole phone loads it. Confirmed by the swarm: tier holders agreed. Not blocked: nothing known today, not a promise.</Muted>
      </Card>
    </Screen>
  );
}

/** Report a name the network does not block yet: a hint from anyone, a flag from a linked tier holder. */
function ReportCard({ domain, reporter }: { domain: string; reporter: Reporter }) {
  const [category, setCategory] = useState<Category | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<string | null>(null);

  const send = async () => {
    setBusy(true);
    setOutcome(null);
    try {
      const { result, fellBack } = await reporter.report({ name: domain, category, reason: reason.trim() });
      setOutcome(`${describeReport(result, reporter.holder !== null)}${fellBack ? " Sent as a plain report; signed reports open soon." : ""}`);
    } catch (e) {
      setOutcome(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <Eyebrow>Report it</Eyebrow>
      <Muted>{reporter.holder ? "Counts as your wallet's flag." : "Not blocked yet. Say what it is."}</Muted>
      <Muted>{`Confirmed first report: 0.50 USDG drainer, 0.30 phishing${reporter.wallet ? "" : ". Add a rewards wallet to get paid"}.`}</Muted>
      {REPORT_KINDS.map((kind) => (
        <Choice key={kind.category} title={kind.title} detail={kind.detail} selected={category === kind.category} onSelect={() => setCategory(kind.category)} />
      ))}
      <Field label="Note (optional)" value={reason} onChangeText={setReason} placeholder="Asked me to sign for an airdrop" />
      <Button
        label={busy ? "Sending" : `Report ${domain}`}
        disabled={busy || category === null}
        onPress={() => {
          void send();
        }}
      />
      {outcome === null ? null : <Muted>{outcome}</Muted>}
    </Card>
  );
}

/** This phone's reporter key, and the proof that links it to a tier holder's wallet. */
function ReporterCard({ reporter, sharedNote }: { reporter: Reporter; sharedNote: string | null }) {
  const [proofText, setProofText] = useState("");
  const [ownNote, setNote] = useState<string | null>(null);
  const note = ownNote ?? sharedNote;
  const [busy, setBusy] = useState(false);

  const copy = async () => {
    if (!reporter.address) return;
    await Clipboard.setStringAsync(reporter.address);
    setNote("Copied.");
  };

  const link = async () => {
    setBusy(true);
    setNote(null);
    try {
      const problem = await reporter.link(proofText);
      setNote(problem ?? "Linked.");
      if (!problem) setProofText("");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <Eyebrow>Your reporter key</Eyebrow>
      {reporter.address === null ? (
        <Muted>{reporter.ready ? "This phone could not create a reporter key." : "Creating this phone's reporter key."}</Muted>
      ) : (
        <>
          <Mono selectable style={styles.address}>
            {reporter.address}
          </Mono>
          {reporter.holder ? (
            <>
              <Body>{`Linked to ${reporter.holder.slice(0, 6)}…${reporter.holder.slice(-4)}. Reports count as its flags.`}</Body>
              <View style={styles.row}>
                <Button label="Copy key" variant="ghost" onPress={() => void copy()} />
                <Button label="Unlink" variant="ghost" onPress={() => void reporter.unlink()} />
              </View>
            </>
          ) : (
            <>
              <Muted>Signs reports. Holds no funds. Link a tier holder's wallet to report with weight.</Muted>
              <View style={styles.row}>
                <Button label="Copy key" variant="ghost" onPress={() => void copy()} />
                <Button label="Link page" variant="ghost" onPress={() => void Linking.openURL(`${LINKS.link}?key=${reporter.address ?? ""}`)} />
              </View>
              <Field label="Proof" value={proofText} onChangeText={setProofText} placeholder='{"peerId":"0x…",…}' />
              <Button label={busy ? "Checking" : "Link"} disabled={busy || proofText.trim().length === 0} onPress={() => void link()} />
            </>
          )}
          <WalletField reporter={reporter} onNote={setNote} />
          {note === null ? null : <Muted>{note}</Muted>}
        </>
      )}
    </Card>
  );
}

/** Where bounties go. Any wallet address; the linked tier holder fills it by default. */
function WalletField({ reporter, onNote }: { reporter: Reporter; onNote: (note: string) => void }) {
  const [text, setText] = useState("");
  const [editing, setEditing] = useState(false);
  const save = async () => {
    const problem = await reporter.setWallet(text);
    onNote(problem ?? (text.trim() ? "Saved." : "Removed."));
    if (!problem) {
      setEditing(false);
      setText("");
    }
  };
  if (!editing) {
    return (
      <View style={styles.walletRow}>
        <Muted style={styles.walletText}>{reporter.wallet ? `Rewards to ${reporter.wallet.slice(0, 6)}…${reporter.wallet.slice(-4)}${reporter.walletIsOwn ? "" : " (linked)"}` : "No rewards wallet"}</Muted>
        <Button label={reporter.wallet ? "Change" : "Add wallet"} variant="ghost" onPress={() => setEditing(true)} />
      </View>
    );
  }
  return (
    <>
      <Field label="Rewards wallet" value={text} onChangeText={setText} placeholder="0x…" />
      <View style={styles.row}>
        <Button label="Save" disabled={text.trim().length === 0 && !reporter.walletIsOwn} onPress={() => void save()} />
        <Button label="Cancel" variant="ghost" onPress={() => setEditing(false)} />
      </View>
    </>
  );
}

const STATUS_WORDS: Record<RewardEntry["status"], string> = {
  payable: "payable",
  pending: "waiting",
  capped: "over daily cap",
  paid: "paid",
  void: "not paid",
};

/** What became of this phone's reports, what the resolver owes the rewards wallet, and the payout request. */
function YourReportsCard({ reporter }: { reporter: Reporter }) {
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (reporter.reports.length === 0 && !reporter.rewards) return null;
  const byDomain = new Map((reporter.rewards?.entries ?? []).map((entry) => [entry.domain, entry]));
  const rewards = reporter.rewards;
  const canClaim = rewards !== null && rewards.owed >= rewards.minPayout && rewards.eligible?.ok !== false && rewards.claim === null;
  const requestPayoutNow = async () => {
    setBusy(true);
    try {
      const outcome = await reporter.claim();
      setNote(describePayout(outcome, rewards?.minPayout ?? 10, rewards?.owed ?? 0));
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card>
      <Eyebrow>Your reports</Eyebrow>
      {rewards ? (
        <Body>{`Owed ${rewards.owed.toFixed(2)} USDG · paid ${rewards.paid.toFixed(2)}${rewards.pending > 0 ? ` · ${rewards.pending} waiting` : ""}${rewards.claim?.paidAt === null ? ` · ${rewards.claim.amount.toFixed(2)} on its way` : ""}`}</Body>
      ) : reporter.wallet ? (
        <Muted>{reporter.rewardsError ?? "Loading"}</Muted>
      ) : (
        <Muted>Add a rewards wallet to see earnings.</Muted>
      )}
      {reporter.reports.slice(0, 20).map((report) => {
        const entry = byDomain.get(report.domain);
        return (
          <View key={report.domain} style={styles.reportRow}>
            <View style={styles.rowHead}>
              <Mono selectable style={styles.reportName}>
                {report.domain}
              </Mono>
              <Muted style={styles.rowWhen}>{ago(report.at)}</Muted>
            </View>
            <Muted style={styles.rowSmall}>{entry ? `${STATUS_WORDS[entry.status]}${entry.status === "payable" || entry.status === "paid" ? ` · ${entry.amount.toFixed(2)} USDG` : ""}${entry.corroboration ? ` · ${entry.corroboration.startsWith("list:") ? "list" : "swarm"}` : ""}` : "waiting"}</Muted>
          </View>
        );
      })}
      {rewards ? (
        <>
          {rewards.eligible && !rewards.eligible.ok ? (
            <Muted>
              {rewards.eligible.required > 0
                ? `Payout needs a tier or $10 of PAYHOLE: ${rewards.eligible.required.toLocaleString()} now. Holds ${rewards.eligible.tokens.toLocaleString()}.`
                : "Payout needs a tier or $10 of PAYHOLE. Price unavailable, retry soon."}
            </Muted>
          ) : null}
          <View style={styles.row}>
            <Button label={busy ? "Requesting" : `Request payout (min ${rewards.minPayout} USDG)`} disabled={busy || !canClaim} onPress={() => void requestPayoutNow()} />
            <Button label="Refresh" variant="ghost" onPress={() => void reporter.refreshRewards()} />
          </View>
        </>
      ) : null}
      {note === null ? null : <Muted>{note}</Muted>}
    </Card>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 12 },
  domain: { fontSize: 16, lineHeight: 24 },
  address: { fontSize: 13, lineHeight: 20 },
  error: { color: colors.warn },
  actions: { paddingTop: 4 },
  row: { flexDirection: "row", gap: 10, flexWrap: "wrap" },
  walletRow: { gap: 8 },
  walletText: { lineHeight: 20 },
  reportRow: { paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.border, gap: 4 },
  rowHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", gap: 12 },
  reportName: { flex: 1, fontSize: 13, lineHeight: 20 },
  rowWhen: { fontSize: 12, lineHeight: 16, minWidth: 96, textAlign: "right" },
  rowSmall: { fontSize: 12, lineHeight: 16 },
});
