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
  version: "0.5.1",
  orientation: "portrait",
  icon: "./assets/icon.png",
  userInterfaceStyle: "dark",
  backgroundColor: "#000000",
  ios: {
    bundleIdentifier: "org.payhole.app",
    supportsTablet: true,
    buildNumber: "7",
    infoPlist: {
      ITSAppUsesNonExemptEncryption: false,
    },
  },
  android: {
    package: "org.payhole.app",
    versionCode: 11,
    blockedPermissions: [
      "android.permission.READ_EXTERNAL_STORAGE",
      "android.permission.WRITE_EXTERNAL_STORAGE",
      "android.permission.SYSTEM_ALERT_WINDOW",
    ],
    intentFilters: [
      {
        action: "SEND",
        category: ["DEFAULT"],
        data: [{ mimeType: "text/plain" }],
      },
    ],
    adaptiveIcon: {
      foregroundImage: "./assets/adaptive-icon.png",
      backgroundColor: "#000000",
    },
  },
  plugins: [
    "./plugins/withReleaseSigning.js",
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
