import { spawn, type ChildProcess } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { dnsmasqArgs, renderBlocklistConfig, renderDnsmasqConfig, renderHostsFile, type DnsmasqSettings } from "./render/dnsmasq.js";
import { writeFileAtomic } from "./store.js";

export interface DnsmasqSupervisorOptions {
  binary: string;
  confDir: string;
  settings: Omit<DnsmasqSettings, "blocklistFile" | "hostsFile">;
  log?: (line: string) => void;
  /**
   * Receives every line dnsmasq prints (query log and messages). When set, dnsmasq's output is piped
   * through the agent instead of inherited, so the caller decides what to keep.
   */
  onLine?: (line: string) => void;
  /** First delay before respawning after an unexpected exit; doubles up to 30 s. */
  respawnDelayMs?: number;
  /** How long a SIGTERM gets before SIGKILL. */
  stopTimeoutMs?: number;
}

/** The two sets dnsmasq blocks: curated names as `address=` zones, subscribed lists as exact hosts entries. */
export interface BlockSets {
  curated: Iterable<string>;
  hosts?: Iterable<string> | undefined;
}

export type ApplyResult = "unchanged" | "reloaded" | "restarted";

export interface DnsmasqStatus {
  running: boolean;
  pid: number | null;
  restarts: number;
  /** Hosts-file reloads by SIGHUP, which do not interrupt the resolver. */
  reloads: number;
  unexpectedExits: number;
  lastReloadAt: number | null;
  lastExit: { code: number | null; signal: string | null; at: number } | null;
}

/**
 * Runs dnsmasq as a child of the agent and keeps it running. `address=` rules are only read at startup, so a
 * change to the curated set is applied with a quick graceful restart; the hosts file for subscribed lists is
 * re-read on SIGHUP, so list refreshes never interrupt the resolver.
 */
export class DnsmasqSupervisor {
  readonly configFile: string;
  readonly blocklistFile: string;
  readonly hostsFile: string;
  private child: ChildProcess | null = null;
  private lastBlocklist: string | null = null;
  private lastHosts: string | null = null;
  private stopping = false;
  private queue: Promise<unknown> = Promise.resolve();
  private respawnTimer: NodeJS.Timeout | null = null;
  private backoff: number;
  private readonly initialBackoff: number;
  private readonly stopTimeoutMs: number;
  private restarts = 0;
  private reloads = 0;
  private unexpectedExits = 0;
  private lastReloadAt: number | null = null;
  private lastExit: DnsmasqStatus["lastExit"] = null;

  constructor(private readonly options: DnsmasqSupervisorOptions) {
    this.configFile = join(options.confDir, "sinkhole.conf");
    this.blocklistFile = join(options.confDir, "blocklist.conf");
    this.hostsFile = join(options.confDir, "blocked.hosts");
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
      reloads: this.reloads,
      unexpectedExits: this.unexpectedExits,
      lastReloadAt: this.lastReloadAt,
      lastExit: this.lastExit,
    };
  }

  /** Renders the configuration and both block files, then starts dnsmasq. */
  start(sets: BlockSets): Promise<void> {
    return this.enqueue(async () => {
      await mkdir(this.options.confDir, { recursive: true });
      await writeFileAtomic(this.configFile, renderDnsmasqConfig({ ...this.options.settings, blocklistFile: this.blocklistFile, hostsFile: this.hostsFile }));
      this.lastBlocklist = renderBlocklistConfig(sets.curated);
      await writeFileAtomic(this.blocklistFile, this.lastBlocklist);
      this.lastHosts = renderHostsFile(sets.hosts ?? []);
      await writeFileAtomic(this.hostsFile, this.lastHosts);
      this.spawnChild();
    });
  }

  /**
   * Re-renders both files. A changed curated set restarts dnsmasq; a changed hosts file alone is reloaded
   * with SIGHUP; nothing happens when neither differs from what is running.
   */
  apply(sets: BlockSets): Promise<ApplyResult> {
    return this.enqueue(async () => {
      const blocklist = renderBlocklistConfig(sets.curated);
      const hosts = renderHostsFile(sets.hosts ?? []);
      const blocklistChanged = blocklist !== this.lastBlocklist;
      const hostsChanged = hosts !== this.lastHosts;
      if (!blocklistChanged && !hostsChanged) return "unchanged";
      if (blocklistChanged) {
        await writeFileAtomic(this.blocklistFile, blocklist);
        this.lastBlocklist = blocklist;
      }
      if (hostsChanged) {
        await writeFileAtomic(this.hostsFile, hosts);
        this.lastHosts = hosts;
      }
      if (this.stopping) return blocklistChanged ? "restarted" : "reloaded";
      if (blocklistChanged) {
        await this.killChild();
        this.restarts += 1;
        this.spawnChild();
        this.lastReloadAt = Date.now();
        return "restarted";
      }
      if (this.child && this.running) this.child.kill("SIGHUP");
      this.reloads += 1;
      this.lastReloadAt = Date.now();
      return "reloaded";
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
    const onLine = this.options.onLine;
    const child = spawn(this.options.binary, dnsmasqArgs(this.configFile), { stdio: ["ignore", onLine ? "pipe" : "inherit", onLine ? "pipe" : "inherit"] });
    this.child = child;
    if (onLine) {
      for (const stream of [child.stdout, child.stderr]) {
        if (!stream) continue;
        createInterface({ input: stream, crlfDelay: Infinity }).on("line", (line) => onLine(line));
      }
    }
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
