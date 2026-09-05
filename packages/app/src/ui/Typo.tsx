import type { ReactNode } from "react";
import { StyleSheet, Text, type StyleProp, type TextStyle } from "react-native";

import { colors, fonts } from "../theme";

interface TypoProps {
  children: ReactNode;
  style?: StyleProp<TextStyle>;
  color?: string;
  selectable?: boolean;
}

function make(base: TextStyle) {
  return function Typo({ children, style, color, selectable }: TypoProps) {
    return (
      <Text
        style={[base, color === undefined ? null : { color }, style]}
        selectable={selectable ?? false}
      >
        {children}
      </Text>
    );
  };
}

const styles = StyleSheet.create({
  display: { fontFamily: fonts.display, fontSize: 34, lineHeight: 40, color: colors.text, letterSpacing: -0.5 },
  title: { fontFamily: fonts.display, fontSize: 22, lineHeight: 28, color: colors.text },
  subtitle: { fontFamily: fonts.bodySemi, fontSize: 16, lineHeight: 22, color: colors.text },
  body: { fontFamily: fonts.body, fontSize: 15, lineHeight: 23, color: colors.text },
  muted: { fontFamily: fonts.body, fontSize: 14, lineHeight: 21, color: colors.muted },
  eyebrow: {
    fontFamily: fonts.bodyMedium,
    fontSize: 12,
    lineHeight: 16,
    color: colors.accent,
    letterSpacing: 1.2,
    textTransform: "uppercase",
  },
  mono: { fontFamily: fonts.mono, fontSize: 13, lineHeight: 20, color: colors.text },
});

export const Display = make(styles.display);
export const Title = make(styles.title);
export const Subtitle = make(styles.subtitle);
export const Body = make(styles.body);
export const Muted = make(styles.muted);
export const Eyebrow = make(styles.eyebrow);
export const Mono = make(styles.mono);
