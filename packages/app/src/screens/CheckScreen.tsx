import { useCallback, useEffect, useState } from "react";
import { Linking, Share, StyleSheet, View } from "react-native";
import * as Clipboard from "expo-clipboard";

import { describeVerdict, extractName, fetchVerdict, shareText, type Category, type Verdict } from "../dns/verdict";
import { useReporter, type Reporter } from "../hooks/useReporter";
import { LINKS } from "../links";
import { describeReport } from "../report/client";
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
      (problem) => setLinkNote(problem ?? "Linked. Reports from this phone now count as that wallet's flags."),
      (e: unknown) => setLinkNote(e instanceof Error ? e.message : String(e)),
    );
  }, [pendingProof, reporterReady, linkReporter]);

  const share = async () => {
    if (!verdict) return;
    await Share.share({ message: shareText(verdict) });
  };

  return (
    <Screen eyebrow="Check" title="Check a link" intro="Paste a link, a domain, or the text of a message. The resolver says whether PayHole blocks it and why. From any app, use Share and pick PayHole.">
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

      <Card>
        <Subtitle>What the answer means</Subtitle>
        <Muted>Blocked means every PayHole user's phone refuses to load it, and why: a wallet drainer, phishing, drainer infrastructure, a counterfeit token site, a tracker, or an ad. Confirmed by the swarm means independent nodes run by tier holders agreed on it. Not blocked is only what the network knows today, not a promise.</Muted>
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
      setOutcome(`${describeReport(result, reporter.holder !== null)}${fellBack ? " Signed reports are not open on the network yet, so this one was counted as a plain report." : ""}`);
    } catch (e) {
      setOutcome(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <Eyebrow>Report it</Eyebrow>
      <Body>{reporter.holder ? "Your phone reports for a tier holder. This goes into the swarm as that wallet's flag." : "Seen this name in a scam? Say what it is. Reports are counted and shown to the tier holders who can confirm them."}</Body>
      {REPORT_KINDS.map((kind) => (
        <Choice key={kind.category} title={kind.title} detail={kind.detail} selected={category === kind.category} onSelect={() => setCategory(kind.category)} />
      ))}
      <Field label="What happened, in a few words (optional)" value={reason} onChangeText={setReason} placeholder="Asked me to sign to claim an airdrop" />
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
    setNote("Reporter key copied.");
  };

  const link = async () => {
    setBusy(true);
    setNote(null);
    try {
      const problem = await reporter.link(proofText);
      setNote(problem ?? "Linked. Reports from this phone now count as that wallet's flags.");
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
              <Body>{`Linked to ${reporter.holder.slice(0, 6)}…${reporter.holder.slice(-4)}. Reports from this phone count as that wallet's flags, and they take the fast lane when a list already names the domain.`}</Body>
              <View style={styles.row}>
                <Button label="Copy key" variant="ghost" onPress={() => void copy()} />
                <Button label="Unlink" variant="ghost" onPress={() => void reporter.unlink()} />
              </View>
            </>
          ) : (
            <>
              <Muted>No money lives here; it only signs. A tier holder can make this phone report for their wallet: copy the key, open the link page with that wallet, sign once, and paste the proof below.</Muted>
              <View style={styles.row}>
                <Button label="Copy key" variant="ghost" onPress={() => void copy()} />
                <Button label="Open the link page" variant="ghost" onPress={() => void Linking.openURL(`${LINKS.link}?key=${reporter.address ?? ""}`)} />
              </View>
              <Field label="Proof from the link page" value={proofText} onChangeText={setProofText} placeholder='{"peerId":"0x…","address":"0x…",…}' />
              <Button label={busy ? "Checking" : "Link this phone"} disabled={busy || proofText.trim().length === 0} onPress={() => void link()} />
            </>
          )}
          {note === null ? null : <Muted>{note}</Muted>}
        </>
      )}
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
});
