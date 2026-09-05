import { useEffect, useState } from "react";
import { Linking, StyleSheet, View } from "react-native";

import { fetchLastUpdated, formatAge, LIST_SOURCES } from "../lists/sources";
import { LINKS } from "../links";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { Screen } from "../ui/Screen";
import { Body, Eyebrow, Muted, Subtitle, Title } from "../ui/Typo";

type Freshness = { kind: "loading" } | { kind: "known"; date: Date } | { kind: "unknown" };

export function ListsScreen() {
  const [freshness, setFreshness] = useState<Record<string, Freshness>>({});

  useEffect(() => {
    let cancelled = false;
    for (const source of LIST_SOURCES) {
      setFreshness((prev) => ({ ...prev, [source.id]: { kind: "loading" } }));
      void fetchLastUpdated(source).then((date) => {
        if (cancelled) return;
        setFreshness((prev) => ({ ...prev, [source.id]: date === null ? { kind: "unknown" } : { kind: "known", date } }));
      });
    }
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <Screen eyebrow="Lists" title="What gets blocked" intro="The public resolver merges three open lists. Together they cover about 820,000 names and reload every six hours.">
      {LIST_SOURCES.map((source) => {
        const state = freshness[source.id] ?? { kind: "loading" };
        const updated =
          state.kind === "known"
            ? `Upstream updated ${formatAge(state.date)}`
            : state.kind === "loading"
              ? "Checking upstream for the last update"
              : "Upstream update time unavailable right now";
        return (
          <Card key={source.id}>
            <Eyebrow>{source.approximateEntries}</Eyebrow>
            <Title>{source.name}</Title>
            <Body>{source.summary}</Body>
            <Muted>{`${source.license} license. ${updated}.`}</Muted>
            <View style={styles.actions}>
              <Button
                label="Source on GitHub"
                variant="ghost"
                onPress={() => {
                  void Linking.openURL(source.homepage);
                }}
              />
            </View>
          </Card>
        );
      })}

      <Card>
        <Subtitle>Want different lists?</Subtitle>
        <Body>
          Run your own Sinkhole node on a spare single-board computer, subscribe it to any hosts or JSON list, and point this app at it from the Resolver tab.
        </Body>
        <View style={styles.actions}>
          <Button
            label="Sinkhole tutorial"
            variant="ghost"
            onPress={() => {
              void Linking.openURL(LINKS.sinkhole);
            }}
          />
        </View>
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  actions: { marginTop: 6 },
});
