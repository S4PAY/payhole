import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createPublicClient,
  createWalletClient,
  erc20Abi,
  http,
  parseEther,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  budgetAccountAbi,
  budgetAccountFactoryAbi,
  customChain,
  NoAcceptableOfferError,
  PaymentRefusedError,
  payholeFetch,
  readSessionKey,
  type PaymentReceipt,
} from "../src/index.js";
import { startAnvil, type AnvilHandle } from "./helpers/anvil.js";
import { artifact, mockUsdgAbi } from "./helpers/artifacts.js";
import { startMockX402Server, type MockServer } from "./helpers/mockServer.js";

const ANVIL_PORT = 8555;
const CHAIN_ID = 4663;
const OWNER_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const FUNDER_KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
const RELAYER_KEY = "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a";
const MERCHANT: Address = "0x90F79bf6EB2c4f870365E785982E1f101E93b906";
const PRICE = 250_000n; // 0.25 USDG

let anvil: AnvilHandle;
let publicClient: PublicClient;
let usdg: Address;
let budgetAccount: Address;
let server: MockServer;
let serverV1: MockServer;

const owner = privateKeyToAccount(OWNER_KEY);
const funder = privateKeyToAccount(FUNDER_KEY);
const relayer = privateKeyToAccount(RELAYER_KEY);
const sessionKey = generatePrivateKey();
const sessionAccount = privateKeyToAccount(sessionKey);

function wallet(account: typeof owner, rpcUrl: string) {
  return createWalletClient({ account, chain: customChain(CHAIN_ID, rpcUrl), transport: http(rpcUrl) });
}

async function ownerWrite(functionName: "setGlobalCap" | "setSessionKey" | "revokeSessionKey" | "deposit", args: readonly unknown[]) {
  const w = wallet(owner, anvil.rpcUrl);
  const hash = await w.writeContract({
    address: budgetAccount,
    abi: budgetAccountAbi,
    functionName,
    args: args as never,
  });
  await publicClient.waitForTransactionReceipt({ hash });
}

async function balance(who: Address): Promise<bigint> {
  return publicClient.readContract({ address: usdg, abi: erc20Abi, functionName: "balanceOf", args: [who] });
}

beforeAll(async () => {
  anvil = await startAnvil(ANVIL_PORT, CHAIN_ID);
  const chain = customChain(CHAIN_ID, anvil.rpcUrl);
  publicClient = createPublicClient({ chain, transport: http(anvil.rpcUrl) });
  const ownerWallet = wallet(owner, anvil.rpcUrl);

  const usdgArtifact = artifact("MockUSDG");
  let hash = await ownerWallet.deployContract({ abi: usdgArtifact.abi, bytecode: usdgArtifact.bytecode });
  usdg = (await publicClient.waitForTransactionReceipt({ hash })).contractAddress!;

  const factoryArtifact = artifact("BudgetAccountFactory");
  hash = await ownerWallet.deployContract({ abi: factoryArtifact.abi, bytecode: factoryArtifact.bytecode, args: [usdg, owner.address] });
  const factory = (await publicClient.waitForTransactionReceipt({ hash })).contractAddress!;

  const salt: Hex = `0x${"0".repeat(64)}`;
  hash = await ownerWallet.writeContract({ address: factory, abi: budgetAccountFactoryAbi, functionName: "createAccount", args: [salt] });
  await publicClient.waitForTransactionReceipt({ hash });
  budgetAccount = await publicClient.readContract({
    address: factory,
    abi: budgetAccountFactoryAbi,
    functionName: "predictAccount",
    args: [owner.address, salt],
  });

  hash = await ownerWallet.writeContract({ address: usdg, abi: mockUsdgAbi, functionName: "mint", args: [owner.address, 1_000_000_000n] });
  await publicClient.waitForTransactionReceipt({ hash });
  hash = await ownerWallet.writeContract({ address: usdg, abi: erc20Abi, functionName: "approve", args: [budgetAccount, 1_000_000_000n] });
  await publicClient.waitForTransactionReceipt({ hash });
  await ownerWrite("deposit", [200_000_000n]);
  await ownerWrite("setGlobalCap", [100_000_000n]);
  const expiry = BigInt(Math.floor(Date.now() / 1000) + 86_400);
  await ownerWrite("setSessionKey", [sessionAccount.address, 1_000_000n, expiry]);

  // gas for the session key's pulls
  hash = await wallet(funder, anvil.rpcUrl).sendTransaction({ to: sessionAccount.address, value: parseEther("1") });
  await publicClient.waitForTransactionReceipt({ hash });

  const relayerWallet = wallet(relayer, anvil.rpcUrl);
  server = await startMockX402Server({ publicClient, relayer: relayerWallet, asset: usdg, payTo: MERCHANT, amount: PRICE, chainId: CHAIN_ID, version: 2, port: 8556 });
  serverV1 = await startMockX402Server({ publicClient, relayer: relayerWallet, asset: usdg, payTo: MERCHANT, amount: PRICE, chainId: CHAIN_ID, version: 1, port: 8557 });
});

afterAll(async () => {
  await server?.close();
  await serverV1?.close();
  await anvil?.stop();
});

describe("payholeFetch against a BudgetAccount", () => {
  it("pays a v2 402 silently under the cap and reports the settlement", async () => {
    const receipts: PaymentReceipt[] = [];
    const pulls: bigint[] = [];
    const fetchPaid = payholeFetch({
      sessionKey,
      budgetAccount,
      rpcUrl: anvil.rpcUrl,
      chainId: CHAIN_ID,
      usdg,
      onPaid: (r) => void receipts.push(r),
      onPull: (pulled) => void pulls.push(pulled),
    });
    const merchantBefore = await balance(MERCHANT);
    const response = await fetchPaid(`${server.url}/paid`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, paid: PRICE.toString() });
    expect(await balance(MERCHANT)).toBe(merchantBefore + PRICE);
    expect(await balance(sessionAccount.address)).toBe(0n);
    expect(pulls).toEqual([PRICE]);
    expect(receipts).toHaveLength(1);
    expect(receipts[0]?.settlement?.success).toBe(true);
    expect(receipts[0]?.settlement?.transaction).toMatch(/^0x[0-9a-f]{64}$/);
    expect(receipts[0]?.authorization.from).toBe(sessionAccount.address);
    const state = await readSessionKey(publicClient, budgetAccount, sessionAccount.address);
    expect(state.spent).toBe(PRICE);
    expect(state.remaining).toBe(1_000_000n - PRICE);
    expect(server.stats).toMatchObject({ challenges: 1, payments: 1, settled: 1, rejected: [] });
  });

  it("pays a v1 402 with the X-PAYMENT header", async () => {
    const fetchPaid = payholeFetch({ sessionKey, budgetAccount, rpcUrl: anvil.rpcUrl, chainId: CHAIN_ID, usdg });
    const receipts: PaymentReceipt[] = [];
    const response = await payholeFetch({
      sessionKey,
      budgetAccount,
      rpcUrl: anvil.rpcUrl,
      chainId: CHAIN_ID,
      usdg,
      onPaid: (r) => void receipts.push(r),
    })(`${serverV1.url}/paid`);
    expect(response.status).toBe(200);
    expect(receipts[0]?.offer.version).toBe(1);
    expect(receipts[0]?.settlement?.success).toBe(true);
    expect(serverV1.stats.settled).toBe(1);
    expect(fetchPaid.payer).toBe(sessionAccount.address);
  });

  it("passes non-402 responses through untouched", async () => {
    const fetchPaid = payholeFetch({ sessionKey, budgetAccount, rpcUrl: anvil.rpcUrl, chainId: CHAIN_ID, usdg });
    const response = await fetchPaid(`${server.url}/free`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ free: true });
  });

  it("refuses an offer in another asset without signing", async () => {
    const fetchPaid = payholeFetch({ sessionKey, budgetAccount, rpcUrl: anvil.rpcUrl, chainId: CHAIN_ID, usdg });
    await expect(fetchPaid(`${server.url}/wrong-asset`)).rejects.toBeInstanceOf(NoAcceptableOfferError);
  });

  it("refuses above --max before touching the chain", async () => {
    const fetchPaid = payholeFetch({ sessionKey, budgetAccount, rpcUrl: anvil.rpcUrl, chainId: CHAIN_ID, usdg, maxAmount: PRICE - 1n });
    const payments = server.stats.payments;
    await expect(fetchPaid(`${server.url}/paid`)).rejects.toBeInstanceOf(PaymentRefusedError);
    expect(server.stats.payments).toBe(payments);
  });

  it("refuses once the key's cap is spent and never sends a signature", async () => {
    const fetchPaid = payholeFetch({ sessionKey, budgetAccount, rpcUrl: anvil.rpcUrl, chainId: CHAIN_ID, usdg });
    // cap 1.00 USDG, 0.50 spent so far across the v2 and v1 payments: two more succeed, the third is refused
    expect((await fetchPaid(`${server.url}/paid`)).status).toBe(200);
    expect((await fetchPaid(`${server.url}/paid`)).status).toBe(200);
    const state = await readSessionKey(publicClient, budgetAccount, sessionAccount.address);
    expect(state.spent).toBe(1_000_000n);
    expect(state.remaining).toBe(0n);
    const payments = server.stats.payments;
    const error = await fetchPaid(`${server.url}/paid`).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PaymentRefusedError);
    expect((error as PaymentRefusedError).reason).toBe("cap-exceeded");
    expect(server.stats.payments).toBe(payments);
    expect(await balance(MERCHANT)).toBe(4n * PRICE);
  });

  it("refuses a revoked key immediately", async () => {
    await ownerWrite("setSessionKey", [sessionAccount.address, 5_000_000n, BigInt(Math.floor(Date.now() / 1000) + 3600)]);
    await ownerWrite("revokeSessionKey", [sessionAccount.address]);
    const fetchPaid = payholeFetch({ sessionKey, budgetAccount, rpcUrl: anvil.rpcUrl, chainId: CHAIN_ID, usdg });
    const error = await fetchPaid(`${server.url}/paid`).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PaymentRefusedError);
    expect((error as PaymentRefusedError).reason).toBe("key-not-live");
  });
});

describe("payhole CLI", () => {
  const cliKey = generatePrivateKey();
  const cliAccount = privateKeyToAccount(cliKey);
  const keyDir = mkdtempSync(join(tmpdir(), "payhole-cli-"));
  const env = () => ({
    ...process.env,
    PAYHOLE_KEY_FILE: join(keyDir, "key.json"),
    PAYHOLE_BUDGET_ACCOUNT: budgetAccount,
    PAYHOLE_RPC_URL: anvil.rpcUrl,
    PAYHOLE_CHAIN_ID: String(CHAIN_ID),
    PAYHOLE_USDG: usdg,
  });
  // The mock server lives in this process, so the CLI must run asynchronously to be answered.
  const cli = (...args: string[]) =>
    new Promise<{ status: number | null; stdout: string; stderr: string }>((resolve) => {
      const child = spawn(process.execPath, [join(process.cwd(), "dist", "cli", "main.js"), ...args], { env: env() });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
      child.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
      child.on("close", (status) => resolve({ status, stdout, stderr }));
    });

  it("imports a key, shows status, pays once, then refuses", async () => {
    const imported = await cli("key", "import", cliKey);
    expect(imported.status, imported.stderr).toBe(0);
    expect(imported.stdout).toContain(cliAccount.address);
    expect((await cli("key", "address")).stdout.trim()).toBe(cliAccount.address);

    await ownerWrite("setSessionKey", [cliAccount.address, PRICE, BigInt(Math.floor(Date.now() / 1000) + 3600)]);
    const hash = await wallet(funder, anvil.rpcUrl).sendTransaction({ to: cliAccount.address, value: parseEther("1") });
    await publicClient.waitForTransactionReceipt({ hash });

    const status = await cli("status");
    expect(status.status, status.stderr).toBe(0);
    expect(status.stdout).toContain("remaining        0.25 USDG");
    expect(status.stdout).toContain("live");

    const paid = await cli("pay", `${server.url}/paid`);
    expect(paid.status, paid.stderr).toBe(0);
    expect(paid.stderr).toContain("paid 0.25 USDG");
    expect(paid.stderr).toContain("settled in 0x");
    expect(JSON.parse(paid.stdout)).toEqual({ ok: true, paid: PRICE.toString() });

    const refused = await cli("pay", `${server.url}/paid`);
    expect(refused.status, refused.stderr).toBe(2);
    expect(refused.stderr).toContain("payment refused");
    expect(refused.stderr).toContain("cap-exceeded");

    const after = await cli("status");
    expect(after.stdout).toContain("remaining        0 USDG");
  });
});
