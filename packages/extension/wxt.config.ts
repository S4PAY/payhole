import { defineConfig } from "wxt";

export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  imports: false,
  outDir: ".output",
  manifest: {
    name: "PayHole",
    description: "A capped spending pocket on Robinhood Chain that pays websites, tools, and agents over x402 while you browse.",
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
