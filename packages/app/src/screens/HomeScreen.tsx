import { Pressable, StyleSheet, View } from "react-native";

import type { Protection } from "../hooks/useProtection";
import { describeHistory, summarizeHistory } from "../stats/bars";
import { colors, fonts, formatCount } from "../theme";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { Histogram } from "../ui/Histogram";
import { Screen } from "../ui/Screen";
import { Body, Display, Eyebrow, Mono, Muted, Subtitle } from "../ui/Typo";
import { Vortex, type VortexMode } from "../ui/Vortex";
import { Wordmark } from "../ui/Wordmark";

interface HomeScreenProps {
  protection: Protection;
}

const RING = 232;
const RING_BORDER = 2;

function statusWord(protection: Protection): string {
  const { state, busy } = protection;
  if (busy || state.status === "connecting") return "Working";
  if (state.status === "on") return "On";
  if (state.status === "error") return "Error";
  if (state.needsUserAction) return "Almost";
  return "Off";
}

function statusLine(protection: Protection): string {
  const { state, platform } = protection;
  if (!protection.supported) return "Encrypted DNS needs the Android or iOS build of PayHole.";
  if (state.status === "on") return `Every DNS lookup on this device goes encrypted to ${state.resolver ?? "the resolver"}.`;
  if (state.status === "connecting") return "Bringing the tunnel up.";
  if (state.status === "error") return state.error ?? "Something went wrong starting protection.";
  if (state.needsUserAction) {
    return "The PayHole DNS setting is installed. iOS asks you to switch it on once: Settings, General, VPN, DNS & Device Management, DNS, then PayHole.";
  }
  return platform === "ios"
    ? "Tap to install a system-wide encrypted DNS setting."
    : "Tap to route this device's DNS through an encrypted tunnel.";
}

function vortexMode(protection: Protection): VortexMode {
  if (protection.busy || protection.state.status === "connecting") return "rushing";
  if (protection.state.status === "on") return "turning";
  return "still";
}

export function HomeScreen({ protection }: HomeScreenProps) {
  const { state } = protection;
  const on = state.status === "on";
  const android = protection.platform === "android";
  const summary = summarizeHistory(state.history);

  return (
    <Screen eyebrow="Protection" title={<Wordmark />} intro="Drainers, phishing pages, and trackers stop at the resolver before your phone ever connects.">
      <View style={styles.hero}>
        <Pressable
          accessibilityRole="switch"
          accessibilityState={{ checked: on, busy: protection.busy, disabled: !protection.supported }}
          accessibilityLabel={on ? "Turn protection off" : "Turn protection on"}
          disabled={!protection.supported || protection.busy}
          onPress={() => {
            void protection.toggle();
          }}
          style={({ pressed }) => [styles.ring, on && styles.ringOn, state.status === "error" && styles.ringError, pressed && styles.ringPressed]}
        >
          <View style={styles.ringClip} pointerEvents="none">
            <Vortex size={RING + 28} mode={vortexMode(protection)} />
          </View>
          <View style={styles.ringLabel} pointerEvents="none">
            <Display style={styles.ringWord} color={on ? colors.accent : colors.text}>
              {statusWord(protection)}
            </Display>
            <Muted style={styles.ringHint}>{on ? "tap to turn off" : "tap to turn on"}</Muted>
          </View>
        </Pressable>
        <Body style={styles.statusLine}>{statusLine(protection)}</Body>
        {state.needsUserAction ? <Button label="Open Settings" variant="ghost" onPress={() => protection.openSettings()} /> : null}
      </View>

      {protection.message === null ? null : (
        <Card tone="danger">
          <Subtitle>Could not change protection</Subtitle>
          <Muted>{protection.message}</Muted>
          <Button label="Dismiss" variant="ghost" onPress={() => protection.dismissMessage()} />
        </Card>
      )}

      <View style={styles.stats}>
        <Card style={styles.stat}>
          <Eyebrow>Queries</Eyebrow>
          <Display>{formatCount(state.queries)}</Display>
          <Muted>{android ? "in the last 24 hours" : "counted on Android only"}</Muted>
        </Card>
        <Card style={styles.stat}>
          <Eyebrow>Blocked</Eyebrow>
          <Display color={state.blocked > 0 ? colors.accent : colors.text}>{formatCount(state.blocked)}</Display>
          <Muted>{android ? "answers sent to nowhere" : "counted on Android only"}</Muted>
        </Card>
      </View>

      {android ? (
        <Card>
          <View style={styles.chartHead}>
            <Eyebrow>Last 24 hours</Eyebrow>
            <View style={styles.legend}>
              <View style={[styles.swatch, styles.swatchTotal]} />
              <Muted style={styles.legendText}>lookups</Muted>
              <View style={[styles.swatch, styles.swatchBlocked]} />
              <Muted style={styles.legendText}>blocked</Muted>
            </View>
          </View>
          <Histogram buckets={state.history} />
          <Muted>{describeHistory(summary)}</Muted>
        </Card>
      ) : null}

      <Card>
        <Eyebrow>Last blocked</Eyebrow>
        {state.recentBlocked.length === 0 ? (
          <Muted>
            {android
              ? on
                ? "Nothing blocked yet. Names show up here as the lists catch them."
                : "Turn protection on and blocked names will be listed here."
              : "iOS runs the DNS setting inside the system, so the app cannot see individual lookups. The blocking still happens at the resolver."}
          </Muted>
        ) : (
          state.recentBlocked.map((name) => (
            <Mono key={name} selectable style={styles.blockedRow}>
              {name}
            </Mono>
          ))
        )}
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { alignItems: "center", gap: 16, paddingVertical: 8 },
  ring: {
    width: RING,
    height: RING,
    borderRadius: RING / 2,
    borderWidth: RING_BORDER,
    borderColor: colors.border,
    backgroundColor: colors.bg,
    alignItems: "center",
    justifyContent: "center",
  },
  ringOn: { borderColor: colors.accent, shadowColor: colors.accent, shadowOpacity: 0.35, shadowRadius: 24, shadowOffset: { width: 0, height: 0 }, elevation: 6 },
  ringError: { borderColor: colors.danger },
  ringPressed: { opacity: 0.85 },
  ringClip: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: RING / 2 - RING_BORDER,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.bg,
  },
  ringLabel: {
    width: 136,
    height: 136,
    borderRadius: 68,
    backgroundColor: "rgba(0,0,0,0.5)",
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
  },
  ringWord: {
    fontFamily: fonts.display,
    fontSize: 40,
    lineHeight: 46,
    textAlign: "center",
    textShadowColor: "rgba(0,0,0,0.9)",
    textShadowRadius: 10,
    textShadowOffset: { width: 0, height: 0 },
  },
  ringHint: {
    width: 120,
    textAlign: "center",
    color: "#C9C9D2",
    textShadowColor: "rgba(0,0,0,0.9)",
    textShadowRadius: 8,
    textShadowOffset: { width: 0, height: 0 },
  },
  statusLine: { textAlign: "center", paddingHorizontal: 8 },
  stats: { flexDirection: "row", gap: 12 },
  stat: { flex: 1 },
  chartHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 12 },
  legend: { flexDirection: "row", alignItems: "center", gap: 6 },
  legendText: { fontSize: 12, lineHeight: 16 },
  swatch: { width: 10, height: 10, borderRadius: 2 },
  swatchTotal: { backgroundColor: "#2A2A33" },
  swatchBlocked: { backgroundColor: colors.accent, marginLeft: 6 },
  blockedRow: { paddingVertical: 4, borderBottomWidth: 1, borderBottomColor: colors.border },
});
