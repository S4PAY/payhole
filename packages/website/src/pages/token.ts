import { config } from "../lib/config.js";
import { renderLiveValues } from "../lib/live.js";
import { decodeAddress, decodeUint, formatUnits, recentLogs, short, txUrl, TOPICS, ZERO } from "../lib/rpc.js";

function row(cells: (string | HTMLElement)[], columns: string): HTMLElement {
  const tr = document.createElement("div");
  tr.setAttribute("style", `display:grid;grid-template-columns:${columns};padding:16px 24px;border-top:1px solid var(--border);font:400 14px 'JetBrains Mono';align-items:center`);
  for (const cell of cells) {
    if (typeof cell === "string") {
      const span = document.createElement("span");
      span.textContent = cell;
      tr.append(span);
    } else {
      tr.append(cell);
    }
  }
  return tr;
}

function link(href: string, text: string, className = ""): HTMLElement {
  const a = document.createElement("a");
  a.href = href;
  a.textContent = text;
  a.className = className;
  a.style.textAlign = "right";
  a.style.color = "var(--muted)";
  return a;
}

async function renderFeed(decimals: number): Promise<void> {
  const feed = document.getElementById("feed");
  const empty = document.getElementById("feed-empty");
  const note = document.getElementById("feed-note");
  if (!feed || !empty) return;
  try {
    const logs = await recentLogs(config.burnVault, [TOPICS.burned]);
    if (note) note.textContent = `live from BurnVault · last 9,000 blocks · ${logs.length} burn${logs.length === 1 ? "" : "s"}`;
    if (logs.length === 0) return;
    empty.classList.add("ph-hidden");
    for (const log of logs.slice(-25).reverse()) {
      const tokenIn = decodeAddress(log.topics[2] ?? "0x");
      const amountIn = decodeUint("0x" + log.data.slice(2, 66));
      const burned = decodeUint("0x" + log.data.slice(66, 130));
      let input: string;
      if (tokenIn.toLowerCase() === ZERO) input = `burnWith · ${formatUnits(amountIn, 18, 4)} ETH`;
      else if (tokenIn.toLowerCase() === config.usdg.toLowerCase()) input = `burnWith · ${formatUnits(amountIn, 6)} USDG`;
      else input = amountIn === burned ? "burnDirect or unlock" : `burnWith · ${formatUnits(amountIn, decimals)} PAYHOLE`;
      const amount = document.createElement("span");
      amount.style.textAlign = "right";
      amount.style.color = "#FF9E3D";
      amount.textContent = `${formatUnits(burned, decimals, 2)} PAYHOLE`;
      feed.append(
        row(
          [String(decodeUint(log.blockNumber)), input, amount, link(txUrl(log.transactionHash), short(log.transactionHash), "")],
          "1.2fr 1.6fr 1.4fr 2fr",
        ),
      );
    }
  } catch (error) {
    if (note) note.textContent = `feed unavailable: ${error instanceof Error ? error.message : String(error)}`;
  }
}

void (async () => {
  const info = await renderLiveValues();
  await renderFeed(info?.decimals ?? 18);
})();
