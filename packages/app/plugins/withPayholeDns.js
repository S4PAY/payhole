const { withAndroidManifest, withEntitlementsPlist } = require("expo/config-plugins");

const IOS_NETWORK_EXTENSION_KEY = "com.apple.developer.networking.networkextension";
const IOS_DNS_SETTINGS = "dns-settings";

const ANDROID_PERMISSIONS = [
  "android.permission.INTERNET",
  "android.permission.FOREGROUND_SERVICE",
  "android.permission.FOREGROUND_SERVICE_SYSTEM_EXEMPTED",
  "android.permission.POST_NOTIFICATIONS",
];

/**
 * Wires the native pieces the payhole-dns module needs at build time:
 * the iOS entitlement that lets the app install a system DNS setting through
 * NEDNSSettingsManager, and the Android permissions the DNS tunnel service runs with.
 * The VPN service itself is declared in modules/payhole-dns/android and merged by autolinking.
 */
function withPayholeDns(config) {
  config = withEntitlementsPlist(config, (mod) => {
    const current = mod.modResults[IOS_NETWORK_EXTENSION_KEY];
    const values = Array.isArray(current) ? current.filter((v) => typeof v === "string") : [];
    if (!values.includes(IOS_DNS_SETTINGS)) values.push(IOS_DNS_SETTINGS);
    mod.modResults[IOS_NETWORK_EXTENSION_KEY] = values;
    return mod;
  });

  config = withAndroidManifest(config, (mod) => {
    const manifest = mod.modResults.manifest;
    const permissions = manifest["uses-permission"] ?? [];
    for (const name of ANDROID_PERMISSIONS) {
      if (!permissions.some((p) => p.$?.["android:name"] === name)) {
        permissions.push({ $: { "android:name": name } });
      }
    }
    manifest["uses-permission"] = permissions;
    return mod;
  });

  return config;
}

module.exports = withPayholeDns;
