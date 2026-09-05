import { useEffect, useRef } from "react";
import { Animated, AppState, Easing, Image, StyleSheet } from "react-native";

import vortex from "../../assets/vortex.png";

export type VortexMode = "still" | "turning" | "rushing";

interface VortexProps {
  size: number;
  mode: VortexMode;
}

/** One slow turn while protection is on; a quick one while the tunnel comes up. */
const TURN_MS: Record<Exclude<VortexMode, "still">, number> = {
  turning: 22_000,
  rushing: 2_600,
};

/**
 * The brand vortex, spun by a single transform on the native side. Nothing runs on the
 * JavaScript thread while it turns, and the loop stops whenever the app leaves the foreground,
 * so the tunnel service is the only thing working when the screen is off.
 */
export function Vortex({ size, mode }: VortexProps) {
  const turn = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (mode === "still") return undefined;
    let loop: Animated.CompositeAnimation | null = null;
    const start = () => {
      loop?.stop();
      turn.setValue(0);
      loop = Animated.loop(
        Animated.timing(turn, { toValue: 1, duration: TURN_MS[mode], easing: Easing.linear, useNativeDriver: true }),
      );
      loop.start();
    };
    const stop = () => {
      loop?.stop();
      loop = null;
    };
    if (AppState.currentState === "active") start();
    const subscription = AppState.addEventListener("change", (next) => {
      if (next === "active") start();
      else stop();
    });
    return () => {
      subscription.remove();
      stop();
    };
  }, [mode, turn]);

  const rotate = turn.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "360deg"] });

  return (
    <Animated.View renderToHardwareTextureAndroid style={{ transform: [{ rotate }] }}>
      <Image
        source={vortex}
        accessibilityIgnoresInvertColors
        style={[styles.image, { width: size, height: size, opacity: mode === "still" ? 0.28 : 0.95 }]}
      />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  image: { resizeMode: "cover" },
});
