import { defineContentScript } from "wxt/utils/define-content-script";

/**
 * Runs in the page's own world, before its scripts, and wraps every wallet the page can reach: `window.ethereum`,
 * wallets that arrive later, and every one announced through EIP-6963. A guarded request is described to the
 * bridge script, which asks the background and, when something is known about an address in it, shows the
 * warning. A "stop" rejects the request the way a wallet does when a person declines (code 4001). No answer at all
 * within a few seconds means the extension is not there to ask; the wallet decides alone, as if the guard did not
 * exist.
 */
export default defineContentScript({
  matches: ["http://*/*", "https://*/*"],
  runAt: "document_start",
  allFrames: true,
  world: "MAIN",
  main() {
    const GUARDED = new Set(["eth_sendTransaction", "eth_signTypedData", "eth_signTypedData_v3", "eth_signTypedData_v4", "wallet_sendCalls"]);
    const MARK = "__payholeGuarded";
    const pending = new Map<string, { settle: (decision: string) => void; asking: boolean }>();
    let seq = 0;

    window.addEventListener("message", (event) => {
      if (event.source !== window) return;
      const data = event.data as { source?: unknown; id?: unknown; decision?: unknown } | null;
      if (data?.source !== "payhole-guard-bridge" || typeof data.id !== "string" || typeof data.decision !== "string") return;
      const entry = pending.get(data.id);
      if (!entry) return;
      if (data.decision === "asking") {
        entry.asking = true;
        return;
      }
      pending.delete(data.id);
      entry.settle(data.decision);
    });

    function ask(method: string, params: unknown): Promise<string> {
      return new Promise((resolve) => {
        const id = `${Date.now().toString(36)}-${(seq += 1).toString(36)}`;
        const entry = { settle: resolve, asking: false };
        pending.set(id, entry);
        setTimeout(() => {
          if (pending.get(id) === entry && !entry.asking) {
            pending.delete(id);
            resolve("proceed");
          }
        }, 3000);
        try {
          window.postMessage({ source: "payhole-guard-page", id, method, params }, "*");
        } catch {
          pending.delete(id);
          resolve("proceed");
        }
      });
    }

    function rejection(): Error {
      const error = new Error("PayHole stopped this request.") as Error & { code: number };
      error.code = 4001;
      return error;
    }

    function wrap(provider: unknown): void {
      if (!provider || typeof provider !== "object") return;
      const target = provider as Record<string, unknown>;
      if (target[MARK] === true || typeof target["request"] !== "function") return;
      const original = (target["request"] as (args: unknown) => Promise<unknown>).bind(provider);
      const wrapped = async (args: unknown): Promise<unknown> => {
        const method = args && typeof args === "object" ? (args as { method?: unknown }).method : undefined;
        if (typeof method === "string" && GUARDED.has(method)) {
          const decision = await ask(method, (args as { params?: unknown }).params);
          if (decision === "stop") throw rejection();
        }
        return original(args);
      };
      try {
        Object.defineProperty(target, "request", { value: wrapped, writable: true, configurable: true });
        Object.defineProperty(target, MARK, { value: true, enumerable: false, configurable: true });
      } catch {
        // a frozen provider stays as it is
      }
      const inner = target["providers"];
      if (Array.isArray(inner)) for (const candidate of inner) wrap(candidate);
    }

    const win = window as unknown as Record<string, unknown>;
    wrap(win["ethereum"]);
    window.addEventListener("eip6963:announceProvider", (event) => {
      const detail = (event as CustomEvent<{ provider?: unknown }>).detail;
      wrap(detail?.provider);
    });
    try {
      window.dispatchEvent(new Event("eip6963:requestProvider"));
    } catch {
      // nothing to announce yet
    }
    // Wallets inject on their own schedule; look again for a while.
    let ticks = 0;
    const timer = setInterval(() => {
      wrap(win["ethereum"]);
      if ((ticks += 1) >= 40) clearInterval(timer);
    }, 250);
  },
});
