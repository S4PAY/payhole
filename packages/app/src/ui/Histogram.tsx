import { StyleSheet, View } from "react-native";

import type { HistoryBucket } from "../../modules/payhole-dns";
import { scaleBars } from "../stats/bars";
import { colors } from "../theme";
import { Muted } from "./Typo";

interface HistogramProps {
  buckets: readonly HistoryBucket[];
  height?: number;
}

/** Forty-eight half-hour slices, oldest on the left. Grey is every lookup, green the blocked ones. */
export function Histogram({ buckets, height = 88 }: HistogramProps) {
  const bars = scaleBars(buckets, height);
  return (
    <View accessible accessibilityRole="image" accessibilityLabel="Lookups per half hour over the last day">
      <View style={[styles.plot, { height }]}>
        {bars.map((bar, index) => (
          <View key={buckets[index]?.start ?? index} style={styles.slot}>
            <View style={[styles.total, { height: bar.total }]} />
            <View style={[styles.blocked, { height: bar.blocked }]} />
          </View>
        ))}
      </View>
      <View style={styles.axis}>
        <Muted style={styles.axisLabel}>24 hours ago</Muted>
        <Muted style={styles.axisLabel}>now</Muted>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  plot: {
    flexDirection: "row",
    alignItems: "flex-end",
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingHorizontal: 1,
  },
  slot: { flex: 1, height: "100%", justifyContent: "flex-end", marginHorizontal: 1 },
  total: { backgroundColor: "#2A2A33", borderTopLeftRadius: 2, borderTopRightRadius: 2 },
  blocked: { position: "absolute", left: 0, right: 0, bottom: 0, backgroundColor: colors.accent, borderTopLeftRadius: 2, borderTopRightRadius: 2 },
  axis: { flexDirection: "row", justifyContent: "space-between", paddingTop: 6 },
  axisLabel: { fontSize: 12, lineHeight: 16 },
});
