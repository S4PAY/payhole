import { StyleSheet, Text, View } from "react-native";

import { categoryLabel, isDangerous } from "../dns/verdict";
import { colors, fonts } from "../theme";

interface CategoryTagProps {
  category: string | null | undefined;
  /** Shown while the category is still being looked up. */
  pending?: boolean;
}

/** A small uppercase pill naming what a blocked name is; red for the dangerous classes. */
export function CategoryTag({ category, pending = false }: CategoryTagProps) {
  const dangerous = isDangerous(category);
  const label = pending && !category ? "checking" : categoryLabel(category);
  return (
    <View style={[styles.pill, dangerous ? styles.danger : category ? styles.plain : styles.pending]}>
      <Text style={[styles.text, dangerous ? styles.dangerText : category ? styles.plainText : styles.pendingText]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  // borderStyle is set in both states: on Android a style that stops setting it keeps the old value.
  pill: { alignSelf: "flex-start", paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, borderWidth: 1, borderStyle: "solid" },
  text: { fontFamily: fonts.mono, fontSize: 10, letterSpacing: 0.8, textTransform: "uppercase" },
  danger: { borderColor: "rgba(255,77,77,0.55)", backgroundColor: "rgba(255,77,77,0.10)" },
  dangerText: { color: "#FF7A7A" },
  plain: { borderColor: colors.border },
  plainText: { color: colors.muted },
  pending: { borderColor: colors.border, borderStyle: "dashed" },
  pendingText: { color: colors.muted },
});
