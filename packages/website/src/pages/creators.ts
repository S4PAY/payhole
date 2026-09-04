import { config } from "../lib/config.js";
import { domainHash, normalizeHostname } from "../lib/keccak.js";
import { addressUrl, call, decodeAddress, decodeUint, encodeAddress, encodeBytes, encodeUint, formatUnits, pad32, recentLogs, rpc, short, txUrl, SELECTORS, TOPICS, ZERO } from "../lib/rpc.js";

interface Attestation {
  domain: string;
  domainHash: string;
  wallet: string;
  nonce: string;
  deadline: string;
  signature: string;
  registry: string;
  verifier: string;
}

interface EthereumProvider {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
}

declare global {
  interface Window {
    ethereum?: EthereumProvider;
  }
}

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing element ${id}`);
  return el as T;
};

const form = $<HTMLFormElement>("attest-form");
const domainInput = $<HTMLInputElement>("domain");
const walletInput = $<HTMLInputElement>("wallet");
const record = $("record");
const note = $("form-note");
const result = $("result");
const rDomain = $("r-domain");
const rStatus = $("r-status");
const rTxt = $("r-txt");
const rSig = $("r-sig");
const rWallet = $("r-wallet");
const rActions = $("r-actions");
const rCalldata = $<HTMLPreElement>("r-calldata");
const rTime = $("r-time");
const rExplorer = $<HTMLAnchorElement>("r-explorer");
const claimButton = $<HTMLButtonElement>("claim");
const calldataButton = $<HTMLButtonElement>("show-calldata");
const attestButton = $<HTMLButtonElement>("attest");
const tipsNote = $("tips-note");
const tipsTable = $("tips");
const tipsEmpty = $("tips-empty");

let attestation: Attestation | null = null;

const isAddress = (value: string): boolean => /^0x[0-9a-fA-F]{40}$/.test(value);

function currentDomain(): string {
  try {
    return normalizeHostname(domainInput.value.trim() || "example.com");
  } catch {
    return "example.com";
  }
}

function refreshRecord(): void {
  const wallet = walletInput.value.trim() || "0xYourWallet";
  record.textContent = `_payhole.${currentDomain()}  TXT  "payhole=${wallet}"`;
  rDomain.textContent = currentDomain();
}

function setStatus(text: string, kind: "ok" | "danger" | "muted"): void {
  rStatus.textContent = text;
  rStatus.className = `badge${kind === "muted" ? "" : ` ${kind}`}`;
  result.style.borderColor = kind === "ok" ? "var(--accent)" : kind === "danger" ? "var(--danger)" : "var(--border)";
}

function claimCalldata(a: Attestation): string {
  return (
    SELECTORS.claim +
    pad32(a.domainHash) +
    encodeAddress(a.wallet) +
    encodeUint(BigInt(a.deadline)) +
    encodeUint(128n) +
    encodeBytes(a.signature)
  );
}

async function registeredWallet(hash: string): Promise<string> {
  return decodeAddress(await call(config.registry, SELECTORS.walletOf + pad32(hash)));
}

async function renderTips(hash: string): Promise<void> {
  Array.from(tipsTable.querySelectorAll(".tr")).forEach((el) => el.remove());
  tipsEmpty.hidden = false;
  tipsNote.textContent = `${currentDomain()} · last 9,000 blocks`;
  try {
    const logs = await recentLogs(config.registry, [TOPICS.tipped, hash]);
    if (logs.length === 0) return;
    tipsEmpty.hidden = true;
    for (const log of logs.slice(-25).reverse()) {
      const tr = document.createElement("div");
      tr.className = "tr";
      tr.style.gridTemplateColumns = "1.2fr 2fr 1fr 2fr";
      const from = decodeAddress(log.topics[2] ?? "0x");
      const amount = decodeUint(log.data);
      tr.innerHTML = "";
      const block = document.createElement("span");
      block.className = "mono";
      block.style.color = "var(--muted)";
      block.textContent = String(decodeUint(log.blockNumber));
      const fromLink = document.createElement("a");
      fromLink.className = "mono";
      fromLink.href = addressUrl(from);
      fromLink.textContent = short(from);
      const amt = document.createElement("span");
      amt.className = "mono right";
      amt.style.color = "var(--accent)";
      amt.textContent = `${formatUnits(amount, 6, 4)} USDG`;
      const tx = document.createElement("a");
      tx.className = "mono right";
      tx.style.color = "var(--muted)";
      tx.href = txUrl(log.transactionHash);
      tx.textContent = short(log.transactionHash);
      tr.append(block, fromLink, amt, tx);
      tipsTable.append(tr);
    }
  } catch (error) {
    tipsNote.textContent = `tips unavailable: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function checkRegistry(): Promise<void> {
  const domain = currentDomain();
  const hash = domainHash(domain);
  note.textContent = "";
  rDomain.textContent = domain;
  try {
    const wallet = await registeredWallet(hash);
    if (wallet.toLowerCase() === ZERO) {
      setStatus("Not registered", "muted");
      rWallet.textContent = "—";
    } else {
      setStatus("Registered", "ok");
      rWallet.textContent = wallet;
    }
    rExplorer.href = addressUrl(config.registry);
  } catch (error) {
    setStatus("Lookup failed", "danger");
    note.textContent = error instanceof Error ? error.message : String(error);
  }
  await renderTips(hash);
}

async function requestAttestation(): Promise<void> {
  const domain = domainInput.value.trim();
  const wallet = walletInput.value.trim();
  note.textContent = "";
  if (!isAddress(wallet)) {
    note.textContent = "Enter the wallet as a 0x address with 40 hex characters.";
    return;
  }
  attestButton.disabled = true;
  attestButton.textContent = "Checking DNS…";
  try {
    const res = await fetch(`${config.verifierApi}/attest`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ domain, wallet }),
    });
    const body = (await res.json()) as Partial<Attestation> & { error?: string; message?: string; details?: { seen?: string[] } };
    if (!res.ok || !body.signature) {
      setStatus("Attestation refused", "danger");
      rTxt.textContent = body.error === "txt_record_missing" ? "Not found" : "—";
      rSig.textContent = "—";
      rActions.hidden = true;
      const seen = body.details?.seen?.length ? ` Records seen: ${body.details.seen.join(" | ")}` : "";
      note.textContent = `${body.message ?? `verifier answered ${res.status}`}.${seen}`;
      return;
    }
    attestation = body as Attestation;
    rDomain.textContent = attestation.domain;
    rTxt.textContent = "Found";
    rSig.textContent = `Signed, valid until ${new Date(Number(attestation.deadline) * 1000).toISOString().slice(0, 16).replace("T", " ")} UTC`;
    rTime.textContent = `attested ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC · nonce ${attestation.nonce}`;
    rActions.hidden = false;
    rCalldata.hidden = true;
    claimButton.disabled = !window.ethereum;
    claimButton.textContent = window.ethereum ? "Submit claim with browser wallet" : "No browser wallet found";
    const current = await registeredWallet(attestation.domainHash);
    if (current.toLowerCase() === attestation.wallet.toLowerCase()) {
      setStatus("Registered", "ok");
      rWallet.textContent = current;
    } else {
      setStatus("Attested, claim pending", "muted");
      rWallet.textContent = current.toLowerCase() === ZERO ? "—" : current;
    }
  } catch (error) {
    setStatus("Attestation failed", "danger");
    note.textContent = error instanceof Error ? error.message : String(error);
  } finally {
    attestButton.disabled = false;
    attestButton.textContent = "Request attestation";
  }
}

async function ensureChain(provider: EthereumProvider): Promise<void> {
  const hex = "0x" + config.chainId.toString(16);
  const current = (await provider.request({ method: "eth_chainId" })) as string;
  if (current.toLowerCase() === hex) return;
  try {
    await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: hex }] });
  } catch {
    await provider.request({
      method: "wallet_addEthereumChain",
      params: [{ chainId: hex, chainName: "Robinhood Chain", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: [config.rpc], blockExplorerUrls: [config.explorer] }],
    });
  }
}

async function submitClaim(): Promise<void> {
  if (!attestation || !window.ethereum) return;
  const provider = window.ethereum;
  claimButton.disabled = true;
  claimButton.textContent = "Confirm in your wallet…";
  try {
    await ensureChain(provider);
    const accounts = (await provider.request({ method: "eth_requestAccounts" })) as string[];
    const from = accounts[0];
    if (!from) throw new Error("no account");
    const hash = (await provider.request({
      method: "eth_sendTransaction",
      params: [{ from, to: config.registry, data: claimCalldata(attestation) }],
    })) as string;
    rTime.innerHTML = "";
    const link = document.createElement("a");
    link.href = txUrl(hash);
    link.textContent = `claim sent ${short(hash)}`;
    link.style.color = "var(--accent)";
    rTime.append(link);
    claimButton.textContent = "Waiting for confirmation…";
    for (let i = 0; i < 60; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      const receipt = (await rpc<{ status?: string } | null>("eth_getTransactionReceipt", [hash]));
      if (receipt) {
        if (receipt.status === "0x1") {
          setStatus("Registered", "ok");
          rWallet.textContent = attestation.wallet;
          claimButton.textContent = "Claimed";
          void renderTips(attestation.domainHash);
        } else {
          setStatus("Claim reverted", "danger");
          claimButton.disabled = false;
          claimButton.textContent = "Submit claim with browser wallet";
        }
        return;
      }
    }
    claimButton.textContent = "Still pending; check the explorer";
  } catch (error) {
    note.textContent = error instanceof Error ? error.message : String(error);
    claimButton.disabled = false;
    claimButton.textContent = "Submit claim with browser wallet";
  }
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  void requestAttestation();
});
$("check").addEventListener("click", () => void checkRegistry());
domainInput.addEventListener("input", refreshRecord);
walletInput.addEventListener("input", refreshRecord);
claimButton.addEventListener("click", () => void submitClaim());
calldataButton.addEventListener("click", () => {
  if (!attestation) return;
  rCalldata.hidden = !rCalldata.hidden;
  rCalldata.textContent = `to: ${config.registry}\nfunction: claim(bytes32 domainHash, address wallet, uint256 deadline, bytes signature)\ndomainHash: ${attestation.domainHash}\nwallet: ${attestation.wallet}\ndeadline: ${attestation.deadline}\nsignature: ${attestation.signature}\n\ncalldata:\n${claimCalldata(attestation)}`;
});
refreshRecord();
