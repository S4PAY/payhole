import { defineConfig } from "wxt";

export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  imports: false,
  outDir: ".output",
  manifest: {
    name: "PayHole",
    description: "Scam links stop loading. Every site is checked against PayHole's resolver; wallet drainers, phishing, and counterfeit token sites are stopped before they load.",
    permissions: [
      "storage",
      "alarms",
      "tabs",
      "contextMenus",
      "webRequest",
      "webNavigation",
      "declarativeNetRequest",
      "declarativeNetRequestWithHostAccess",
    ],
    host_permissions: ["<all_urls>"],
    minimum_chrome_version: "116",
    action: { default_title: "PayHole" },
    web_accessible_resources: [{ resources: ["check.html"], matches: ["<all_urls>"] }],
  },
});
