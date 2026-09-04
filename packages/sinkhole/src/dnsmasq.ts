import { spawn, type ChildProcess } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { dnsmasqArgs, renderBlocklistConfig, renderDnsmasqConfig, type DnsmasqSettings } from "./render/dnsmasq.js";
import { writeFileAtomic } from "./store.js";

export interface DnsmasqSupervisorOptions {
  binary: string;
  confDir: string;
  settings: Omit<DnsmasqSettings, "blocklistFile">;
  log?: (line: string) => void;
  /** First delay before respawning after an unexpected exit; doubles up to 30 s. */
  respawnDelayMs?: number;
  /** How long a SIGTERM gets before SIGKILL. */
  stopTimeoutMs?: number;
}

export interface DnsmasqStatus {
  running: boolean;
  pid: number | null;
  restarts: number;
  unexpectedExits: number;
  lastReloadAt: number | null;
  lastExit: { code: number | null; signal: string | null; at: number } | null;
}

/**
 * Runs dnsmasq as a child of the agent and keeps it running. dnsmasq only reads `address=` rules at
 * startup (SIGHUP re-reads hosts files, not its configuration), so a changed blocklist is applied with
 * a quick graceful restart. Nothing here ever enables query logging.
 */
export class DnsmasqSupervisor {
  readonly configFile: string;
  readonly blocklistFile: string;
  private child: ChildProcess | null = null;
  private lastBlocklist: string | null = null;
  private stopping = false;
  private queue: Promise<unknown> = Promise.resolve();
  private respawnTimer: NodeJS.Timeout | null = null;
  private backoff: number;
  private readonly initialBackoff: number;
  private readonly stopTimeoutMs: number;
  private restarts = 0;
  private unexpectedExits = 0;
  private lastReloadAt: number | null = null;
  private lastExit: DnsmasqStatus["lastExit"] = null;

  constructor(private readonly options: DnsmasqSupervisorOptions) {
    this.configFile = join(options.confDir, "sinkhole.conf");
    this.blocklistFile = join(options.confDir, "blocklist.conf");
    this.initialBackoff = options.respawnDelayMs ?? 1000;
    this.backoff = this.initialBackoff;
    this.stopTimeoutMs = options.stopTimeoutMs ?? 5000;
  }

  get running(): boolean {
    const child = this.child;
    return child?.pid !== undefined && child.exitCode === null && child.signalCode === null;
  }

  status(): DnsmasqStatus {
    return {
      running: this.running,
      pid: this.child?.pid ?? null,
      restarts: this.restarts,
      unexpectedExits: this.unexpectedExits,
      lastReloadAt: this.lastReloadAt,
      lastExit: this.lastExit,
    };
  }

  /** Renders both files and starts dnsmasq. */
  start(domains: Iterable<string>): Promise<void> {
    return this.enqueue(async () => {
      await mkdir(this.options.confDir, { recursive: true });
      await writeFileAtomic(this.configFile, renderDnsmasqConfig({ ...this.options.settings, blocklistFile: this.blocklistFile }));
      this.lastBlocklist = renderBlocklistConfig(domains);
      await writeFileAtomic(this.blocklistFile, this.lastBlocklist);
      this.spawnChild();
    });
  }

  /** Re-renders the blocklist; when it differs from the running one, restarts dnsmasq to load it. */
  apply(domains: Iterable<string>): Promise<boolean> {
    return this.enqueue(async () => {
      const rendered = renderBlocklistConfig(domains);
      if (rendered === this.lastBlocklist) return false;
      await writeFileAtomic(this.blocklistFile, rendered);
      this.lastBlocklist = rendered;
      if (this.stopping) return true;
      await this.killChild();
      this.restarts += 1;
      this.spawnChild();
      this.lastReloadAt = Date.now();
      return true;
    });
  }

  stop(): Promise<void> {
    return this.enqueue(async () => {
      this.stopping = true;
      if (this.respawnTimer) {
        clearTimeout(this.respawnTimer);
        this.respawnTimer = null;
      }
      await this.killChild();
    });
  }

  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.queue.then(fn, fn);
    this.queue = next.catch(() => undefined);
    return next;
  }

  private log(line: string): void {
    this.options.log?.(line);
  }

  private spawnChild(): void {
    const child = spawn(this.options.binary, dnsmasqArgs(this.configFile), { stdio: ["ignore", "inherit", "inherit"] });
    this.child = child;
    let settled = false;
    const gone = (code: number | null, signal: NodeJS.Signals | null, why: string): void => {
      if (settled) return;
      settled = true;
      this.lastExit = { code, signal, at: Date.now() };
      if (this.child !== child) return;
      this.child = null;
      if (this.stopping) return;
      this.unexpectedExits += 1;
      this.log(`dnsmasq ${why}; respawning in ${this.backoff} ms`);
      this.respawnTimer = setTimeout(() => {
        this.respawnTimer = null;
        if (!this.stopping) this.spawnChild();
      }, this.backoff);
      this.backoff = Math.min(this.backoff * 2, 30_000);
    };
    child.on("error", (error) => gone(null, null, `failed to start: ${error.message}`));
    child.on("exit", (code, signal) => gone(code, signal, `exited (code ${String(code)}, signal ${String(signal)})`));
    child.on("spawn", () => {
      this.log(`dnsmasq started (pid ${String(child.pid)})`);
      setTimeout(() => {
        if (this.child === child && this.running) this.backoff = this.initialBackoff;
      }, 10_000).unref();
    });
  }

  private killChild(): Promise<void> {
    const child = this.child;
    this.child = null;
    if (child === null) return Promise.resolve();
    if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
    return new Promise((resolve) => {
      const timer = setTimeout(() => child.kill("SIGKILL"), this.stopTimeoutMs);
      child.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
      if (!child.kill("SIGTERM")) {
        clearTimeout(timer);
        resolve();
      }
    });
  }
}
