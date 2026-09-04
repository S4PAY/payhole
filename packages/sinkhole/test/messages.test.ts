import { getAddress, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { describe, expect, it } from "vitest";
import { cachedTierReader } from "../src/swarm/membership.js";
import {
  canonicalJson,
  encodeSwarmMessage,
  membershipText,
  signProof,
  signSwarmMessage,
  verifyProof,
  verifySwarmMessage,
  type FlagBody,
  type SwarmMessage,
} from "../src/swarm/messages.js";

const operator = privateKeyToAccount(`0x${"11".repeat(32)}`);
const stranger = privateKeyToAccount(`0x${"22".repeat(32)}`);
const peerId = "12D3KooWDpJ7As7BWAwRMfu1VU2WCqNjvq387JEYKDBj4kx6nXTN";
const otherPeer = "12D3KooWQYV9dGMFoRzNStwpXztXaBUjtPqi6aU76ZgUriHhKust";
const NOW = 1_800_000_000_000;

const tiers: Record<string, number> = { [operator.address.toLowerCase()]: 2 };
const tierOf = (address: Address): Promise<number> => Promise.resolve(tiers[address.toLowerCase()] ?? 0);
const options = { tierOf, minTier: 1, clock: () => NOW };

async function flagMessage(ts = NOW): Promise<SwarmMessage<FlagBody>> {
  const proof = await signProof(operator, peerId, "2026-09-01T00:00:00.000Z");
  return signSwarmMessage(operator, proof, { type: "flag", domain: "drainer.example", reason: "wallet drainer", ts });
}

describe("canonicalJson", () => {
  it("sorts keys at every level and drops undefined", () => {
    expect(canonicalJson({ b: 1, a: { d: [3, { z: 1, y: 2 }], c: "x" }, u: undefined })).toBe('{"a":{"c":"x","d":[3,{"y":2,"z":1}]},"b":1}');
    expect(canonicalJson(null)).toBe("null");
  });
});

describe("membership proof", () => {
  it("signs the exact text and verifies against the publishing peer", async () => {
    const proof = await signProof(operator, peerId, "2026-09-01T00:00:00.000Z");
    expect(proof.address).toBe(getAddress(operator.address));
    expect(membershipText(peerId, proof.address, proof.issuedAt)).toBe(
      `PayHole Sinkhole membership\npeer: ${peerId}\naddress: ${proof.address}\nissued: 2026-09-01T00:00:00.000Z`,
    );
    expect(await verifyProof(proof, peerId, NOW)).toEqual({ ok: true });
    expect(await verifyProof(proof, otherPeer, NOW)).toMatchObject({ ok: false, reason: "peer_mismatch" });
    expect(await verifyProof({ ...proof, address: stranger.address }, peerId, NOW)).toMatchObject({ ok: false, reason: "bad_proof" });
    expect(await verifyProof({ ...proof, issuedAt: "2027-01-01T00:00:00.000Z" }, peerId, NOW)).toMatchObject({ ok: false, reason: "bad_proof" });
  });
});

describe("verifySwarmMessage", () => {
  it("accepts a valid flag message", async () => {
    const message = await flagMessage();
    const result = await verifySwarmMessage(encodeSwarmMessage(message), peerId, options);
    expect(result).toMatchObject({
      ok: true,
      message: { kind: "flag", reporter: getAddress(operator.address), body: { domain: "drainer.example", reason: "wallet drainer" } },
    });
  });

  it("accepts a valid endpoint message and normalises addresses", async () => {
    const proof = await signProof(operator, peerId);
    const message = await signSwarmMessage(operator, proof, {
      type: "endpoint",
      url: "https://api.example/paid",
      network: "eip155:4663",
      asset: "0x5fc5360d0400a0fd4f2af552add042d716f1d168",
      payTo: stranger.address,
      ts: NOW,
    });
    const result = await verifySwarmMessage(encodeSwarmMessage(message), peerId, options);
    expect(result).toMatchObject({
      ok: true,
      message: { kind: "endpoint", body: { asset: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168", payTo: getAddress(stranger.address) } },
    });
  });

  it("rejects a proof bound to another peer", async () => {
    const message = await flagMessage();
    expect(await verifySwarmMessage(encodeSwarmMessage(message), otherPeer, options)).toMatchObject({ ok: false, reason: "peer_mismatch" });
  });

  it("rejects an operator below the tier and reports RPC failures separately", async () => {
    const proof = await signProof(stranger, peerId);
    const message = await signSwarmMessage(stranger, proof, { type: "flag", domain: "x.example", reason: "r", ts: NOW });
    expect(await verifySwarmMessage(encodeSwarmMessage(message), peerId, options)).toMatchObject({ ok: false, reason: "tier_too_low" });
    expect(await verifySwarmMessage(encodeSwarmMessage(message), peerId, { ...options, minTier: 0 })).toMatchObject({ ok: true });
    const failing = { ...options, tierOf: () => Promise.reject(new Error("rpc down")) };
    expect(await verifySwarmMessage(encodeSwarmMessage(message), peerId, failing)).toMatchObject({ ok: false, reason: "tier_unavailable", detail: "rpc down" });
  });

  it("rejects a bad proof signature", async () => {
    const message = await flagMessage();
    const forged = { ...message, proof: { ...message.proof, signature: `0x${"ab".repeat(65)}` as const } };
    expect(await verifySwarmMessage(JSON.stringify(forged), peerId, options)).toMatchObject({ ok: false, reason: "bad_proof" });
    const strangerProof = await signProof(stranger, peerId);
    const borrowed = { ...message, proof: { ...strangerProof, address: message.reporter } };
    expect(await verifySwarmMessage(JSON.stringify(borrowed), peerId, options)).toMatchObject({ ok: false, reason: "bad_proof" });
  });

  it("rejects a tampered body and a reporter that differs from the proof", async () => {
    const message = await flagMessage();
    const tampered = { ...message, body: { ...message.body, domain: "innocent.example" } };
    expect(await verifySwarmMessage(JSON.stringify(tampered), peerId, options)).toMatchObject({ ok: false, reason: "bad_signature" });
    const reordered = JSON.stringify({
      signature: message.signature,
      body: { ts: message.body.ts, reason: message.body.reason, domain: message.body.domain, type: "flag" },
      proof: message.proof,
      reporter: message.reporter,
      kind: "flag",
    });
    expect(await verifySwarmMessage(reordered, peerId, options)).toMatchObject({ ok: true });
    const impostor = { ...message, reporter: stranger.address };
    expect(await verifySwarmMessage(JSON.stringify(impostor), peerId, options)).toMatchObject({ ok: false, reason: "reporter_mismatch" });
  });

  it("rejects stale, malformed and oversized messages", async () => {
    expect(await verifySwarmMessage(encodeSwarmMessage(await flagMessage(NOW - 60 * 60_000)), peerId, options)).toMatchObject({ ok: false, reason: "stale" });
    expect(await verifySwarmMessage(encodeSwarmMessage(await flagMessage(NOW + 10 * 60_000)), peerId, options)).toMatchObject({ ok: false, reason: "stale" });
    expect(await verifySwarmMessage("not json", peerId, options)).toMatchObject({ ok: false, reason: "malformed" });
    expect(await verifySwarmMessage("[]", peerId, options)).toMatchObject({ ok: false, reason: "malformed" });
    expect(await verifySwarmMessage(JSON.stringify({ kind: "other" }), peerId, options)).toMatchObject({ ok: false, reason: "unknown_kind" });
    const message = await flagMessage();
    const badDomain = await signSwarmMessage(operator, message.proof, { type: "flag", domain: "http://nope", reason: "r", ts: NOW });
    expect(await verifySwarmMessage(encodeSwarmMessage(badDomain), peerId, options)).toMatchObject({ ok: false, reason: "invalid_body" });
    const huge = JSON.stringify({ ...message, body: { ...message.body, reason: "x".repeat(20_000) } });
    expect(await verifySwarmMessage(huge, peerId, options)).toMatchObject({ ok: false, reason: "malformed" });
  });
});

describe("cachedTierReader", () => {
  it("caches successes for the ttl and failures briefly", async () => {
    let now = 0;
    let calls = 0;
    let fail = false;
    const reader = cachedTierReader(
      () => {
        calls += 1;
        return fail ? Promise.reject(new Error("rpc")) : Promise.resolve(3);
      },
      { ttlMs: 1000, errorTtlMs: 100, clock: () => now },
    );
    expect(await Promise.all([reader(operator.address), reader(operator.address)])).toEqual([3, 3]);
    expect(calls).toBe(1);
    now = 999;
    expect(await reader(operator.address)).toBe(3);
    expect(calls).toBe(1);
    now = 1001;
    fail = true;
    await expect(reader(operator.address)).rejects.toThrow("rpc");
    await expect(reader(operator.address)).rejects.toThrow("rpc");
    expect(calls).toBe(2);
    now = 1200;
    fail = false;
    expect(await reader(operator.address)).toBe(3);
    expect(calls).toBe(3);
  });
});
