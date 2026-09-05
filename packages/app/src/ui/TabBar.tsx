import { Pressable, StyleSheet, Text, View } from "react-native";

import { colors, fonts } from "../theme";

export type Tab = "home" | "resolver" | "lists" | "about";

const TABS: { id: Tab; label: string }[] = [
  { id: "home", label: "Home" },
  { id: "resolver", label: "Resolver" },
  { id: "lists", label: "Lists" },
  { id: "about", label: "About" },
];

interface TabBarProps {
  tab: Tab;
  onChange: (tab: Tab) => void;
  bottomInset: number;
}

export function TabBar({ tab, onChange, bottomInset }: TabBarProps) {
  return (
    <View style={[styles.bar, { paddingBottom: Math.max(bottomInset, 10) }]} accessibilityRole="tablist">
      {TABS.map((item) => {
        const active = item.id === tab;
        return (
          <Pressable
            key={item.id}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            onPress={() => onChange(item.id)}
            style={styles.item}
          >
            <View style={[styles.indicator, active && styles.indicatorOn]} />
            <Text style={[styles.label, active && styles.labelOn]}>{item.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: "row",
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
    paddingTop: 10,
    paddingHorizontal: 8,
  },
  item: { flex: 1, alignItems: "center", gap: 6, paddingVertical: 6 },
  indicator: { width: 18, height: 3, borderRadius: 2, backgroundColor: "transparent" },
  indicatorOn: { backgroundColor: colors.accent },
  label: { fontFamily: fonts.bodyMedium, fontSize: 12, color: colors.muted },
  labelOn: { color: colors.text },
});
