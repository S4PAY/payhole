import { useCallback, useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";

import { describeList, describeRadar, fetchRadar, withCommas, type Radar, type RadarBrand } from "../dns/radar";
import { categoryLabel, type Category } from "../dns/verdict";
import { LINKS } from "../links";
import { LIST_SOURCES } from "../lists/sources";
import { colors } from "../theme";
import { ago } from "../time";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { CategoryTag } from "../ui/CategoryTag";
import { ListSources } from "../ui/ListSources";
import { Screen } from "../ui/Screen";
import { Body, Display, Eyebrow, Mono, Muted, Subtitle, Title } from "../ui/Typo";

type State = { kind: "loading" } | { kind: "ready"; radar: Radar } | { kind: "error"; message: string };

const CATEGORY_ORDER: Category[] = ["infra", "drainer", "phishing", "counterfeit", "tracker", "ad", "other"];

/** The friendly name the list cards use for a list the radar reports, matched by its GitHub repository, or the node's own label. */
function listName(label: string): string {
  return LIST_SOURCES.find((source) => source.repo === label)?.name ?? label;
}

export function RadarScreen() {
  const [state, setState] = useState<State>({ kind: "loading" });

  const load = useCallback(() => {
    setState({ kind: "loading" });
    fetchRadar(LINKS.radarUrl).then(
      (radar) => setState({ kind: "ready", radar }),
      (error: unknown) => setState({ kind: "error", message: error instanceof Error ? error.message : String(error) }),
    );
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <Screen
      eyebrow="Radar"
      title="What the network learned"
      intro="Built from what the swarm confirmed and what the lists gained, never from anyone's lookups. The public resolver keeps no query log."
    >
      {state.kind === "loading" ? (
        <Card>
          <Muted>Asking the resolver.</Muted>
        </Card>
      ) : null}
      {state.kind === "error" ? (
        <Card tone="danger">
          <Subtitle>Could not load the radar</Subtitle>
          <Muted>{state.message}</Muted>
          <Button label="Try again" variant="ghost" onPress={load} />
        </Card>
      ) : null}
      {state.kind === "ready" ? <RadarBody radar={state.radar} onRefresh={load} /> : null}
      <Eyebrow style={styles.sectionHead}>The lists</Eyebrow>
      <ListSources />
    </Screen>
  );
}

function RadarBody({ radar, onRefresh }: { radar: Radar; onRefresh: () => void }) {
  const categories = CATEGORY_ORDER.filter((category) => (radar.categories[category] ?? 0) > 0);
  const maxBrand = radar.brands.reduce((max, brand) => Math.max(max, brand.count), 0);
  return (
    <>
      <Body>{describeRadar(radar)}</Body>

      <View style={styles.stats}>
        <Card style={styles.stat}>
          <Eyebrow>Confirmed</Eyebrow>
          <Display color={radar.swarm.confirmed > 0 ? colors.accent : colors.text}>{withCommas(radar.swarm.confirmed)}</Display>
          <Muted>swarm, 24 h</Muted>
        </Card>
        <Card style={styles.stat}>
          <Eyebrow>This week</Eyebrow>
          <Display>{withCommas(radar.swarm.confirmedWeek)}</Display>
          <Muted>swarm, 7 days</Muted>
        </Card>
        <Card style={styles.stat}>
          <Eyebrow>Pending</Eyebrow>
          <Display>{withCommas(radar.swarm.pending)}</Display>
          <Muted>flagged, waiting</Muted>
        </Card>
      </View>

      <Card>
        <Eyebrow>Newest swarm confirmations</Eyebrow>
        {radar.swarm.recent.length === 0 ? (
          <Muted>No new confirmations in the last {radar.windowHours} hours. Names arrive here the moment enough tier holders agree on one.</Muted>
        ) : (
          radar.swarm.recent.map((entry) => (
            <View key={entry.domain} style={styles.row}>
              <View style={styles.rowHead}>
                <Mono selectable style={styles.rowName}>
                  {entry.domain}
                </Mono>
                <Muted style={styles.rowWhen}>{ago(entry.at)}</Muted>
              </View>
              <View style={styles.rowMeta}>
                <CategoryTag category={entry.category} />
                <Muted style={styles.rowSmall}>{`${entry.reporters} reporter${entry.reporters === 1 ? "" : "s"}`}</Muted>
              </View>
            </View>
          ))
        )}
      </Card>

      <Card>
        <Eyebrow>Brands impersonated</Eyebrow>
        {radar.brands.length === 0 ? (
          <Muted>None of the names that arrived in the last {radar.windowHours} hours trade on a brand PayHole knows.</Muted>
        ) : (
          radar.brands.map((brand) => <BrandRow key={brand.brand} brand={brand} max={maxBrand} />)
        )}
      </Card>

      {categories.length > 0 ? (
        <Card>
          <Eyebrow>New names by kind</Eyebrow>
          <View style={styles.chips}>
            {categories.map((category) => (
              <View key={category} style={styles.chip}>
                <Mono style={styles.chipText}>{`${withCommas(radar.categories[category] ?? 0)} ${categoryLabel(category)}`}</Mono>
              </View>
            ))}
          </View>
        </Card>
      ) : null}

      <Card>
        <Eyebrow>Lists in the last {radar.windowHours} hours</Eyebrow>
        {radar.lists.map((list) => (
          <View key={list.url} style={styles.row}>
            <Title>{listName(list.label)}</Title>
            <Muted>{`${withCommas(list.entries)} names. ${describeList(list, radar.windowHours)}`}</Muted>
            {list.sample.length > 0 ? (
              <Mono selectable style={styles.sample}>
                {list.sample.slice(0, 5).join("  ")}
              </Mono>
            ) : null}
          </View>
        ))}
        <Muted style={styles.footnote}>{`Snapshot ${ago(radar.generatedAt)}. The resolver rebuilds it once a minute.`}</Muted>
        <Button label="Refresh" variant="ghost" onPress={onRefresh} />
      </Card>
    </>
  );
}

function BrandRow({ brand, max }: { brand: RadarBrand; max: number }) {
  const share = max > 0 ? Math.max(4, Math.round((brand.count / max) * 100)) : 0;
  return (
    <View style={styles.brand}>
      <View style={styles.brandHead}>
        <Body>{brand.brand}</Body>
        <Mono style={styles.brandCount}>{withCommas(brand.count)}</Mono>
      </View>
      <View style={styles.barTrack}>
        <View style={[styles.barFill, { width: `${share}%` }]} />
      </View>
      {brand.sample.length > 0 ? (
        <Muted selectable style={styles.rowSmall}>
          {brand.sample.join("  ")}
        </Muted>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  stats: { flexDirection: "row", gap: 10 },
  stat: { flex: 1, paddingHorizontal: 14 },
  sectionHead: { marginTop: 8 },
  row: { paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.border, gap: 6 },
  rowHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", gap: 12 },
  rowName: { flex: 1 },
  rowWhen: { fontSize: 12, lineHeight: 16, minWidth: 96, textAlign: "right" },
  rowMeta: { flexDirection: "row", alignItems: "center", gap: 10 },
  rowSmall: { fontSize: 12, lineHeight: 16 },
  sample: { fontSize: 12, lineHeight: 18, color: colors.muted },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, borderWidth: 1, borderColor: colors.border },
  chipText: { fontSize: 12, lineHeight: 16 },
  brand: { paddingVertical: 8, gap: 6 },
  brandHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", gap: 12 },
  brandCount: { fontSize: 14 },
  barTrack: { height: 6, borderRadius: 3, backgroundColor: "#1B1B22", overflow: "hidden" },
  barFill: { height: 6, borderRadius: 3, backgroundColor: colors.accent },
  footnote: { paddingTop: 6 },
});
