// Runs the BurnVault owner calls through the PayHole Safe from one of its owner wallets. The Safe has a
// threshold of one, so an owner can execute directly: execTransaction accepts a "pre-validated" signature
// (r = the owner's address, s = 0, v = 1) when that owner is the caller. Nothing here holds a key.
(() => {
  const CHAIN_ID_HEX = "0x1237";
  const CHAIN = {
    chainId: CHAIN_ID_HEX,
    chainName: "Robinhood Chain",
    rpcUrls: ["https://rpc.mainnet.chain.robinhood.com"],
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    blockExplorerUrls: ["https://robinhoodchain.blockscout.com"],
  };
  const SAFE = "0xfCeB8905E316D383Cd90Aa1Ab04ab1650611445b";
  const OWNERS = ["0xEfAdD0940eA9EaF1c4A3FDb9778C115A5793b7e9", "0x83f8860318841B608C4701aAf477C866eC44429e"];
  const VAULT = "0x80d9BC2412853030f259eA7056654888b2B0D768";
  const TOKEN = "0x292a1edc920745c055670bb9a91c910a3669b7ce";
  const CALLS = [
    { name: "Set the token", detail: "setToken(PAYHOLE " + TOKEN + ")", data: "0x144fa6d7000000000000000000000000292a1edc920745c055670bb9a91c910a3669b7ce", once: true },
    { name: "Price tier 1 at 10 USDG", detail: "setTierPrice(1, 10000000)", data: "0x4a5c6f8c00000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000989680", tier: 1, price: 10000000n },
    { name: "Price tier 2 at 50 USDG", detail: "setTierPrice(2, 50000000)", data: "0x4a5c6f8c00000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000002faf080", tier: 2, price: 50000000n },
    { name: "Price tier 3 at 250 USDG", detail: "setTierPrice(3, 250000000)", data: "0x4a5c6f8c0000000000000000000000000000000000000000000000000000000000000003000000000000000000000000000000000000000000000000000000000ee6b280", tier: 3, price: 250000000n },
  ];

  const $ = (id) => document.getElementById(id);
  const log = (line) => { const el = $("log"); el.textContent += line + "\n"; el.scrollTop = el.scrollHeight; };
  const strip = (h) => h.replace(/^0x/, "");
  const word = (hex) => strip(hex).padStart(64, "0");
  const addrWord = (a) => word(a.toLowerCase());
  const uintWord = (n) => word(BigInt(n).toString(16));
  const padBytes = (hex) => { const h = strip(hex); return h + "0".repeat((64 - (h.length % 64)) % 64); };

  let account = null;
  const state = { token: null, prices: {} };

  function execTransactionData(to, data, owner) {
    const dataHex = strip(data);
    const dataTail = uintWord(dataHex.length / 2) + padBytes(dataHex);
    const sig = addrWord(owner) + "0".repeat(64) + "01";
    const sigTail = uintWord(65) + padBytes(sig);
    const dataOffset = 10 * 32;
    const sigOffset = dataOffset + dataTail.length / 2;
    const head = addrWord(to) + uintWord(0) + uintWord(dataOffset) + uintWord(0) + uintWord(0) + uintWord(0) + uintWord(0)
      + uintWord(0) + uintWord(0) + uintWord(sigOffset);
    return "0x6a761202" + head + dataTail + sigTail;
  }

  async function rpc(method, params) {
    if (!window.ethereum) throw new Error("No wallet found in this browser. Open this page inside the MetaMask app's browser, or in a desktop browser with MetaMask installed.");
    return window.ethereum.request({ method, params });
  }

  async function ensureChain() {
    const current = await rpc("eth_chainId", []);
    if (current === CHAIN_ID_HEX) return;
    try {
      await rpc("wallet_switchEthereumChain", [{ chainId: CHAIN_ID_HEX }]);
    } catch (error) {
      if (error && (error.code === 4902 || /unrecognized|not added|4902/i.test(String(error.message)))) {
        await rpc("wallet_addEthereumChain", [CHAIN]);
        await rpc("wallet_switchEthereumChain", [{ chainId: CHAIN_ID_HEX }]);
      } else {
        throw error;
      }
    }
  }

  const call = (to, data) => rpc("eth_call", [{ to, data }, "latest"]);

  async function readVault() {
    try {
      const token = await call(VAULT, "0xfc0c546a");
      state.token = "0x" + strip(token).slice(24);
      const isSet = !/^0x0{40}$/.test(state.token);
      $("token").textContent = isSet ? state.token : "not set";
      $("token").className = isSet ? "" : "muted";
      for (const tier of [1, 2, 3]) {
        const price = BigInt(await call(VAULT, "0x8b542526" + uintWord(tier)));
        state.prices[tier] = price;
        const el = $("tier" + tier);
        el.textContent = price === 0n ? "not priced" : (Number(price) / 1e6).toFixed(2) + " USDG";
        el.className = price === 0n ? "muted" : "";
      }
      renderSteps();
    } catch (error) {
      log("read failed: " + (error.message || error));
    }
  }

  function done(i) {
    const c = CALLS[i];
    if (c.once) return state.token !== null && !/^0x0{40}$/.test(state.token);
    return state.prices[c.tier] === c.price;
  }

  function renderSteps() {
    const isOwner = account && OWNERS.some((o) => o.toLowerCase() === account.toLowerCase());
    const box = $("steps");
    box.innerHTML = "";
    CALLS.forEach((c, i) => {
      const row = document.createElement("div");
      row.className = "step" + (done(i) ? " done" : "");
      const n = document.createElement("span"); n.className = "n"; n.textContent = String(i + 1);
      const what = document.createElement("div"); what.className = "what";
      const b = document.createElement("b"); b.textContent = c.name;
      const small = document.createElement("small"); small.textContent = c.detail;
      what.append(b, small);
      const btn = document.createElement("button");
      btn.textContent = done(i) ? "Done" : "Send";
      btn.disabled = done(i) || !isOwner;
      btn.addEventListener("click", () => execute(i, btn));
      row.append(n, what, btn);
      box.append(row);
    });
  }

  async function waitReceipt(hash) {
    for (let i = 0; i < 120; i++) {
      const receipt = await rpc("eth_getTransactionReceipt", [hash]);
      if (receipt) return receipt;
      await new Promise((r) => setTimeout(r, 1500));
    }
    throw new Error("still pending after three minutes; check the explorer for " + hash);
  }

  async function execute(i, btn) {
    const c = CALLS[i];
    const status = $("exec-status");
    try {
      await ensureChain();
      btn.disabled = true;
      status.className = "status";
      status.textContent = "Confirm " + c.name.toLowerCase() + " in your wallet.";
      const data = execTransactionData(VAULT, c.data, account);
      const hash = await rpc("eth_sendTransaction", [{ from: account, to: SAFE, value: "0x0", data }]);
      log("sent " + c.name + ": " + hash);
      status.textContent = "Sent. Waiting for the chain.";
      const receipt = await waitReceipt(hash);
      if (receipt.status !== "0x1") throw new Error("the transaction reverted; the vault did not change");
      status.className = "status ok";
      status.textContent = c.name + " confirmed in block " + parseInt(receipt.blockNumber, 16) + ".";
      log("confirmed in block " + parseInt(receipt.blockNumber, 16));
    } catch (error) {
      status.className = "status bad";
      status.textContent = (error && error.message) ? error.message : String(error);
      log("failed: " + status.textContent);
    }
    await readVault();
  }

  async function connect() {
    const status = $("connect-status");
    try {
      status.className = "status";
      status.textContent = "Asking the wallet.";
      const accounts = await rpc("eth_requestAccounts", []);
      account = accounts[0];
      await ensureChain();
      const chainId = await rpc("eth_chainId", []);
      $("network").textContent = chainId === CHAIN_ID_HEX ? "Robinhood Chain" : "wrong network " + chainId;
      $("network").className = "pill " + (chainId === CHAIN_ID_HEX ? "ok" : "bad");
      const isOwner = OWNERS.some((o) => o.toLowerCase() === account.toLowerCase());
      $("account").textContent = account;
      $("account").className = "pill " + (isOwner ? "ok" : "bad");
      status.className = "status " + (isOwner ? "ok" : "bad");
      status.textContent = isOwner
        ? "This wallet owns the Safe. You can send the calls."
        : "This address is not one of the two owners. Switch the wallet to the account that holds owner A or owner B and connect again.";
      log("connected " + account + (isOwner ? " (owner)" : " (not an owner)"));
      renderSteps();
      await readVault();
    } catch (error) {
      status.className = "status bad";
      status.textContent = (error && error.message) ? error.message : String(error);
    }
  }

  $("safe").textContent = SAFE;
  $("ownerA").textContent = OWNERS[0];
  $("ownerB").textContent = OWNERS[1];
  $("vault").textContent = VAULT;
  $("connect").addEventListener("click", connect);
  $("refresh").addEventListener("click", readVault);
  if (window.ethereum && window.ethereum.on) {
    window.ethereum.on("accountsChanged", () => { account = null; $("account").textContent = "not connected"; $("account").className = "pill"; renderSteps(); });
    window.ethereum.on("chainChanged", () => { $("network").textContent = "network changed, connect again"; $("network").className = "pill"; });
  }
  renderSteps();
  if (window.ethereum) rpc("eth_chainId", []).then((id) => { if (id === CHAIN_ID_HEX) readVault(); }).catch(() => {});
})();
