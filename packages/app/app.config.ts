import type { ConfigContext, ExpoConfig } from "expo/config";

const FONTS = [
  "Inter-Regular",
  "Inter-Medium",
  "Inter-SemiBold",
  "Inter-Bold",
  "SpaceGrotesk-Medium",
  "SpaceGrotesk-Bold",
  "JetBrainsMono-Regular",
  "JetBrainsMono-SemiBold",
].map((name) => `./assets/fonts/${name}.ttf`);

// `eas init` normally writes the project id into app.json. This project keeps its config in
// TypeScript, so the id comes from the environment instead: export EAS_PROJECT_ID before building.
const env = process.env as Record<string, string | undefined>;
const easProjectId = env["EAS_PROJECT_ID"];

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: "PayHole",
  slug: "payhole",
  scheme: "payhole",
  version: "0.1.0",
  orientation: "portrait",
  icon: "./assets/icon.png",
  userInterfaceStyle: "dark",
  backgroundColor: "#000000",
  ios: {
    bundleIdentifier: "org.payhole.app",
    supportsTablet: true,
    infoPlist: {
      ITSAppUsesNonExemptEncryption: false,
    },
  },
  android: {
    package: "org.payhole.app",
    adaptiveIcon: {
      foregroundImage: "./assets/adaptive-icon.png",
      backgroundColor: "#000000",
    },
  },
  plugins: [
    [
      "expo-splash-screen",
      {
        image: "./assets/splash-icon.png",
        imageWidth: 200,
        backgroundColor: "#000000",
      },
    ],
    ["expo-font", { fonts: FONTS }],
    "./plugins/withPayholeDns.js",
  ],
  ...(easProjectId ? { extra: { eas: { projectId: easProjectId } } } : {}),
});
