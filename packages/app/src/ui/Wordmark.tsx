import { useState } from "react";
import { Image, PixelRatio, StyleSheet, Text, View, type TextLayoutEvent } from "react-native";

import logo from "../../assets/logo.png";
import { colors, fonts } from "../theme";

interface WordmarkProps {
  /** Display is the screen title size; nav is the size used in compact headers. */
  size?: "display" | "nav";
  /** Text that follows the mark on the same line, such as a version number. */
  suffix?: string;
}

type Line = TextLayoutEvent["nativeEvent"]["lines"][number];

const SIZES = {
  display: { fontSize: 34, lineHeight: 40 },
  nav: { fontSize: 18, lineHeight: 24 },
} as const;

/**
 * Space Grotesk Bold, as ratios of its x-height. The o's bowl is centred 0.236 em above the
 * baseline and the x-height is 0.486 em; the mark is a touch larger than the bowl, the size it
 * had on the owner's phone, and takes a little more room than an o so it keeps the same air.
 */
const O_CENTER = 0.236 / 0.486;
const MARK = 0.62 / 0.486;
const SLOT = 0.64 / 0.486;

/** Before the first layout event: the same ratios from the nominal font size. */
const EST = { xHeight: 0.486, descent: 0.292 } as const;

/**
 * The PayHole name with the vortex in place of the "o", the same way payhole.org writes it.
 *
 * The letters and the mark sit side by side rather than as an inline image, because Android
 * reserves the slot for an inline image in font-scaled units and draws the image in plain ones,
 * so the two drift apart on any phone that does not use the default font size. The mark is sized
 * and placed from the rendered line itself, which also follows Android's non-linear font scaling.
 */
export function Wordmark({ size = "display", suffix }: WordmarkProps) {
  const metrics = SIZES[size];
  const [line, setLine] = useState<Line | null>(null);

  let xHeight: number;
  let baseline: number;
  let height: number;
  if (line === null) {
    const em = metrics.fontSize * PixelRatio.getFontScale();
    xHeight = EST.xHeight * em;
    height = metrics.lineHeight * PixelRatio.getFontScale();
    baseline = height - EST.descent * em;
  } else {
    xHeight = line.xHeight;
    baseline = line.y + line.ascender;
    height = line.height;
  }
  const markSize = MARK * xHeight;
  const slotWidth = SLOT * xHeight;
  const markTop = baseline - O_CENTER * xHeight - markSize / 2;
  const label = suffix === undefined ? "PayHole" : `PayHole${suffix}`;
  const textStyle = [styles.text, { fontSize: metrics.fontSize, lineHeight: metrics.lineHeight }];

  const onTextLayout = (event: TextLayoutEvent) => {
    const first = event.nativeEvent.lines[0];
    if (first === undefined || first.xHeight <= 0) return;
    setLine((current) =>
      current !== null && current.xHeight === first.xHeight && current.ascender === first.ascender && current.height === first.height
        ? current
        : first,
    );
  };

  return (
    <View style={styles.row} accessible accessibilityRole="header" accessibilityLabel={label}>
      <Text style={textStyle} onTextLayout={onTextLayout}>
        PayH
      </Text>
      <View style={{ width: slotWidth, height }}>
        <Image
          source={logo}
          resizeMode="contain"
          accessibilityIgnoresInvertColors
          style={[styles.mark, { width: markSize, height: markSize, left: (slotWidth - markSize) / 2, top: markTop }]}
        />
      </View>
      <Text style={textStyle}>le{suffix ?? ""}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "flex-start" },
  text: { fontFamily: fonts.display, color: colors.text, letterSpacing: -0.5 },
  mark: { position: "absolute" },
});
