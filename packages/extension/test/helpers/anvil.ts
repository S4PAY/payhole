import { spawn, type ChildProcess } from "node:child_process";

export interface AnvilHandle {
  rpcUrl: string;
  stop(): Promise<void>;
}

/** Starts a throwaway anvil with Robinhood Chain's id and waits until it answers. */
export async function startAnvil(port: number, chainId = 4663): Promise<AnvilHandle> {
  const child: ChildProcess = spawn("anvil", ["--port", String(port), "--chain-id", String(chainId), "--silent"], { stdio: "ignore" });
  const rpcUrl = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 100; i++) {
    try {
      const res = await fetch(rpcUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }),
      });
      if (res.ok) break;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  return {
    rpcUrl,
    stop: () =>
      new Promise<void>((resolve) => {
        child.once("exit", () => resolve());
        child.kill();
      }),
  };
}
