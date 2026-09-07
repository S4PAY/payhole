// The unlock page: buy a BurnVault tier from any wallet in the browser. Two transactions, approve and
// unlock, both signed by the wallet; the vault takes the USDG and buys and burns PAYHOLE with it. Nothing
// here talks to a server of ours; it is the wallet, the chain, and this page.

import { config } from "../lib/config.js";
import { keccak256 } from "../lib/keccak.js";
import { SELECTORS, call, decodeUint, encodeAddress, encodeUint } from "../lib/rpc.js";

interface EthereumProvider {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
}

declare global {
  interface Window {
    ethereum?: EthereumProvider;
  }
}

const TIERS = [1, 2, 3];
const ERC20 = { balanceOf: "0x70a08231", allowance: "0xdd62ed3e", approve: "0x095ea7b3" };
const UNLOCK = `0x${keccak256("unlock(uint8,uint256,uint256)").replace(/^0x/, "").slice(0, 8)}`;
const CHAIN_HEX = `0x${config.chainId.toString(16)}`;

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`missing #${id}`);
  return node as T;
}

function provider(): EthereumProvider {
  if (!window.ethereum) throw new Error("No wallet found in this browser. Open this page in MetaMask's browser on the phone, or in a desktop browser with a wallet installed.");
  return window.ethereum;
}

function usdg(amount: bigint): string {
  const whole = amount / 1_000_000n;
  const cents = ((amount % 1_000_000n) / 10_000n).toString().padStart(2, "0");
  return `${whole.toString()}.${cents}`;
}

async function ensureChain(): Promise<void> {
  const current = (await provider().request({ method: "eth_chainId" })) as string;
  if (current.toLowerCase() === CHAIN_HEX) return;
  try {
    await provider().request({ method: "wallet_switchEthereumChain", params: [{ chainId: CHAIN_HEX }] });
  } catch {
    await provider().request({
      method: "wallet_addEthereumChain",
      params: [{ chainId: CHAIN_HEX, chainName: "Robinhood Chain", rpcUrls: [config.rpc], nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, blockExplorerUrls: [config.explorer] }],
    });
  }
}

async function waitForReceipt(hash: string): Promise<{ status: string }> {
  for (let attempt = 0; attempt < 90; attempt += 1) {
    const receipt = (await provider().request({ method: "eth_getTransactionReceipt", params: [hash] })) as { status?: string } | null;
    if (receipt?.status) return { status: receipt.status };
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  throw new Error("The transaction is taking a long time. Check it in the wallet.");
}

async function send(from: string, to: string, data: string): Promise<string> {
  const hash = (await provider().request({ method: "eth_sendTransaction", params: [{ from, to, data }] })) as string;
  const receipt = await waitForReceipt(hash);
  if (receipt.status !== "0x1") throw new Error(`The transaction reverted: ${config.explorer}/tx/${hash}`);
  return hash;
}

interface Wallet {
  address: string;
  tier: number;
  balance: bigint;
  prices: bigint[];
}

let wallet: Wallet | null = null;

async function readWallet(address: string): Promise<Wallet> {
  const [tier, balance, ...prices] = await Promise.all([
    call(config.burnVault, SELECTORS.tierOf + encodeAddress(address)).then(decodeUint),
    call(config.usdg, ERC20.balanceOf + encodeAddress(address)).then(decodeUint),
    ...TIERS.map((tier) => call(config.burnVault, SELECTORS.tierPrice + encodeUint(BigInt(tier))).then(decodeUint)),
  ]);
  return { address, tier: Number(tier), balance, prices };
}

function render(): void {
  const state = el("state");
  const tiers = el("tiers");
  tiers.replaceChildren();
  if (!wallet) {
    el("wallet").style.display = "none";
    return;
  }
  el("wallet").style.display = "flex";
  el("address").textContent = wallet.address;
  el("balance").textContent = `${usdg(wallet.balance)} USDG`;
  el("current").textContent = wallet.tier === 0 ? "no tier yet" : `tier ${wallet.tier}`;
  TIERS.forEach((tier, index) => {
    const price = wallet?.prices[index] ?? 0n;
    const row = document.createElement("div");
    row.setAttribute("style", "display:flex;justify-content:space-between;align-items:center;gap:16px;padding:14px 0;border-bottom:1px solid var(--border)");
    const label = document.createElement("div");
    label.setAttribute("style", "display:flex;flex-direction:column;gap:2px");
    const name = document.createElement("div");
    name.setAttribute("style", "font:600 17px 'Space Grotesk';letter-spacing:-0.02em");
    name.textContent = `Tier ${tier}`;
    const cost = document.createElement("div");
    cost.setAttribute("style", "font:400 13px 'JetBrains Mono';color:var(--muted)");
    cost.textContent = price === 0n ? "not offered" : `${usdg(price)} USDG, bought and burned`;
    label.append(name, cost);
    const button = document.createElement("button");
    button.type = "button";
    const held = wallet !== null && wallet.tier >= tier;
    const short = wallet !== null && wallet.balance < price;
    button.className = held ? "ph-ghost" : "ph-lava";
    button.setAttribute("style", `font:600 14px Inter;color:${held ? "var(--muted)" : "inherit"};padding:10px 16px;border-radius:8px;border:${held ? "1px solid var(--border)" : "0"};cursor:pointer`);
    button.textContent = held ? "Held" : short ? "Not enough USDG" : `Unlock tier ${tier}`;
    button.disabled = held || short || price === 0n;
    button.addEventListener("click", () => void unlock(tier, price));
    row.append(label, button);
    tiers.append(row);
  });
  if (state.textContent === "" || state.textContent === "Nothing connected yet.") state.textContent = "Connected.";
}

async function connect(): Promise<void> {
  const state = el("state");
  try {
    state.textContent = "Asking the wallet for an account.";
    await ensureChain();
    const accounts = (await provider().request({ method: "eth_requestAccounts" })) as string[];
    const address = accounts[0];
    if (!address) throw new Error("The wallet returned no account.");
    state.textContent = "Reading the vault.";
    wallet = await readWallet(address);
    state.textContent = "Connected.";
    render();
  } catch (error) {
    state.textContent = error instanceof Error ? error.message : String(error);
  }
}

async function unlock(tier: number, price: bigint): Promise<void> {
  const state = el("state");
  if (!wallet) return;
  const { address } = wallet;
  try {
    const allowance = decodeUint(await call(config.usdg, ERC20.allowance + encodeAddress(address) + encodeAddress(config.burnVault)));
    if (allowance < price) {
      state.textContent = `Step 1 of 2: approve the vault to take ${usdg(price)} USDG. Confirm in the wallet.`;
      await send(address, config.usdg, ERC20.approve + encodeAddress(config.burnVault) + encodeUint(price));
    }
    state.textContent = `Step 2 of 2: unlock tier ${tier}. Confirm in the wallet.`;
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 20 * 60);
    const hash = await send(address, config.burnVault, UNLOCK + encodeUint(BigInt(tier)) + encodeUint(0n) + encodeUint(deadline));
    wallet = await readWallet(address);
    render();
    state.textContent = `Done. ${address.slice(0, 6)}…${address.slice(-4)} holds tier ${wallet.tier}. ${config.explorer}/tx/${hash}`;
  } catch (error) {
    state.textContent = error instanceof Error ? error.message : String(error);
  }
}

el<HTMLButtonElement>("connect").addEventListener("click", () => void connect());
el<HTMLButtonElement>("refresh").addEventListener("click", () => {
  if (wallet) void readWallet(wallet.address).then((next) => { wallet = next; render(); });
});

export {};
