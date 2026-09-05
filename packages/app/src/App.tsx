import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import { SafeAreaProvider, useSafeAreaInsets } from "react-native-safe-area-context";

import { useProtection } from "./hooks/useProtection";
import { useSettings } from "./hooks/useSettings";
import { AboutScreen } from "./screens/AboutScreen";
import { HomeScreen } from "./screens/HomeScreen";
import { ListsScreen } from "./screens/ListsScreen";
import { ResolverScreen } from "./screens/ResolverScreen";
import { colors } from "./theme";
import { TabBar, type Tab } from "./ui/TabBar";

void SplashScreen.preventAutoHideAsync();

function Root() {
  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState<Tab>("home");
  const settings = useSettings();
  const protection = useProtection(settings.value);

  useEffect(() => {
    if (settings.ready) void SplashScreen.hideAsync();
  }, [settings.ready]);

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.body}>
        {tab === "home" ? <HomeScreen protection={protection} /> : null}
        {tab === "resolver" ? <ResolverScreen settings={settings} protection={protection} /> : null}
        {tab === "lists" ? <ListsScreen /> : null}
        {tab === "about" ? <AboutScreen /> : null}
      </View>
      <TabBar tab={tab} onChange={setTab} bottomInset={insets.bottom} />
    </View>
  );
}

export function App() {
  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <Root />
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  body: { flex: 1 },
});
