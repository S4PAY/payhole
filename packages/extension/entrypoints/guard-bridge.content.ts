import { browser } from "wxt/browser";
import { defineContentScript } from "wxt/utils/define-content-script";
import type { GuardVerdict } from "@/lib/guard";
import { GUARD_KIND, type GuardMessage } from "@/lib/messages";

/**
 * The isolated half of the wallet guard. The page-world hook describes a request; this script asks the
 * background what the network knows about the addresses in it and, when something is known, puts the warning
 * on the page and waits for the person. Everything else is answered "proceed" at once.
 */
export default defineContentScript({
  matches: ["http://*/*", "https://*/*"],
  runAt: "document_start",
  allFrames: true,
  main() {
    window.addEventListener("message", (event) => {
      if (event.source !== window) return;
      const data = event.data as { source?: unknown; id?: unknown; method?: unknown; params?: unknown } | null;
      if (data?.source !== "payhole-guard-page" || typeof data.id !== "string" || typeof data.method !== "string") return;
      void handle(data.id, data.method, data.params);
    });
  },
});

async function handle(id: string, method: string, params: unknown): Promise<void> {
  const reply = (decision: string): void => {
    window.postMessage({ source: "payhole-guard-bridge", id, decision }, "*");
  };
  let verdict: GuardVerdict | null;
  try {
    verdict = await browser.runtime.sendMessage<GuardMessage, GuardVerdict | null>({ kind: GUARD_KIND, type: "check", method, params, origin: location.origin });
  } catch {
    reply("proceed");
    return;
  }
  if (!verdict || verdict.level === "clear") {
    reply("proceed");
    return;
  }
  reply("asking");
  const choice = await showWarning(verdict);
  browser.runtime.sendMessage({ kind: GUARD_KIND, type: "decided", origin: location.origin, choice, verdict }).catch(() => undefined);
  reply(choice);
}

const STYLE = `
  :host { all: initial; }
  .backdrop { position: fixed; inset: 0; z-index: 2147483647; display: flex; align-items: center; justify-content: center; padding: 24px; background: rgba(0, 0, 0, 0.72); font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; color: #f3f3f6; }
  .card { width: min(440px, 100%); background: #0a0a0c; border: 1px solid rgba(255, 255, 255, 0.12); border-radius: 14px; padding: 22px; box-shadow: 0 24px 80px rgba(0, 0, 0, 0.6); display: flex; flex-direction: column; gap: 12px; }
  .card.stop { border-color: rgba(255, 77, 77, 0.55); }
  .eyebrow { font-size: 11px; font-weight: 600; letter-spacing: 0.12em; text-transform: uppercase; color: #2bff88; }
  .card.stop .eyebrow { color: #ff4d4d; }
  .title { font-size: 20px; font-weight: 600; letter-spacing: -0.02em; line-height: 1.2; margin: 0; }
  .summary { font-size: 14px; line-height: 1.5; margin: 0; }
  .list { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 6px; }
  .list li { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12px; color: #9a9aa6; word-break: break-all; }
  .list b { color: #f3f3f6; font-weight: 500; }
  .actions { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 6px; }
  button { font: 600 13px/1.3 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; padding: 9px 14px; border-radius: 8px; border: 1px solid rgba(255, 255, 255, 0.14); background: rgba(255, 255, 255, 0.04); color: #f3f3f6; cursor: pointer; }
  button.primary { background: #2bff88; border-color: #2bff88; color: #0b0b0f; }
  button.danger { color: #ff4d4d; border-color: rgba(255, 77, 77, 0.5); }
  button:focus-visible { outline: 2px solid #2bff88; outline-offset: 2px; }
  .foot { font-size: 11px; color: #9a9aa6; margin: 0; }
`;

const ROLE_WORDS: Record<string, string> = { recipient: "receives", spender: "may spend", contract: "is called", party: "is in the signature" };

/** Puts the warning on the page and resolves with what the person chose. Escape means stop. */
function showWarning(verdict: GuardVerdict): Promise<"proceed" | "stop"> {
  return new Promise((resolve) => {
    const host = document.createElement("div");
    host.setAttribute("data-payhole", "guard");
    const root = host.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = STYLE;
    const backdrop = document.createElement("div");
    backdrop.className = "backdrop";
    const card = document.createElement("div");
    card.className = `card ${verdict.level}`;
    const eyebrow = document.createElement("div");
    eyebrow.className = "eyebrow";
    eyebrow.textContent = verdict.level === "stop" ? "PayHole stopped this" : "PayHole, heads up";
    const title = document.createElement("h1");
    title.className = "title";
    title.textContent = verdict.level === "stop" ? "This would send funds to a known scam." : "Unlimited approval.";
    const summary = document.createElement("p");
    summary.className = "summary";
    summary.textContent = verdict.summary;
    card.append(eyebrow, title, summary);
    if (verdict.flagged.length > 0) {
      const list = document.createElement("ul");
      list.className = "list";
      for (const flag of verdict.flagged.slice(0, 4)) {
        const item = document.createElement("li");
        const address = document.createElement("b");
        address.textContent = flag.address;
        item.append(address, document.createTextNode(` ${ROLE_WORDS[flag.role] ?? flag.role}${flag.label ? `, ${flag.label}` : ""}`));
        list.append(item);
      }
      card.append(list);
    }
    const actions = document.createElement("div");
    actions.className = "actions";
    const stop = document.createElement("button");
    stop.type = "button";
    stop.className = "primary";
    stop.textContent = "Stop";
    const go = document.createElement("button");
    go.type = "button";
    go.className = verdict.level === "stop" ? "danger" : "";
    go.textContent = verdict.level === "stop" ? "Continue anyway" : "Continue";
    actions.append(stop, go);
    const foot = document.createElement("p");
    foot.className = "foot";
    foot.textContent = verdict.level === "stop" ? "Stop rejects the request; the wallet never sees it." : "Not on any list. An unlimited approval is normal on some sites and a trap on others.";
    card.append(actions, foot);
    backdrop.append(card);
    root.append(style, backdrop);
    const finish = (choice: "proceed" | "stop"): void => {
      window.removeEventListener("keydown", onKey, true);
      host.remove();
      resolve(choice);
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        event.stopPropagation();
        finish("stop");
      }
    };
    stop.addEventListener("click", () => finish("stop"));
    go.addEventListener("click", () => finish("proceed"));
    window.addEventListener("keydown", onKey, true);
    (document.body ?? document.documentElement).append(host);
    stop.focus();
  });
}
