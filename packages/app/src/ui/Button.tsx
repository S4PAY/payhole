import { ActivityIndicator, Pressable, StyleSheet, Text } from "react-native";

import { colors, fonts, radius } from "../theme";

interface ButtonProps {
  label: string;
  onPress: () => void;
  variant?: "primary" | "ghost" | "danger";
  disabled?: boolean;
  busy?: boolean;
}

export function Button({ label, onPress, variant = "primary", disabled = false, busy = false }: ButtonProps) {
  const inactive = disabled || busy;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: inactive, busy }}
      onPress={onPress}
      disabled={inactive}
      style={({ pressed }) => [
        styles.base,
        variant === "primary" && styles.primary,
        variant === "ghost" && styles.ghost,
        variant === "danger" && styles.danger,
        pressed && styles.pressed,
        inactive && styles.inactive,
      ]}
    >
      {busy ? (
        <ActivityIndicator color={variant === "primary" ? colors.bg : colors.text} />
      ) : (
        <Text style={[styles.label, variant === "primary" ? styles.labelOnAccent : styles.labelOnDark]}>{label}</Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: 48,
    paddingHorizontal: 20,
    borderRadius: radius.control,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
  },
  primary: { backgroundColor: colors.accent, borderColor: colors.accent },
  ghost: { backgroundColor: "transparent", borderColor: colors.border },
  danger: { backgroundColor: "transparent", borderColor: colors.danger },
  pressed: { opacity: 0.8 },
  inactive: { opacity: 0.5 },
  label: { fontFamily: fonts.bodySemi, fontSize: 15 },
  labelOnAccent: { color: colors.bg },
  labelOnDark: { color: colors.text },
});
