import type { ReactNode } from "react";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";

import { colors, radius } from "../theme";

interface CardProps {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  tone?: "default" | "danger" | "warn";
}

export function Card({ children, style, tone = "default" }: CardProps) {
  return <View style={[styles.card, tone === "danger" && styles.danger, tone === "warn" && styles.warn, style]}>{children}</View>;
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.card,
    padding: 18,
    gap: 8,
  },
  danger: { borderColor: colors.danger },
  warn: { borderColor: colors.warn },
});
