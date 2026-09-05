import { useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";

import { probeDoh, type ProbeResult } from "../dns/probe";
import type { SettingsHandle } from "../hooks/useSettings";
import type { Protection } from "../hooks/useProtection";
import { PUBLIC_RESOLVER, validateSettings, type ResolverSettings } from "../store/settings";
import { colors } from "../theme";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { Choice } from "../ui/Choice";
import { Field } from "../ui/Field";
import { Screen } from "../ui/Screen";
import { Eyebrow, Mono, Muted, Subtitle } from "../ui/Typo";

interface ResolverScreenProps {
  settings: SettingsHandle;
  protection: Protection;
}

const PROBE_NAME = "payhole.org";

function describeProbe(result: ProbeResult): string {
  if (!result.ok) return `No answer: ${result.error ?? "unknown error"} (${result.millis} ms)`;
  const count = result.addresses?.length ?? 0;
  const records = count === 0 ? "no address record" : count === 1 ? "one address record" : `${count} address records`;
  return `Answered in ${result.millis} ms with ${result.rcode ?? "?"}, ${records}${result.blocked === true ? " (blocked)" : ""}.`;
}

export function ResolverScreen({ settings, protection }: ResolverScreenProps) {
  const [draft, setDraft] = useState<ResolverSettings>(settings.value);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [probing, setProbing] = useState(false);
  const [probe, setProbe] = useState<ProbeResult | null>(null);

  useEffect(() => {
    setDraft(settings.value);
  }, [settings.value]);

  const dirty =
    draft.kind !== settings.value.kind ||
    draft.customDohUrl !== settings.value.customDohUrl ||
    draft.customDotHost !== settings.value.customDotHost;

  async function save() {
    setSaved(false);
    const validation = validateSettings(draft);
    if (!validation.ok) {
      setError(validation.error);
      return;
    }
    setError(null);
    await settings.update(draft);
    await protection.applyResolver(draft);
    setSaved(true);
  }

  async function check() {
    const validation = validateSettings(draft);
    if (!validation.ok) {
      setError(validation.error);
      return;
    }
    if (validation.active.dohUrl === null) {
      setError("The check sends one HTTPS query, so it needs a DNS-over-HTTPS URL. DNS-over-TLS only resolvers are used as-is.");
      return;
    }
    setError(null);
    setProbing(true);
    setProbe(null);
    try {
      setProbe(await probeDoh(validation.active.dohUrl, PROBE_NAME));
    } finally {
      setProbing(false);
    }
  }

  return (
    <Screen eyebrow="Resolver" title="Where lookups go" intro="Pick the resolver the tunnel talks to. Both choices are encrypted end to end.">
      <Choice
        title="PayHole public resolver"
        detail="Runs the merged ScamSniffer and StevenBlack lists, keeps no query log, and is refreshed every six hours."
        selected={draft.kind === "public"}
        onSelect={() => setDraft({ ...draft, kind: "public" })}
      />
      <Choice
        title="Custom resolver"
        detail="Your own Sinkhole node or any DNS-over-HTTPS or DNS-over-TLS service."
        selected={draft.kind === "custom"}
        onSelect={() => setDraft({ ...draft, kind: "custom" })}
      />

      {draft.kind === "public" ? (
        <Card>
          <Eyebrow>Endpoints</Eyebrow>
          <Mono selectable>{PUBLIC_RESOLVER.dohUrl}</Mono>
          <Mono selectable>{`${PUBLIC_RESOLVER.dotHost}:853`}</Mono>
          <Muted>Android tries HTTPS first and falls back to TLS. iOS installs the HTTPS setting.</Muted>
        </Card>
      ) : (
        <Card>
          <Field
            label="DNS-over-HTTPS URL"
            value={draft.customDohUrl}
            onChangeText={(customDohUrl) => setDraft({ ...draft, customDohUrl })}
            placeholder="https://dns.example.org/dns-query"
            keyboardType="url"
          />
          <Field
            label="DNS-over-TLS host"
            value={draft.customDotHost}
            onChangeText={(customDotHost) => setDraft({ ...draft, customDotHost })}
            placeholder="dns.example.org"
          />
          <Muted>Fill in one or both. A Sinkhole node exposes both once it has a certificate.</Muted>
        </Card>
      )}

      {error === null ? null : (
        <Card tone="danger">
          <Muted color={colors.danger}>{error}</Muted>
        </Card>
      )}

      <View style={styles.actions}>
        <Button
          label={saved && !dirty ? "Saved" : "Save"}
          disabled={!dirty && saved}
          onPress={() => {
            void save();
          }}
        />
        <Button
          label="Check resolver"
          variant="ghost"
          busy={probing}
          onPress={() => {
            void check();
          }}
        />
      </View>

      {probe === null ? null : (
        <Card tone={probe.ok ? "default" : "warn"}>
          <Subtitle>{probe.ok ? "Resolver answered" : "Resolver did not answer"}</Subtitle>
          <Muted>{describeProbe(probe)}</Muted>
          <Muted>{`Test name: ${PROBE_NAME}`}</Muted>
        </Card>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  actions: { gap: 10 },
});
