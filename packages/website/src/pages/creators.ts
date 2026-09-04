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
const rCalldata = $<HTMLPreElement>("r-calldata");
const rTime = $("r-time");
const rExplorer = $<HTMLAnchorElement>("r-explorer");
const attestButton = $<HTMLButtonElement>("attest");
const checkButton = $<HTMLButtonElement>("check");
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
  tipsNote.textContent = `${currentDomain()} · recent blocks`;
}

function setStatus(text: string, kind: "ok" | "danger" | "muted"): void {
  const color = kind === "ok" ? "var(--accent-text)" : kind === "danger" ? "#FF4D4D" : "var(--muted)";
  const border = kind === "ok" ? "var(--accent)" : kind === "danger" ? "#FF4D4D" : "var(--border)";
  rStatus.textContent = text;
  rStatus.style.color = color;
  rStatus.style.borderColor = border;
  result.style.borderColor = border;
  rTxt.style.color = color;
  rSig.style.color = color;
}

function setNote(text: string): void {
  note.textContent = text;
  note.classList.toggle("ph-hidden", text.length === 0);
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
  Array.from(tipsTable.querySelectorAll("[data-row]")).forEach((el) => el.remove());
  tipsEmpty.classList.remove("ph-hidden");
  try {
    const logs = await recentLogs(config.registry, [TOPICS.tipped, hash]);
    if (logs.length === 0) return;
    tipsEmpty.classList.add("ph-hidden");
    for (const log of logs.slice(-25).reverse()) {
      const tr = document.createElement("div");
      tr.dataset["row"] = "1";
      tr.setAttribute("style", "display:grid;grid-template-columns:1.2fr 2fr 1fr 2fr;padding:16px 24px;border-top:1px solid var(--border);font:400 14px 'JetBrains Mono';align-items:center");
      const from = decodeAddress(log.topics[2] ?? "0x");
      const amount = decodeUint(log.data);
      tr.innerHTML = "";
      const block = document.createElement("span");
      block.style.color = "var(--muted)";
      block.textContent = String(decodeUint(log.blockNumber));
      const fromLink = document.createElement("a");
      fromLink.href = addressUrl(from);
      fromLink.textContent = short(from);
      const amt = document.createElement("span");
      amt.style.textAlign = "right";
      amt.style.color = "var(--accent-text)";
      amt.textContent = `${formatUnits(amount, 6, 4)} USDG`;
      const tx = document.createElement("a");
      tx.style.textAlign = "right";
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

/** "Check DNS only": asks the verifier without submitting anything and shows what the registry holds. */
async function checkOnly(): Promise<void> {
  const domain = currentDomain();
  const hash = domainHash(domain);
  setNote("");
  rDomain.textContent = domain;
  checkButton.disabled = true;
  try {
    const wallet = walletInput.value.trim();
    if (isAddress(wallet)) {
      const res = await fetch(`${config.verifierApi}/attest`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ domain, wallet }),
      });
      const body = (await res.json()) as { error?: string; message?: string; details?: { seen?: string[] } };
      rTxt.textContent = res.ok ? "Found" : body.error === "txt_record_missing" ? "Not found" : "—";
      if (!res.ok) setNote(`${body.message ?? `verifier answered ${res.status}`}${body.details?.seen?.length ? ` Records seen: ${body.details.seen.join(" | ")}` : ""}`);
    } else {
      rTxt.textContent = "—";
    }
    const registered = await registeredWallet(hash);
    if (registered.toLowerCase() === ZERO) {
      setStatus("Not registered", "muted");
      rWallet.textContent = "—";
    } else {
      setStatus("Registered", "ok");
      rWallet.textContent = registered;
    }
    rExplorer.href = addressUrl(config.registry);
  } catch (error) {
    setStatus("Lookup failed", "danger");
    setNote(error instanceof Error ? error.message : String(error));
  } finally {
    checkButton.disabled = false;
  }
  await renderTips(hash);
}

/** "Sign and verify": the verifier signs the attestation, then a browser wallet submits the claim. */
async function requestAttestation(): Promise<void> {
  const domain = domainInput.value.trim();
  const wallet = walletInput.value.trim();
  setNote("");
  if (!isAddress(wallet)) {
    setNote("Enter the wallet as a 0x address with 40 hex characters.");
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
      const seen = body.details?.seen?.length ? ` Records seen: ${body.details.seen.join(" | ")}` : "";
      setNote(`${body.message ?? `verifier answered ${res.status}`}.${seen}`);
      return;
    }
    attestation = body as Attestation;
    rDomain.textContent = attestation.domain;
    rTxt.textContent = "Found";
    rSig.textContent = `Signed, valid until ${new Date(Number(attestation.deadline) * 1000).toISOString().slice(0, 16).replace("T", " ")} UTC`;
    rSig.textContent = "Valid";
    rTime.textContent = `attested ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC · nonce ${attestation.nonce}`;
    const current = await registeredWallet(attestation.domainHash);
    if (current.toLowerCase() === attestation.wallet.toLowerCase()) {
      setStatus("Registered", "ok");
      rWallet.textContent = current;
      return;
    }
    setStatus("Attested, claim pending", "muted");
    rWallet.textContent = current.toLowerCase() === ZERO ? "—" : current;
    if (window.ethereum) {
      await submitClaim();
    } else {
      rCalldata.classList.remove("ph-hidden");
      rCalldata.textContent = `No browser wallet found. Submit the claim from any wallet:\nto: ${config.registry}\nfunction: claim(bytes32 domainHash, address wallet, uint256 deadline, bytes signature)\ndomainHash: ${attestation.domainHash}\nwallet: ${attestation.wallet}\ndeadline: ${attestation.deadline}\nsignature: ${attestation.signature}\n\ncalldata:\n${claimCalldata(attestation)}`;
    }
  } catch (error) {
    setStatus("Attestation failed", "danger");
    setNote(error instanceof Error ? error.message : String(error));
  } finally {
    attestButton.disabled = false;
    attestButton.textContent = "Sign and verify";
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
  attestButton.textContent = "Confirm in your wallet…";
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
    attestButton.textContent = "Waiting for confirmation…";
    for (let i = 0; i < 60; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      const receipt = await rpc<{ status?: string } | null>("eth_getTransactionReceipt", [hash]);
      if (receipt) {
        if (receipt.status === "0x1") {
          setStatus("Registered", "ok");
          rWallet.textContent = attestation.wallet;
          void renderTips(attestation.domainHash);
        } else {
          setStatus("Claim reverted", "danger");
        }
        return;
      }
    }
    setNote("The claim is still pending; check the explorer.");
  } catch (error) {
    setNote(error instanceof Error ? error.message : String(error));
    rCalldata.classList.remove("ph-hidden");
    rCalldata.textContent = `Submit the claim from any wallet:\nto: ${config.registry}\ncalldata:\n${claimCalldata(attestation)}`;
  }
}

attestButton.addEventListener("click", () => void requestAttestation());
checkButton.addEventListener("click", () => void checkOnly());
domainInput.addEventListener("input", refreshRecord);
walletInput.addEventListener("input", refreshRecord);
refreshRecord();
