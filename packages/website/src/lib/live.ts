import { config } from "./config.js";
import { call, decodeAddress, decodeUint, encodeAddress, encodeUint, formatUnits, DEAD, SELECTORS, ZERO } from "./rpc.js";

export interface TokenInfo {
  address: string;
  decimals: number;
  symbol: string;
  supply: bigint;
  burned: bigint;
}

/** The $PayHole token address from BurnVault, or the zero address before the Safe sets it. */
export async function tokenAddress(): Promise<string> {
  return decodeAddress(await call(config.burnVault, SELECTORS.token));
}

export async function tokenInfo(address: string): Promise<TokenInfo> {
  const [decimals, supply, burned] = await Promise.all([
    call(address, SELECTORS.decimals).then(decodeUint),
    call(address, SELECTORS.totalSupply).then(decodeUint),
    call(address, SELECTORS.balanceOf + encodeAddress(DEAD)).then(decodeUint),
  ]);
  return { address, decimals: Number(decimals), symbol: "PAYHOLE", supply, burned };
}

export function tierCost(tier: number): Promise<bigint> {
  return call(config.burnVault, SELECTORS.tierCost + encodeUint(BigInt(tier))).then(decodeUint);
}

/** Fills the total-burned figure and the tier price cells present on the page. */
export async function renderLiveValues(): Promise<TokenInfo | null> {
  const burnedEl = document.getElementById("burned");
  const noteEl = document.getElementById("burned-note");
  const tierCells = document.querySelectorAll<HTMLElement>("[data-tier]");
  const addressEl = document.getElementById("token-address");
  let info: TokenInfo | null = null;
  try {
    const address = await tokenAddress();
    if (address.toLowerCase() === ZERO) {
      if (burnedEl) burnedEl.textContent = "0";
    } else {
      info = await tokenInfo(address);
      if (burnedEl) burnedEl.textContent = formatUnits(info.burned, info.decimals, 0);
      if (noteEl) {
        const pct = info.supply > 0n ? Number((info.burned * 10_000n) / info.supply) / 100 : 0;
        noteEl.textContent = `live · ${info.symbol} · fixed supply · ${pct.toFixed(2)}% of supply burned`;
      }
      if (addressEl) {
        addressEl.innerHTML = "";
        const link = document.createElement("a");
        link.href = `${config.explorer}/token/${address}`;
        link.textContent = address;
        link.className = "mono";
        addressEl.append("Token: ", link);
      }
    }
    const decimals = info?.decimals ?? 18;
    await Promise.all(
      Array.from(tierCells).map(async (cell) => {
        const tier = Number(cell.dataset["tier"]);
        const cost = await tierCost(tier);
        if (cost !== 0n) cell.textContent = formatUnits(cost, decimals, 0);
      }),
    );
  } catch (error) {
    console.warn("live values unavailable", error);
  }
  return info;
}
