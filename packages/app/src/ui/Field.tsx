import { StyleSheet, TextInput, View } from "react-native";

import { colors, fonts, radius } from "../theme";
import { Muted } from "./Typo";

interface FieldProps {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder: string;
  keyboardType?: "default" | "url";
}

export function Field({ label, value, onChangeText, placeholder, keyboardType = "default" }: FieldProps) {
  return (
    <View style={styles.wrap}>
      <Muted>{label}</Muted>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.muted}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType={keyboardType}
        style={styles.input}
        accessibilityLabel={label}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 6 },
  input: {
    minHeight: 46,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.control,
    paddingHorizontal: 14,
    color: colors.text,
    fontFamily: fonts.mono,
    fontSize: 14,
    backgroundColor: colors.bg,
  },
});
