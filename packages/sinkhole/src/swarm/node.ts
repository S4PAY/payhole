import { readFile } from "node:fs/promises";
import { noise } from "@chainsafe/libp2p-noise";
import { yamux } from "@chainsafe/libp2p-yamux";
import { bootstrap } from "@libp2p/bootstrap";
import { multiaddr, type Multiaddr } from "@multiformats/multiaddr";
import { generateKeyPair, privateKeyFromProtobuf, privateKeyToProtobuf } from "@libp2p/crypto/keys";
import { gossipsub, TopicValidatorResult, type GossipSub, type Message } from "@libp2p/gossipsub";
import { identify, type Identify } from "@libp2p/identify";
import type { PeerId, PrivateKey } from "@libp2p/interface";
import { mdns } from "@libp2p/mdns";
import { peerIdFromPrivateKey } from "@libp2p/peer-id";
import { tcp } from "@libp2p/tcp";
import { createLibp2p, type Libp2p } from "libp2p";
import { writeFileAtomic } from "../store.js";
import {
  encodeSwarmMessage,
  TOPIC_DIRECTORY,
  TOPIC_FLAGS,
  type AnySwarmMessage,
  type DropReason,
  type EndpointBody,
  type FlagBody,
  type SwarmMessage,
  type VerifyResult,
} from "./messages.js";

/** Loads the node's Ed25519 key from `path`, generating and saving one (mode 600) on first run. */
export async function loadOrCreatePeerKey(path: string): Promise<PrivateKey> {
  try {
    const bytes = await readFile(path);
    return privateKeyFromProtobuf(new Uint8Array(bytes));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const key = await generateKeyPair("Ed25519");
  await writeFileAtomic(path, privateKeyToProtobuf(key), 0o600);
  return key;
}

export function peerIdOf(key: PrivateKey): string {
  return peerIdFromPrivateKey(key).toString();
}

export interface SwarmOptions {
  privateKey: PrivateKey;
  listen: string[];
  bootstrap: string[];
  /** How often unconnected bootstrap peers are dialed again; default one minute. */
  redialIntervalMs?: number;
  mdns: boolean;
  verify: (raw: Uint8Array, senderPeerId: string) => Promise<VerifyResult>;
  onFlag: (message: SwarmMessage<FlagBody>) => void | Promise<void>;
  /** Returns true when the endpoint verified and was stored; false stops propagation. */
  onEndpoint: (message: SwarmMessage<EndpointBody>) => Promise<boolean>;
  log?: (line: string) => void;
}

interface Services extends Record<string, unknown> {
  pubsub: GossipSub;
  identify: Identify;
}

export type DropCounter = Partial<Record<DropReason | "unsigned" | "wrong_topic" | "endpoint_unverified" | "handler_error", number>>;

/** Verification failures that are the publisher's fault; the relaying peer is penalised by gossipsub. */
const REJECT: ReadonlySet<string> = new Set<DropReason>([
  "malformed",
  "unknown_kind",
  "invalid_body",
  "peer_mismatch",
  "reporter_mismatch",
  "bad_proof",
  "bad_signature",
  "tier_too_low",
]);

/**
 * The libp2p node: TCP, Noise, Yamux, identify, optional bootstrap and mDNS discovery, and gossipsub on
 * the two PayHole topics. Every inbound message goes through the topic validator, so a message that
 * fails verification is neither handled nor forwarded to other peers.
 */
export class Swarm {
  readonly dropped: DropCounter = {};
  received = 0;
  accepted = 0;
  lastMessageAt: number | null = null;

  private redialTimer: NodeJS.Timeout | null = null;
  private readonly redialFailures = new Map<string, number>();

  private constructor(
    readonly node: Libp2p<Services>,
    private readonly options: SwarmOptions,
  ) {}

  static async start(options: SwarmOptions): Promise<Swarm> {
    const node = await createLibp2p<Services>({
      privateKey: options.privateKey,
      addresses: { listen: options.listen },
      transports: [tcp()],
      connectionEncrypters: [noise()],
      streamMuxers: [yamux()],
      peerDiscovery: [...(options.bootstrap.length > 0 ? [bootstrap({ list: options.bootstrap })] : []), ...(options.mdns ? [mdns()] : [])],
      services: {
        identify: identify(),
        pubsub: gossipsub({ allowPublishToZeroTopicPeers: true, emitSelf: false, allowedTopics: [TOPIC_FLAGS, TOPIC_DIRECTORY] }),
      },
    });
    const swarm = new Swarm(node, options);
    const pubsub = node.services.pubsub;
    pubsub.topicValidators.set(TOPIC_FLAGS, (peer, message) => swarm.validate(peer, message, "flag"));
    pubsub.topicValidators.set(TOPIC_DIRECTORY, (peer, message) => swarm.validate(peer, message, "endpoint"));
    pubsub.subscribe(TOPIC_FLAGS);
    pubsub.subscribe(TOPIC_DIRECTORY);
    if (options.bootstrap.length > 0) {
      swarm.redialTimer = setInterval(() => void swarm.redialBootstrap(), options.redialIntervalMs ?? 60_000);
      swarm.redialTimer.unref();
    }
    return swarm;
  }

  /**
   * Dials every bootstrap peer this node is not connected to. libp2p backs off for a long time once a
   * dial fails, so a bootstrap node that restarts would otherwise stay unreachable for many minutes.
   */
  async redialBootstrap(): Promise<number> {
    let dialed = 0;
    const connected = new Set(this.node.getPeers().map((peer) => peer.toString()));
    for (const raw of this.options.bootstrap) {
      let addr: Multiaddr;
      try {
        addr = multiaddr(raw);
      } catch {
        continue;
      }
      const peer = /\/p2p\/([1-9A-HJ-NP-Za-km-z]+)\/?$/.exec(raw)?.[1] ?? null;
      if (peer !== null && connected.has(peer)) continue;
      try {
        await this.node.dial(addr);
        dialed += 1;
        this.redialFailures.delete(raw);
        this.log(`swarm reconnected to bootstrap ${peer ?? raw}`);
      } catch (error) {
        const failures = (this.redialFailures.get(raw) ?? 0) + 1;
        this.redialFailures.set(raw, failures);
        if (failures === 1 || failures % 30 === 0) {
          this.log(`swarm could not reach bootstrap ${peer ?? raw} (${failures} tries): ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    }
    return dialed;
  }

  get peerId(): string {
    return this.node.peerId.toString();
  }

  multiaddrs(): string[] {
    return this.node.getMultiaddrs().map((addr) => addr.toString());
  }

  peers(): string[] {
    return this.node.getPeers().map((peer) => peer.toString());
  }

  subscribers(topic: string): string[] {
    return this.node.services.pubsub.getSubscribers(topic).map((peer) => peer.toString());
  }

  /** Dials another node; used by tests and by operators through bootstrap addresses otherwise. */
  async connect(addrs: ReturnType<Libp2p["getMultiaddrs"]>): Promise<void> {
    await this.node.dial(addrs);
  }

  /** Publishes a signed message on its topic; returns how many peers received it directly. */
  async publish(message: AnySwarmMessage): Promise<number> {
    const topic = message.kind === "flag" ? TOPIC_FLAGS : TOPIC_DIRECTORY;
    const result = await this.node.services.pubsub.publish(topic, encodeSwarmMessage(message));
    return result.recipients.length;
  }

  async stop(): Promise<void> {
    if (this.redialTimer) clearInterval(this.redialTimer);
    this.redialTimer = null;
    await this.node.stop();
  }

  private drop(reason: keyof DropCounter, verdict: TopicValidatorResult): TopicValidatorResult {
    this.dropped[reason] = (this.dropped[reason] ?? 0) + 1;
    return verdict;
  }

  private log(line: string): void {
    this.options.log?.(line);
  }

  private async validate(_peer: PeerId, message: Message, expected: "flag" | "endpoint"): Promise<TopicValidatorResult> {
    this.received += 1;
    this.lastMessageAt = Date.now();
    if (message.type !== "signed") return this.drop("unsigned", TopicValidatorResult.Reject);
    const sender = message.from.toString();
    const result = await this.options.verify(message.data, sender);
    if (!result.ok) {
      this.log(`dropped ${expected} message from ${sender}: ${result.reason} (${result.detail})`);
      return this.drop(result.reason, REJECT.has(result.reason) ? TopicValidatorResult.Reject : TopicValidatorResult.Ignore);
    }
    if (result.message.kind !== expected) return this.drop("wrong_topic", TopicValidatorResult.Reject);
    try {
      if (result.message.kind === "flag") {
        await this.options.onFlag(result.message);
      } else {
        const stored = await this.options.onEndpoint(result.message);
        if (!stored) return this.drop("endpoint_unverified", TopicValidatorResult.Ignore);
      }
    } catch (error) {
      this.log(`handler failed for ${expected} message from ${sender}: ${error instanceof Error ? error.message : String(error)}`);
      return this.drop("handler_error", TopicValidatorResult.Ignore);
    }
    this.accepted += 1;
    return TopicValidatorResult.Accept;
  }
}
