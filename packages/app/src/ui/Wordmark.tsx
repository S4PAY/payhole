import { Image, StyleSheet, Text } from "react-native";

import logo from "../../assets/logo.png";
import { colors, fonts } from "../theme";

interface WordmarkProps {
  /** Display is the screen title size; nav is the size used in compact headers. */
  size?: "display" | "nav";
  /** Text that follows the mark on the same line, such as a version number. */
  suffix?: string;
}

const SIZES = {
  display: { fontSize: 34, lineHeight: 40, mark: 31 },
  nav: { fontSize: 18, lineHeight: 24, mark: 17 },
} as const;

/** The PayHole name with the vortex in place of the "o", the same way payhole.org writes it. */
export function Wordmark({ size = "display", suffix }: WordmarkProps) {
  const metrics = SIZES[size];
  return (
    <Text
      style={[styles.text, { fontSize: metrics.fontSize, lineHeight: metrics.lineHeight }]}
      accessibilityLabel={suffix === undefined ? "PayHole" : `PayHole${suffix}`}
    >
      PayH
      <Image source={logo} style={[styles.mark, { width: metrics.mark, height: metrics.mark }]} accessibilityIgnoresInvertColors />
      le{suffix ?? ""}
    </Text>
  );
}

const styles = StyleSheet.create({
  text: { fontFamily: fonts.display, color: colors.text, letterSpacing: -0.5 },
  mark: { marginHorizontal: 1 },
});
