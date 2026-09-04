import { defineConfig } from "wxt";

export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  imports: false,
  outDir: ".output",
  manifest: {
    name: "PayHole",
    description: "Spending-pocket wallet on Robinhood Chain: capped per-site addresses, x402 payments, tracker blocking, creator tips.",
    permissions: [
      "storage",
      "alarms",
      "tabs",
      "webRequest",
      "webNavigation",
      "declarativeNetRequest",
      "declarativeNetRequestWithHostAccess",
    ],
    host_permissions: ["<all_urls>"],
    minimum_chrome_version: "116",
    action: { default_title: "PayHole" },
  },
});
