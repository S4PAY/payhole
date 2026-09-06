// The link page: a tier holder signs, once, the proof that lets a phone's reporter key report for their wallet.
// The text signed is the node's membership text with the phone's key in the peer slot; nothing is sent anywhere.

import { keccak256 } from "../lib/keccak.js";
import { config } from "../lib/config.js";
import { SELECTORS, call, decodeUint, encodeAddress } from "../lib/rpc.js";

interface EthereumProvider {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
}

declare global {
  interface Window {
    ethereum?: EthereumProvider;
  }
}

const HEADER = "PayHole Sinkhole membership";
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`missing #${id}`);
  return node as T;
}

/** EIP-55 mixed-case form of an address; the proof carries addresses this way, and the phone compares them case-insensitively. */
export function checksumAddress(address: string): string {
  const lower = address.toLowerCase().replace(/^0x/, "");
  const hash = keccak256(lower).replace(/^0x/, "");
  let out = "0x";
  for (let index = 0; index < lower.length; index += 1) {
    const char = lower[index] ?? "";
    out += parseInt(hash[index] ?? "0", 16) >= 8 ? char.toUpperCase() : char;
  }
  return out;
}

export function membershipText(peerId: string, address: string, issuedAt: string): string {
  return `${HEADER}\npeer: ${peerId}\naddress: ${address}\nissued: ${issuedAt}`;
}

function provider(): EthereumProvider {
  if (!window.ethereum) throw new Error("No wallet found in this browser. Open this page in MetaMask's browser on the phone, or in a desktop browser with a wallet installed.");
  return window.ethereum;
}

async function tierOf(address: string): Promise<number | null> {
  try {
    return Number(decodeUint(await call(config.burnVault, SELECTORS.tierOf + encodeAddress(address))));
  } catch {
    return null;
  }
}

async function sign(): Promise<void> {
  const state = el("state");
  const output = el<HTMLTextAreaElement>("proof");
  output.value = "";
  el("result").style.display = "none";
  const raw = el<HTMLInputElement>("key").value.trim();
  if (!ADDRESS.test(raw)) {
    state.textContent = "Paste the reporter key from the app's Check tab first. It is a 42-character address starting with 0x.";
    return;
  }
  const peerId = checksumAddress(raw);
  try {
    state.textContent = "Asking the wallet for an account.";
    const accounts = (await provider().request({ method: "eth_requestAccounts" })) as string[];
    const holderRaw = accounts[0];
    if (!holderRaw || !ADDRESS.test(holderRaw)) throw new Error("The wallet returned no account.");
    const holder = checksumAddress(holderRaw);
    const issuedAt = new Date().toISOString();
    const text = membershipText(peerId, holder, issuedAt);
    state.textContent = `Sign the message in ${holder.slice(0, 6)}…${holder.slice(-4)}. It costs nothing and moves nothing.`;
    const hex = `0x${Array.from(new TextEncoder().encode(text), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
    const signature = (await provider().request({ method: "personal_sign", params: [hex, holderRaw] })) as string;
    if (typeof signature !== "string" || !/^0x[0-9a-fA-F]{130}$/.test(signature)) throw new Error("The wallet returned something that is not a signature.");
    output.value = JSON.stringify({ peerId, address: holder, issuedAt, signature });
    el("result").style.display = "flex";
    const tier = await tierOf(holder);
    state.textContent = tier === null ? "Signed. Could not read this wallet's tier right now." : tier > 0 ? `Signed. This wallet holds tier ${tier}, so the phone's reports will count.` : "Signed, but this wallet holds no tier yet. The proof is valid; reports from the phone count once the wallet unlocks a tier.";
  } catch (error) {
    state.textContent = error instanceof Error ? error.message : String(error);
  }
}

el<HTMLButtonElement>("sign").addEventListener("click", () => void sign());
const shareButton = el<HTMLButtonElement>("share");
if (typeof navigator.share === "function") {
  shareButton.addEventListener("click", () => {
    void navigator.share({ text: el<HTMLTextAreaElement>("proof").value }).then(
      () => {
        el("state").textContent = "Sent. Pick PayHole in the share sheet and the phone links itself.";
      },
      () => undefined,
    );
  });
} else {
  shareButton.style.display = "none";
}
el<HTMLButtonElement>("copy").addEventListener("click", () => {
  void navigator.clipboard.writeText(el<HTMLTextAreaElement>("proof").value).then(() => {
    el("state").textContent = "Copied. Paste it into the app under Your reporter key.";
  });
});
const preset = new URLSearchParams(location.search).get("key");
if (preset) el<HTMLInputElement>("key").value = preset;

export {};
