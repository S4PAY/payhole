import type { ReactNode } from "react";
import { ScrollView, StyleSheet, View } from "react-native";

import { colors } from "../theme";
import { Display, Eyebrow, Muted } from "./Typo";

interface ScreenProps {
  eyebrow: string;
  /** A plain string renders as the display title; pass an element such as the Wordmark for anything else. */
  title: ReactNode;
  intro?: string;
  children: ReactNode;
}

export function Screen({ eyebrow, title, intro, children }: ScreenProps) {
  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <View style={styles.header}>
        <Eyebrow>{eyebrow}</Eyebrow>
        {typeof title === "string" ? <Display>{title}</Display> : title}
        {intro === undefined ? null : <Muted>{intro}</Muted>}
      </View>
      {children}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 20, paddingBottom: 32, gap: 16 },
  header: { gap: 8, marginBottom: 4 },
});
