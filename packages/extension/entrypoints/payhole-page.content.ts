import { defineContentScript } from "wxt/utils/define-content-script";
import { installPageWrappers } from "@/lib/page-wrapper";

/** Page world: wraps fetch and XMLHttpRequest so 402s are paid and retried transparently. */
export default defineContentScript({
  matches: ["http://*/*", "https://*/*"],
  runAt: "document_start",
  allFrames: true,
  world: "MAIN",
  main() {
    try {
      installPageWrappers(window);
    } catch (error) {
      console.warn("[payhole] page wrappers not installed", error);
    }
  },
});
