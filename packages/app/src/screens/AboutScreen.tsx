import Constants from "expo-constants";
import { Linking, StyleSheet, View } from "react-native";

import { LINKS } from "../links";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { Screen } from "../ui/Screen";
import { Body, Eyebrow, Muted, Subtitle } from "../ui/Typo";

const LINK_ROWS: { label: string; url: string }[] = [
  { label: "payhole.org", url: LINKS.site },
  { label: "Browser extension tutorial", url: LINKS.extension },
  { label: "Run a Sinkhole node", url: LINKS.sinkhole },
  { label: "Blog", url: LINKS.blog },
  { label: "Source code", url: LINKS.github },
  { label: "PayHole on X", url: LINKS.x },
  { label: "Privacy", url: LINKS.privacy },
];

export function AboutScreen() {
  const version = Constants.expoConfig?.version ?? "0.1.0";
  return (
    <Screen eyebrow="About" title={`PayHole ${version}`} intro="A small app with one job for now: keep this phone's DNS encrypted and pointed at a resolver that drops drainers, phishing pages, and trackers.">
      <Card>
        <Eyebrow>How it works</Eyebrow>
        <Body>
          On Android the app opens a DNS-only tunnel. Only the address your apps use for DNS is routed into it, so everything else keeps its normal path while each lookup is forwarded over HTTPS or TLS.
        </Body>
        <Body>
          On iOS the app installs a system DNS setting through Apple's DNS settings API. The system does the encrypted lookups itself, which is why counters are Android-only.
        </Body>
      </Card>

      <Card>
        <Eyebrow>What it does not do</Eyebrow>
        <Body>No account, no sign-in, no analytics. The public resolver keeps no query log. Blocked names on the Home tab live only on your phone until the tunnel restarts.</Body>
        <Body>
          The PayHole token is never paid out to anyone, including for using this app or running a node. Payments in PayHole are USDG, and the protocol's share only ever buys and burns.
        </Body>
      </Card>

      <Card>
        <Eyebrow>Coming later</Eyebrow>
        <Body>
          The pocket: a small USDG budget on your phone that pays for content, tools, and agents automatically over x402, and lets you pick and pay the operator whose resolver you use.
        </Body>
      </Card>

      <Card>
        <Subtitle>Links</Subtitle>
        <View style={styles.links}>
          {LINK_ROWS.map((row) => (
            <Button
              key={row.url}
              label={row.label}
              variant="ghost"
              onPress={() => {
                void Linking.openURL(row.url);
              }}
            />
          ))}
        </View>
        <Muted>Fonts: Inter, Space Grotesk, and JetBrains Mono under the SIL Open Font License.</Muted>
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  links: { gap: 8 },
});
