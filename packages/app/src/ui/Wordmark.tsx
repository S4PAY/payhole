import { Image, StyleSheet, Text } from "react-native";

import mark from "../../assets/wordmark-o.png";
import { colors, fonts } from "../theme";

interface WordmarkProps {
  /** Display is the screen title size; nav is the size used in compact headers. */
  size?: "display" | "nav";
  /** Text that follows the mark on the same line, such as a version number. */
  suffix?: string;
}

/**
 * The inline picture takes the advance width of a lowercase o and stands on the baseline, like
 * any inline image in Android text. The air around the vortex is part of the picture: margins on
 * an inline image are not honoured on Android and only push the picture into the next letter.
 * The asset is a 21:24 box with an 18-unit disc centred horizontally and resting on the bottom,
 * so the disc sits where the o would, about half a pixel above its overshoot.
 */
const SIZES = {
  display: { fontSize: 34, lineHeight: 40, markWidth: 21, markHeight: 24 },
  nav: { fontSize: 18, lineHeight: 24, markWidth: 11, markHeight: 13 },
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
      <Image
        source={mark}
        style={{ width: metrics.markWidth, height: metrics.markHeight }}
        resizeMode="contain"
        accessibilityIgnoresInvertColors
      />
      le{suffix ?? ""}
    </Text>
  );
}

const styles = StyleSheet.create({
  text: { fontFamily: fonts.display, color: colors.text, letterSpacing: -0.5 },
});
