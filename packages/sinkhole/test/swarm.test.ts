import { generateKeyPair } from "@libp2p/crypto/keys";
import { type Address } from "viem";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Blocklist } from "../src/blocklist.js";
import { Directory } from "../src/swarm/directory.js";
import { signProof, signSwarmMessage, TOPIC_DIRECTORY, TOPIC_FLAGS, verifySwarmMessage, type MembershipProof } from "../src/swarm/messages.js";
import { Swarm } from "../src/swarm/node.js";

const HOUR = 3_600_000;
const USDG = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168";
const operatorA = privateKeyToAccount(`0x${"a1".repeat(32)}`);
const operatorB = privateKeyToAccount(`0x${"b2".repeat(32)}`);
const operatorC = privateKeyToAccount(`0x${"c3".repeat(32)}`);
const outsider = privateKeyToAccount(`0x${"d4".repeat(32)}`);

const tiers = new Map<string, number>([
  [operatorA.address.toLowerCase(), 1],
  [operatorB.address.toLowerCase(), 2],
  [operatorC.address.toLowerCase(), 1],
]);
const tierOf = (address: Address): Promise<number> => Promise.resolve(tiers.get(address.toLowerCase()) ?? 0);

interface TestNode {
  swarm: Swarm;
  blocklist: Blocklist;
  directory: Directory;
  operator: PrivateKeyAccount;
  proof: MembershipProof;
  endpointsSeen: string[];
}

async function startNode(operator: PrivateKeyAccount, threshold: number): Promise<TestNode> {
  const blocklist = new Blocklist({ threshold, ttlMs: HOUR });
  const directory = new Directory({ probe: () => Promise.resolve({ ok: true, offer: { network: "eip155:4663", asset: USDG, payTo: operator.address, amount: "1", scheme: "exact" } }) });
  const endpointsSeen: string[] = [];
  const swarm = await Swarm.start({
    privateKey: await generateKeyPair("Ed25519"),
    listen: ["/ip4/127.0.0.1/tcp/0"],
    bootstrap: [],
    mdns: false,
    verify: (raw, sender) => verifySwarmMessage(raw, sender, { tierOf, minTier: 1 }),
    onFlag: (message) => {
      blocklist.recordFlag(message.body.domain, message.reporter, message.body.reason, message.body.ts);
    },
    onEndpoint: async (message) => {
      endpointsSeen.push(message.body.url);
      return (await directory.handleAnnouncement(message.body, message.reporter)).ok;
    },
  });
  const proof = await signProof(operator, swarm.peerId);
  return { swarm, blocklist, directory, operator, proof, endpointsSeen };
}

async function waitFor(check: () => boolean, what: string, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

function reporters(node: TestNode, domain: string): number {
  return node.blocklist.flagSummaries().find((entry) => entry.domain === domain)?.reporters ?? 0;
}

let a: TestNode;
let b: TestNode;
let c: TestNode;

beforeAll(async () => {
  [a, b, c] = await Promise.all([startNode(operatorA, 2), startNode(operatorB, 2), startNode(operatorC, 2)]);
  // A - B - C: A and C only ever talk through B.
  await b.swarm.connect(a.swarm.node.getMultiaddrs());
  await c.swarm.connect(b.swarm.node.getMultiaddrs());
  await waitFor(
    () =>
      [TOPIC_FLAGS, TOPIC_DIRECTORY].every(
        (topic) =>
          a.swarm.subscribers(topic).includes(b.swarm.peerId) &&
          b.swarm.subscribers(topic).includes(a.swarm.peerId) &&
          b.swarm.subscribers(topic).includes(c.swarm.peerId) &&
          c.swarm.subscribers(topic).includes(b.swarm.peerId),
      ),
    "subscriptions to propagate",
  );
});

afterAll(async () => {
  await Promise.all([a, b, c].filter(Boolean).map((node) => node.swarm.stop()));
});

describe("swarm", () => {
  it("counts one reporter per flag and confirms only at the threshold, relaying through intermediate peers", async () => {
    const flagFromA = await signSwarmMessage(a.operator, a.proof, { type: "flag", domain: "drainer.example", reason: "wallet drainer", ts: Date.now() });
    expect(await a.swarm.publish(flagFromA)).toBeGreaterThan(0);
    await waitFor(() => reporters(b, "drainer.example") === 1, "B to record A's flag");
    await waitFor(() => reporters(c, "drainer.example") === 1, "C to receive A's flag through B");
    expect(b.blocklist.isConfirmed("drainer.example")).toBe(false);
    expect(b.blocklist.domains().has("drainer.example")).toBe(false);

    const again = await signSwarmMessage(a.operator, a.proof, { type: "flag", domain: "drainer.example", reason: "still a drainer", ts: Date.now() });
    await a.swarm.publish(again);
    await waitFor(() => b.swarm.accepted >= 2, "B to accept the repeat");
    expect(reporters(b, "drainer.example")).toBe(1);
    expect(b.blocklist.isConfirmed("drainer.example")).toBe(false);

    const flagFromC = await signSwarmMessage(c.operator, c.proof, { type: "flag", domain: "drainer.example", reason: "confirmed", ts: Date.now() });
    await c.swarm.publish(flagFromC);
    await waitFor(() => b.blocklist.isConfirmed("drainer.example"), "B to confirm after a second distinct reporter");
    expect(b.blocklist.merged()).toEqual([{ domain: "drainer.example", sources: ["swarm"], reason: "flagged by 2 reporters", category: "phishing" }]);
    // A never records its own flag (it is already in A's local list), so C's flag is A's first reporter.
    await waitFor(() => reporters(a, "drainer.example") === 1, "A to receive C's flag through B");
    expect(a.blocklist.isConfirmed("drainer.example")).toBe(false);
  });

  it("drops and counts messages with an invalid proof or an unqualified operator without forwarding them", async () => {
    const receivedByC = c.swarm.received;
    const wrongPeerProof = await signProof(a.operator, c.swarm.peerId);
    const badProof = await signSwarmMessage(a.operator, wrongPeerProof, { type: "flag", domain: "victim.example", reason: "spoof", ts: Date.now() });
    await a.swarm.publish(badProof);
    await waitFor(() => (b.swarm.dropped.peer_mismatch ?? 0) === 1, "B to drop the mismatched proof");

    const outsiderProof = await signProof(outsider, a.swarm.peerId);
    const noTier = await signSwarmMessage(outsider, outsiderProof, { type: "flag", domain: "victim.example", reason: "no tier", ts: Date.now() });
    await a.swarm.publish(noTier);
    await waitFor(() => (b.swarm.dropped.tier_too_low ?? 0) === 1, "B to drop the unqualified operator");

    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(c.swarm.received).toBe(receivedByC);
    expect(reporters(b, "victim.example")).toBe(0);
    expect(reporters(c, "victim.example")).toBe(0);
  });

  it("propagates verified directory entries", async () => {
    const announcement = await signSwarmMessage(a.operator, a.proof, {
      type: "endpoint",
      url: "https://api.example/paid",
      network: "eip155:4663",
      asset: USDG,
      payTo: operatorA.address,
      ts: Date.now(),
    });
    await a.swarm.publish(announcement);
    await waitFor(() => b.directory.size === 1, "B to store the endpoint");
    await waitFor(() => c.directory.size === 1, "C to receive the endpoint through B");
    expect(b.directory.list()[0]).toMatchObject({ url: "https://api.example/paid", reporter: operatorA.address, origin: "swarm" });
    expect(c.endpointsSeen).toEqual(["https://api.example/paid"]);
  });
});
