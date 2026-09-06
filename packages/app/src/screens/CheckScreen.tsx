import { useCallback, useEffect, useState } from "react";
import { Share, StyleSheet, View } from "react-native";

import { describeVerdict, extractName, fetchVerdict, shareText, type Verdict } from "../dns/verdict";
import { LINKS } from "../links";
import { colors } from "../theme";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { CategoryTag } from "../ui/CategoryTag";
import { Field } from "../ui/Field";
import { Screen } from "../ui/Screen";
import { Body, Eyebrow, Mono, Muted, Subtitle } from "../ui/Typo";

interface CheckScreenProps {
  /** Text handed to the app by the share sheet; checked as soon as it arrives. */
  shared: string | null;
  onSharedConsumed: () => void;
}

const SOURCE_WORDS: Record<string, string> = {
  swarm: "confirmed by the swarm",
  list: "on a subscribed list",
  manual: "blocked by an operator",
  local: "flagged by the extension",
};

export function CheckScreen({ shared, onSharedConsumed }: CheckScreenProps) {
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  useEffect(() => {
    if (shared === null) return;
    setInput(shared);
    onSharedConsumed();
    void check(shared);
  }, [shared, onSharedConsumed, check]);

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

      <Card>
        <Subtitle>What the answer means</Subtitle>
        <Muted>Blocked means every PayHole user's phone refuses to load it, and why: a wallet drainer, phishing, drainer infrastructure, a counterfeit token site, a tracker, or an ad. Confirmed by the swarm means independent nodes run by tier holders agreed on it. Not blocked is only what the network knows today, not a promise.</Muted>
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 12 },
  domain: { fontSize: 16, lineHeight: 24 },
  error: { color: colors.warn },
  actions: { paddingTop: 4 },
});
