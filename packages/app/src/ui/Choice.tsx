import { Pressable, StyleSheet, View } from "react-native";

import { colors } from "../theme";
import { Muted, Subtitle } from "./Typo";

interface ChoiceProps {
  title: string;
  detail: string;
  selected: boolean;
  onSelect: () => void;
}

export function Choice({ title, detail, selected, onSelect }: ChoiceProps) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      onPress={onSelect}
      style={({ pressed }) => [styles.row, selected && styles.selected, pressed && styles.pressed]}
    >
      <View style={[styles.dot, selected && styles.dotOn]} />
      <View style={styles.text}>
        <Subtitle>{title}</Subtitle>
        <Muted>{detail}</Muted>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    backgroundColor: colors.surface,
  },
  selected: { borderColor: colors.accent },
  pressed: { opacity: 0.85 },
  dot: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2,
    borderColor: colors.muted,
    marginTop: 3,
  },
  dotOn: { borderColor: colors.accent, backgroundColor: colors.accent },
  text: { flex: 1, gap: 4 },
});
