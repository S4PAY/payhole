import { useEffect, useState } from "react";
import { Linking, StyleSheet, View } from "react-native";

import { fetchLastUpdated, formatAge, LIST_SOURCES } from "../lists/sources";
import { LINKS } from "../links";
import { Button } from "./Button";
import { Card } from "./Card";
import { Body, Eyebrow, Muted, Subtitle, Title } from "./Typo";

type Freshness = { kind: "loading" } | { kind: "known"; date: Date } | { kind: "unknown" };

/** The three lists the public resolver runs, with their licenses and how fresh each is upstream. */
export function ListSources() {
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
    <>
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
    </>
  );
}

const styles = StyleSheet.create({
  actions: { marginTop: 6 },
});
