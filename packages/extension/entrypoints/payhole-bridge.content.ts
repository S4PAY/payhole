import { browser } from "wxt/browser";
import { defineContentScript } from "wxt/utils/define-content-script";
import { installBridge } from "@/lib/bridge";

/** Isolated world: relays validated page messages to the background and posts the reply back. */
export default defineContentScript({
  matches: ["http://*/*", "https://*/*"],
  runAt: "document_start",
  allFrames: true,
  main() {
    installBridge(window, (request) => browser.runtime.sendMessage(request));
  },
});
