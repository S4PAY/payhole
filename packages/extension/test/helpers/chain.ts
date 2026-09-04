import { createPublicClient, createWalletClient, erc20Abi, http, parseEther, type Address, type Hex, type PublicClient } from "viem";
import { privateKeyToAccount, type HDAccount, type PrivateKeyAccount } from "viem/accounts";
import { budgetAccountAbi, budgetAccountFactoryAbi, customChain } from "@payhole/sdk";
import { artifact, mockUsdgAbi } from "./artifacts";

/** Anvil's default mnemonic; account 0 is the owner in every chain-backed test. */
export const TEST_MNEMONIC = "test test test test test test test test test test test junk";
export const OWNER_KEY: Hex = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
export const RELAYER_KEY: Hex = "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a";
export const MERCHANT: Address = "0x90F79bf6EB2c4f870365E785982E1f101E93b906";
export const CHAIN_ID = 4663;

export interface Deployed {
  publicClient: PublicClient;
  usdg: Address;
  factory: Address;
  budgetAccount: Address;
  owner: PrivateKeyAccount;
  relayer: PrivateKeyAccount;
}

export function wallet(account: PrivateKeyAccount | HDAccount, rpcUrl: string) {
  return createWalletClient({ account, chain: customChain(CHAIN_ID, rpcUrl), transport: http(rpcUrl) });
}

/** Deploys MockUSDG and the factory, creates the owner's account, mints and deposits USDG. */
export async function deployBudget(rpcUrl: string, options: { mint: bigint; deposit: bigint }): Promise<Deployed> {
  const owner = privateKeyToAccount(OWNER_KEY);
  const relayer = privateKeyToAccount(RELAYER_KEY);
  const chain = customChain(CHAIN_ID, rpcUrl);
  const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });
  const ownerWallet = wallet(owner, rpcUrl);

  const usdgArtifact = artifact("MockUSDG");
  let hash = await ownerWallet.deployContract({ abi: usdgArtifact.abi, bytecode: usdgArtifact.bytecode });
  const usdg = (await publicClient.waitForTransactionReceipt({ hash })).contractAddress!;

  const factoryArtifact = artifact("BudgetAccountFactory");
  hash = await ownerWallet.deployContract({ abi: factoryArtifact.abi, bytecode: factoryArtifact.bytecode, args: [usdg, owner.address] });
  const factory = (await publicClient.waitForTransactionReceipt({ hash })).contractAddress!;

  const salt: Hex = `0x${"0".repeat(64)}`;
  hash = await ownerWallet.writeContract({ address: factory, abi: budgetAccountFactoryAbi, functionName: "createAccount", args: [salt] });
  await publicClient.waitForTransactionReceipt({ hash });
  const budgetAccount = await publicClient.readContract({ address: factory, abi: budgetAccountFactoryAbi, functionName: "predictAccount", args: [owner.address, salt] });

  hash = await ownerWallet.writeContract({ address: usdg, abi: mockUsdgAbi, functionName: "mint", args: [owner.address, options.mint] });
  await publicClient.waitForTransactionReceipt({ hash });
  hash = await ownerWallet.writeContract({ address: usdg, abi: erc20Abi, functionName: "approve", args: [budgetAccount, options.mint] });
  await publicClient.waitForTransactionReceipt({ hash });
  hash = await ownerWallet.writeContract({ address: budgetAccount, abi: budgetAccountAbi, functionName: "deposit", args: [options.deposit] });
  await publicClient.waitForTransactionReceipt({ hash });

  return { publicClient, usdg, factory, budgetAccount, owner, relayer };
}

export async function fundEth(rpcUrl: string, to: Address, amount = parseEther("1")): Promise<void> {
  const funder = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");
  const w = wallet(funder, rpcUrl);
  const hash = await w.sendTransaction({ to, value: amount });
  await createPublicClient({ chain: customChain(CHAIN_ID, rpcUrl), transport: http(rpcUrl) }).waitForTransactionReceipt({ hash });
}

export function balanceOf(client: PublicClient, usdg: Address, who: Address): Promise<bigint> {
  return client.readContract({ address: usdg, abi: erc20Abi, functionName: "balanceOf", args: [who] });
}
