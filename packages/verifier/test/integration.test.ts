import { spawn, type ChildProcess } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createPublicClient, createWalletClient, http, type Abi, type Address, type Hex, type PublicClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { creatorRegistryAbi, customChain, readClaimNonce, readCreatorWallet } from "@payhole/sdk";
import { attest } from "../src/attest.js";

const PORT = 8565;
const CHAIN_ID = 4663;
const OWNER_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const VERIFIER_KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
const CREATOR: Address = "0x90F79bf6EB2c4f870365E785982E1f101E93b906";
const NEW_WALLET: Address = "0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65";

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, "..", "..", "contracts", "out");
const artifact = (name: string) =>
  JSON.parse(readFileSync(join(out, `${name}.sol`, `${name}.json`), "utf8")) as { abi: Abi; bytecode: { object: Hex } };

let anvil: ChildProcess;
let publicClient: PublicClient;
let registry: Address;
const owner = privateKeyToAccount(OWNER_KEY);
const verifier = privateKeyToAccount(VERIFIER_KEY);
const rpcUrl = `http://127.0.0.1:${PORT}`;
const chain = customChain(CHAIN_ID, rpcUrl);
const ownerWallet = createWalletClient({ account: owner, chain, transport: http(rpcUrl) });

beforeAll(async () => {
  anvil = spawn("anvil", ["--port", String(PORT), "--chain-id", String(CHAIN_ID), "--silent"], { stdio: "ignore" });
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(rpcUrl, { method: "POST", body: '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}' })).ok) break;
    } catch {
      /* not ready */
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  publicClient = createPublicClient({ chain, transport: http(rpcUrl) });
  const usdgArt = artifact("MockUSDG");
  let hash = await ownerWallet.deployContract({ abi: usdgArt.abi, bytecode: usdgArt.bytecode.object });
  const usdg = (await publicClient.waitForTransactionReceipt({ hash })).contractAddress!;
  const regArt = artifact("CreatorRegistry");
  hash = await ownerWallet.deployContract({ abi: regArt.abi, bytecode: regArt.bytecode.object, args: [usdg, verifier.address, owner.address] });
  registry = (await publicClient.waitForTransactionReceipt({ hash })).contractAddress!;
});

afterAll(async () => {
  await new Promise<void>((resolve) => {
    anvil.once("exit", () => resolve());
    anvil.kill();
  });
});

describe("attestation against the real CreatorRegistry", () => {
  const txt: Record<string, string[][]> = { "_payhole.creator.example": [[`payhole=${CREATOR}`]] };
  const deps = () => ({
    resolveTxt: (name: string) => Promise.resolve(txt[name] ?? []),
    readNonce: (hash: Hex) => readClaimNonce(publicClient, registry, hash),
    signer: verifier,
    chainId: CHAIN_ID,
    registry,
    ttlSeconds: 3600,
  });

  it("claims with the attestation, refuses a replay, and rotates with a fresh one", async () => {
    const first = await attest(deps(), { domain: "creator.example", wallet: CREATOR });
    let hash = await ownerWallet.writeContract({
      address: registry,
      abi: creatorRegistryAbi,
      functionName: "claim",
      args: [first.domainHash, first.wallet, BigInt(first.deadline), first.signature],
    });
    expect((await publicClient.waitForTransactionReceipt({ hash })).status).toBe("success");
    expect(await readCreatorWallet(publicClient, registry, first.domainHash)).toBe(CREATOR);
    expect(await readClaimNonce(publicClient, registry, first.domainHash)).toBe(1n);

    await expect(
      publicClient.simulateContract({
        account: owner,
        address: registry,
        abi: creatorRegistryAbi,
        functionName: "claim",
        args: [first.domainHash, first.wallet, BigInt(first.deadline), first.signature],
      }),
    ).rejects.toThrow(/InvalidAttestation/);

    txt["_payhole.creator.example"] = [[`payhole=${NEW_WALLET}`]];
    const second = await attest(deps(), { domain: "creator.example", wallet: NEW_WALLET });
    expect(second.nonce).toBe("1");
    hash = await ownerWallet.writeContract({
      address: registry,
      abi: creatorRegistryAbi,
      functionName: "claim",
      args: [second.domainHash, second.wallet, BigInt(second.deadline), second.signature],
    });
    expect((await publicClient.waitForTransactionReceipt({ hash })).status).toBe("success");
    expect(await readCreatorWallet(publicClient, registry, second.domainHash)).toBe(NEW_WALLET);
  });

  it("refuses to attest when the TXT record does not name the wallet", async () => {
    await expect(attest(deps(), { domain: "creator.example", wallet: CREATOR })).rejects.toMatchObject({ status: 422 });
  });
});
