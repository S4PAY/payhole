import { mkdir, readFile } from "node:fs/promises";
import type { Server } from "node:http";
import { createRequire } from "node:module";
import { isIP } from "node:net";
import { hostname } from "node:os";
import { join } from "node:path";
import { getAddress, type Address } from "viem";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { Blocklist, parseExtensionPush, type BlocklistState } from "./blocklist.js";
import { loadConfig, type SinkholeConfig } from "./config.js";
import { DnsForwarder } from "./dnsForwarder.js";
import { DnsmasqSupervisor } from "./dnsmasq.js";
import { createDohServer, DotServer, type EncryptedDnsCounters } from "./encryptedDns.js";
import { QueryStats, type QueryStatsState } from "./queryLog.js";
import { RateLimiter } from "./rateLimit.js";
import { createAdminServer } from "./server.js";
import { debounce, readJson, writeJsonAtomic } from "./store.js";
import { Subscriptions } from "./subscriptions.js";
import { parseAllowlistText } from "./allowlist.js";
import { Directory, type DirectoryEntry } from "./swarm/directory.js";
import { cachedTierReader, createTierReader, type TierReader } from "./swarm/membership.js";
import {
  membershipText,
  parseProof,
  signProof,
  signSwarmMessage,
  verifyProof,
  verifySwarmMessage,
  type MembershipProof,
} from "./swarm/messages.js";
import { loadOrCreatePeerKey, peerIdOf, Swarm } from "./swarm/node.js";
import { probeEndpoint } from "./swarm/probe.js";

interface PersistedState {
  blocklist?: BlocklistState;
  directory?: DirectoryEntry[];
}

interface Identity {
  /** Present when the operator key is on this node; without it the node cannot sign announcements. */
  account: PrivateKeyAccount | null;
  address: Address;
  proof: MembershipProof;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const VERSION = (createRequire(import.meta.url)("../package.json") as { version?: string }).version ?? "0.0.0";

function log(line: string): void {
  console.log(`${new Date().toISOString()} ${line}`);
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function peerKeyPath(config: SinkholeConfig): string {
  return join(config.dataDir, "peer.key");
}

async function resolveIdentity(config: SinkholeConfig, peerId: string): Promise<Identity | null> {
  const { operatorKey, operatorAddress, proofJson } = config.membership;
  const account = operatorKey ? privateKeyToAccount(operatorKey) : null;
  if (account && operatorAddress && getAddress(operatorAddress) !== getAddress(account.address)) {
    throw new Error("NODE_OPERATOR_ADDRESS does not match NODE_OPERATOR_KEY");
  }
  if (proofJson) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(proofJson);
    } catch {
      throw new Error("NODE_PROOF_JSON is not JSON");
    }
    const proof = parseProof(parsed);
    if (!proof) throw new Error("NODE_PROOF_JSON is not a membership proof ({peerId, address, issuedAt, signature})");
    if (proof.peerId !== peerId) throw new Error(`NODE_PROOF_JSON is for peer ${proof.peerId} but this node is ${peerId}; run peer-id and sign again`);
    const expected = account?.address ?? operatorAddress;
    if (expected && getAddress(expected) !== getAddress(proof.address)) throw new Error("NODE_PROOF_JSON address does not match the operator address");
    const check = await verifyProof(proof, peerId);
    if (!check.ok) throw new Error(`NODE_PROOF_JSON is invalid: ${check.detail}`);
    return { account, address: getAddress(proof.address), proof };
  }
  if (account) return { account, address: account.address, proof: await signProof(account, peerId) };
  return null;
}

async function loadManualFile(blocklist: Blocklist, path: string): Promise<void> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      log(`manual blocklist ${path} does not exist yet`);
      return;
    }
    throw error;
  }
  let added = 0;
  let invalid = 0;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    if (line.length === 0) continue;
    const parts = line.split(/\s+/);
    const host = parts.length > 1 && parts[0] !== undefined && isIP(parts[0]) !== 0 ? parts[1] : parts[0];
    const result = host === undefined ? null : blocklist.addManual(host, "manual file");
    if (!result) invalid += 1;
    else if (result.added) added += 1;
  }
  log(`manual blocklist ${path}: ${added} entries added, ${invalid} invalid lines skipped`);
}

function listen(server: Server, port: number, host: string): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      resolve();
    });
  });
}

async function loadAllowFile(path: string): Promise<Set<string>> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      log(`manual allowlist ${path} does not exist yet`);
      return new Set();
    }
    throw error;
  }
  const { domains, invalid } = parseAllowlistText(text);
  log(`manual allowlist ${path}: ${domains.size} rules, ${invalid} invalid lines skipped`);
  return domains;
}

async function run(config: SinkholeConfig): Promise<void> {
  const token = config.admin.token;
  if (!token) throw new Error("ADMIN_TOKEN is required");
  const startedAt = Date.now();
  await mkdir(config.dataDir, { recursive: true });
  const statePath = join(config.dataDir, "state.json");
  const persisted = (await readJson<PersistedState>(statePath)) ?? {};

  const blocklist = new Blocklist({ threshold: config.flags.threshold, ttlMs: config.flags.ttlDays * 24 * 60 * MINUTE }, persisted.blocklist ?? null);
  if (config.manualFile) await loadManualFile(blocklist, config.manualFile);

  const subscriptions = await Subscriptions.load({ dir: join(config.dataDir, "lists"), refreshMs: config.lists.refreshHours * HOUR, log }, config.lists.urls);
  blocklist.setLists(subscriptions.domains());
  subscriptions.onChange(() => blocklist.setLists(subscriptions.domains()));
  if (subscriptions.size > 0) log(`${subscriptions.size} list subscriptions, ${subscriptions.domains().size} domains cached from earlier fetches`);

  const allowlists = await Subscriptions.load(
    { dir: join(config.dataDir, "allow"), refreshMs: config.lists.refreshHours * HOUR, log, parse: parseAllowlistText, label: "ALLOWLIST_URLS" },
    config.allow.urls,
  );
  const manualAllow = config.allow.file ? await loadAllowFile(config.allow.file) : new Set<string>();
  const applyAllowlist = (): void => blocklist.setAllowlist(new Set([...allowlists.domains(), ...manualAllow]));
  applyAllowlist();
  allowlists.onChange(applyAllowlist);
  log(`allowlist: ${blocklist.allowlistSize()} rules from ${allowlists.size} fetched list${allowlists.size === 1 ? "" : "s"}${manualAllow.size > 0 ? " and the manual file" : ""}`);

  const statsPath = join(config.dataDir, "stats.json");
  let stats: QueryStats | null = null;
  if (config.queryLog.enabled) {
    let saved: QueryStatsState | null = null;
    try {
      saved = await readJson<QueryStatsState>(statsPath);
    } catch (error) {
      log(`ignoring unreadable ${statsPath}: ${errorText(error)}`);
    }
    stats = new QueryStats({}, saved);
  }
  const persistStats = async (): Promise<void> => {
    if (!stats?.changed) return;
    try {
      await writeJsonAtomic(statsPath, stats.toJSON());
    } catch (error) {
      log(`failed to persist statistics: ${errorText(error)}`);
    }
  };

  const directory = new Directory(
    { probe: (entry) => probeEndpoint(entry, { allowPrivate: config.probe.allowPrivate }), limiter: new RateLimiter(6, 60 * MINUTE) },
    persisted.directory ?? null,
  );

  const persist = debounce(async () => {
    try {
      await writeJsonAtomic(statePath, { blocklist: blocklist.toJSON(), directory: directory.toJSON() } satisfies PersistedState);
    } catch (error) {
      log(`failed to persist state: ${errorText(error)}`);
    }
  }, 1000);

  const statsRef = stats;
  const dnsmasq = new DnsmasqSupervisor({
    binary: config.dns.binary,
    confDir: join(config.dataDir, "dnsmasq"),
    settings: { listen: config.dns.listen, port: config.dns.port, upstream: config.dns.upstream, cacheSize: config.dns.cacheSize, user: config.dns.user, logQueries: config.queryLog.enabled },
    log,
    ...(statsRef
      ? {
          onLine: (line: string) => {
            if (!statsRef.ingest(line)) log(line);
          },
        }
      : {}),
  });
  const blockSets = (): { curated: Set<string>; hosts: ReadonlySet<string> } => ({ curated: blocklist.curated(), hosts: blocklist.listDomains() });
  const applyDns = debounce(async () => {
    try {
      const sets = blockSets();
      const result = await dnsmasq.apply(sets);
      if (result !== "unchanged") log(`blocklist ${result}: ${sets.curated.size} curated domains, ${sets.hosts.size} from lists`);
    } catch (error) {
      log(`failed to apply blocklist: ${errorText(error)}`);
    }
  }, 500);
  blocklist.onChange(() => {
    applyDns.trigger();
    persist.trigger();
  });
  directory.onChange(() => persist.trigger());
  await dnsmasq.start(blockSets());
  log(`dnsmasq listening on ${config.dns.listen}:${config.dns.port}, upstream ${config.dns.upstream.join(", ")}, ${blocklist.domains().size} domains blocked, query log ${config.queryLog.enabled ? "on" : "off"}`);

  let doh: (Server & { counters: EncryptedDnsCounters }) | null = null;
  let dot: DotServer | null = null;
  if (config.doh.enabled || config.dot.enabled) {
    const forwarder = new DnsForwarder({ host: config.dns.listen === "0.0.0.0" ? "127.0.0.1" : config.dns.listen === "::" ? "::1" : config.dns.listen, port: config.dns.port });
    const shared = {
      forwarder,
      limiter: new RateLimiter(config.dnsRateLimitPerMinute, MINUTE),
      log,
      onQuery: (transport: string) => statsRef?.countTransport(transport),
    };
    if (config.doh.enabled) {
      doh = createDohServer(shared);
      await listen(doh, config.doh.port, config.doh.listen);
      log(`dns over https on http://${config.doh.listen}:${config.doh.port}/dns-query, forwarding to ${forwarder.target}`);
    }
    if (config.dot.enabled && config.dot.certFile && config.dot.keyFile) {
      dot = new DotServer({ ...shared, certFile: config.dot.certFile, keyFile: config.dot.keyFile });
      await dot.listen(config.dot.port, config.dot.listen);
      log(`dns over tls on ${config.dot.listen}:${config.dot.port} with ${dot.certificate?.subject ?? "a certificate"}, valid to ${dot.certificate?.validTo ?? "?"}`);
    }
  }

  let swarm: Swarm | null = null;
  let identity: Identity | null = null;
  if (config.swarm.enabled) {
    const key = await loadOrCreatePeerKey(peerKeyPath(config));
    const peerId = peerIdOf(key);
    identity = await resolveIdentity(config, peerId);
    const { minTier, vault } = config.membership;
    let tierOf: TierReader = () => Promise.resolve(0);
    if (minTier > 0) {
      if (!vault) throw new Error("BURN_VAULT_ADDRESS is required when MIN_TIER > 0 (MIN_TIER=0 runs an open swarm, SWARM_ENABLED=0 disables it)");
      tierOf = cachedTierReader(createTierReader({ rpcUrl: config.membership.rpcUrl, chainId: config.membership.chainId, vault }), { ttlMs: 60 * MINUTE });
    }
    swarm = await Swarm.start({
      privateKey: key,
      listen: config.swarm.listen,
      bootstrap: config.swarm.bootstrap,
      mdns: config.swarm.mdns,
      verify: (raw, sender) => verifySwarmMessage(raw, sender, { tierOf, minTier }),
      onFlag: (message) => {
        const result = blocklist.recordFlag(message.body.domain, message.reporter, message.body.reason, message.body.ts);
        if (result?.changed) log(`swarm confirmed ${result.domain} (${result.reporters} reporters)`);
      },
      onEndpoint: async (message) => {
        const result = await directory.handleAnnouncement(message.body, message.reporter);
        if (!result.ok) log(`directory rejected ${message.body.url}: ${result.reason} (${result.detail})`);
        return result.ok;
      },
      log,
    });
    log(`swarm peer ${peerId} listening on ${swarm.multiaddrs().join(", ") || "(no addresses yet)"}`);
    if (identity) {
      log(`operator ${identity.address}${identity.account ? "" : " (proof only; this node will not publish)"}`);
      if (minTier > 0) {
        tierOf(identity.address).then(
          (tier) => {
            if (tier < minTier) log(`warning: operator tier ${tier} is below MIN_TIER ${minTier}; peers will drop this node's announcements`);
          },
          (error: unknown) => log(`warning: could not read the operator tier: ${errorText(error)}`),
        );
      }
    } else {
      log("no operator identity configured (NODE_OPERATOR_KEY or NODE_PROOF_JSON); the node receives but does not publish");
    }
  } else {
    log("swarm disabled");
  }

  const publishFlags = async (entries: { domain: string; reason: string }[]): Promise<void> => {
    if (!swarm || !identity?.account) return;
    let sent = 0;
    for (const entry of entries) {
      try {
        const message = await signSwarmMessage(identity.account, identity.proof, { type: "flag", domain: entry.domain, reason: entry.reason, ts: Date.now() });
        await swarm.publish(message);
        sent += 1;
      } catch (error) {
        log(`failed to announce ${entry.domain}: ${errorText(error)}`);
      }
    }
    if (sent > 0) log(`announced ${sent} flags to ${swarm.peers().length} peers`);
  };

  const announceOwnFlags = (): Promise<void> =>
    publishFlags([...blocklist.localEntries(), ...blocklist.manualEntries()].map((entry) => ({ domain: entry.domain, reason: entry.reason })));

  const republishDirectory = async (): Promise<void> => {
    if (!swarm || !identity?.account) return;
    for (const entry of directory.dueForPublish()) {
      if (!(await directory.reverify(entry.url))) continue;
      try {
        const message = await signSwarmMessage(identity.account, identity.proof, {
          type: "endpoint",
          url: entry.url,
          network: entry.network,
          asset: entry.asset,
          payTo: entry.payTo,
          ts: Date.now(),
        });
        await swarm.publish(message);
        directory.markPublished(entry.url);
      } catch (error) {
        log(`failed to announce endpoint ${entry.url}: ${errorText(error)}`);
      }
    }
  };

  const pullExtension = async (url: string): Promise<void> => {
    try {
      const res = await fetch(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(15_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const parsed = parseExtensionPush(await res.json());
      if (!parsed.ok) throw new Error(parsed.error);
      const { added, removed } = blocklist.setLocal(parsed.push);
      log(`pulled extension blocklist: ${parsed.push.entries.length} entries (${added.length} new, ${removed.length} gone, ${parsed.rejected.length} rejected)`);
      await publishFlags(added.map((e) => ({ domain: e.domain, reason: e.reason })));
    } catch (error) {
      log(`extension pull from ${url} failed: ${errorText(error)}`);
    }
  };

  const server = createAdminServer({
    token,
    blocklist,
    health: () => ({ ok: dnsmasq.running, dnsmasq: dnsmasq.running, peers: swarm?.peers().length ?? 0 }),
    status: () => ({
      peerId: swarm?.peerId ?? null,
      listenAddrs: swarm?.multiaddrs() ?? [],
      connectedPeers: swarm?.peers() ?? [],
      identity: identity ? { address: identity.address, publishing: identity.account !== null } : null,
      counts: { ...blocklist.counts(), ...(stats ? { queries24h: stats.snapshot().summary.queries24h, blocked24h: stats.snapshot().summary.blocked24h } : {}) },
      queryLog: { enabled: config.queryLog.enabled },
      lists: subscriptions.size,
      allowlist: { rules: blocklist.allowlistSize(), sources: allowlists.size + (manualAllow.size > 0 ? 1 : 0) },
      flagThreshold: blocklist.threshold,
      flagTtlDays: config.flags.ttlDays,
      directory: directory.size,
      lastSync: { extension: blocklist.localMeta(), swarm: swarm?.lastMessageAt ?? null },
      swarm: swarm ? { received: swarm.received, accepted: swarm.accepted, dropped: swarm.dropped } : null,
      dnsmasq: dnsmasq.status(),
      encryptedDns: {
        doh: doh ? { listen: config.doh.listen, port: config.doh.port, ...doh.counters } : null,
        dot: dot ? { listen: config.dot.listen, port: config.dot.port, certificate: dot.certificate, ...dot.counters } : null,
        rateLimitPerMinute: config.dnsRateLimitPerMinute,
      },
      uptimeSeconds: (Date.now() - startedAt) / 1000,
      node: { hostname: hostname(), version: VERSION, startedAt },
      config: {
        dns: { listen: config.dns.listen, port: config.dns.port, upstream: config.dns.upstream, cacheSize: config.dns.cacheSize },
        admin: { listen: config.admin.listen, port: config.admin.port },
        swarm: { enabled: config.swarm.enabled, listen: config.swarm.listen, bootstrap: config.swarm.bootstrap, mdns: config.swarm.mdns },
        membership: { minTier: config.membership.minTier, vault: config.membership.vault ?? null },
        extension: { url: config.extension.url ?? null, pullMinutes: config.extension.pullMinutes },
        flags: { threshold: config.flags.threshold, ttlDays: config.flags.ttlDays, reannounceMinutes: config.flags.reannounceMinutes },
        queryLog: { enabled: config.queryLog.enabled },
        lists: { refreshHours: config.lists.refreshHours },
        allow: { urls: config.allow.urls, file: config.allow.file ?? null },
        encryptedDns: {
          doh: { enabled: config.doh.enabled, listen: config.doh.listen, port: config.doh.port },
          dot: { enabled: config.dot.enabled, listen: config.dot.listen, port: config.dot.port },
          rateLimitPerMinute: config.dnsRateLimitPerMinute,
        },
      },
    }),
    ...(stats ? { stats: { snapshot: () => stats.snapshot(), queries: (filter) => stats.queries(filter) } } : {}),
    subscriptions: {
      list: () => subscriptions.list(),
      get: (id) => subscriptions.get(id),
      add: (url) => subscriptions.add(url),
      remove: (id) => subscriptions.remove(id),
      refresh: (id) => subscriptions.refresh(id),
    },
    directory: {
      list: () => directory.list(),
      add: async (input) => {
        const result = await directory.addLocal(input, identity?.address ?? "0x0000000000000000000000000000000000000000");
        if (result.ok && result.probed && swarm && identity?.account) {
          const message = await signSwarmMessage(identity.account, identity.proof, {
            type: "endpoint",
            url: result.entry.url,
            network: result.entry.network,
            asset: result.entry.asset,
            payTo: result.entry.payTo,
            ts: Date.now(),
          });
          await swarm.publish(message);
          directory.markPublished(result.entry.url);
        }
        return result;
      },
    },
    publish: (entries) => void publishFlags(entries),
  });
  await listen(server, config.admin.port, config.admin.listen);
  log(`admin API on http://${config.admin.listen}:${config.admin.port}`);

  const timers: NodeJS.Timeout[] = [
    setInterval(() => {
      blocklist.prune();
      directory.prune();
    }, MINUTE),
    setInterval(() => void subscriptions.refreshDue(), 5 * MINUTE),
    setInterval(() => void allowlists.refreshDue(), 5 * MINUTE),
  ];
  void subscriptions.refreshDue();
  void allowlists.refreshDue();
  if (stats) {
    const live = stats;
    timers.push(setInterval(() => live.sweep(), 5_000));
    timers.push(setInterval(() => void persistStats(), MINUTE));
  }
  if (swarm) {
    timers.push(setTimeout(() => void announceOwnFlags(), MINUTE));
    timers.push(setInterval(() => void announceOwnFlags(), config.flags.reannounceMinutes * MINUTE));
    timers.push(setInterval(() => void republishDirectory(), 5 * MINUTE));
  }
  if (config.extension.url) {
    const url = config.extension.url;
    void pullExtension(url);
    timers.push(setInterval(() => void pullExtension(url), config.extension.pullMinutes * MINUTE));
  }

  let shuttingDown = false;
  const shutdown = (signal: string): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    log(`${signal} received, shutting down`);
    for (const timer of timers) clearTimeout(timer);
    void (async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      if (doh) await new Promise<void>((resolve) => doh?.close(() => resolve()));
      if (dot) await dot.close();
      if (swarm) await swarm.stop().catch((error: unknown) => log(`swarm stop failed: ${errorText(error)}`));
      await dnsmasq.stop();
      await persist.flush();
      await persistStats();
      process.exit(0);
    })();
  };
  for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => shutdown(signal));
}

async function peerIdCommand(config: SinkholeConfig): Promise<void> {
  const key = await loadOrCreatePeerKey(peerKeyPath(config));
  const peerId = peerIdOf(key);
  const address = config.membership.operatorAddress ?? "<NODE_OPERATOR_ADDRESS>";
  const issuedAt = new Date().toISOString();
  console.log(`PeerId: ${peerId}`);
  console.log(`Key file: ${peerKeyPath(config)}`);
  console.log("");
  console.log("Sign this exact text with the operator wallet (EIP-191 personal_sign):");
  console.log("");
  console.log(membershipText(peerId, address, issuedAt));
  console.log("");
  console.log("Then set NODE_PROOF_JSON to the following, with the signature filled in:");
  console.log(JSON.stringify({ peerId, address, issuedAt, signature: "0x<signature>" }));
}

async function signProofCommand(config: SinkholeConfig): Promise<void> {
  if (!config.membership.operatorKey) throw new Error("NODE_OPERATOR_KEY is required for sign-proof");
  const key = await loadOrCreatePeerKey(peerKeyPath(config));
  const proof = await signProof(privateKeyToAccount(config.membership.operatorKey), peerIdOf(key));
  console.log(JSON.stringify(proof));
}

async function main(): Promise<void> {
  const command = process.argv[2] ?? "run";
  const config = loadConfig();
  switch (command) {
    case "run":
      return run(config);
    case "peer-id":
      return peerIdCommand(config);
    case "sign-proof":
      return signProofCommand(config);
    default:
      console.error("usage: node dist/main.js [run|peer-id|sign-proof]");
      process.exit(2);
  }
}

main().catch((error: unknown) => {
  console.error(errorText(error));
  process.exit(1);
});
