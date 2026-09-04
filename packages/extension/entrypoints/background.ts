import { browser } from "wxt/browser";
import { defineBackground } from "wxt/utils/define-background";
import { BackgroundApp } from "@/lib/app";
import { parseBridgeRequest } from "@/lib/bridge";
import { isApiRequest } from "@/lib/messages";

const HTTP_URLS = ["http://*/*", "https://*/*"];

export default defineBackground(() => {
  const app = new BackgroundApp();

  browser.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
    if (isApiRequest(message)) {
      void app.handleApi(message, sender).then(sendResponse);
      return true;
    }
    const bridge = parseBridgeRequest(message);
    if (bridge) {
      void app.handleBridge(bridge, sender).then(sendResponse);
      return true;
    }
    return false;
  });

  browser.webRequest.onHeadersReceived.addListener(
    (details) => {
      void app.onHeadersReceived(details);
    },
    { urls: HTTP_URLS, types: ["main_frame", "sub_frame", "xmlhttprequest"] },
    ["responseHeaders"],
  );
  browser.webRequest.onCompleted.addListener((details) => app.onRequestFinished(details), { urls: HTTP_URLS, types: ["main_frame"] });
  browser.webRequest.onErrorOccurred.addListener((details) => app.onRequestFinished(details), { urls: HTTP_URLS, types: ["main_frame"] });
  browser.webNavigation.onCommitted.addListener((details) => {
    void app.onNavigationCommitted(details);
  });
  browser.alarms.onAlarm.addListener((alarm) => {
    void app.onAlarm(alarm.name);
  });
  browser.windows.onRemoved.addListener((windowId) => app.onWindowRemoved(windowId));
  browser.tabs.onRemoved.addListener((tabId) => {
    void app.onTabRemoved(tabId);
  });
});
