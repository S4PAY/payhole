/**
 * Anvil-backed run of the background payment core without browser APIs: MockUSDG and BudgetAccountFactory from
 * the Foundry artifacts, the owner's account funded from the test mnemonic, a mock x402 server with an embedded
 * facilitator. Proves the per-site address is funded under the cap, the payment settles, and an over-cap offer is
 * refused when the prompt is declined.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { type Address, type PublicClient } from "viem";
import { budgetAccountAbi, parsePaymentRequired, parseSettleResponse } from "@payhole/sdk";
import { createSiteFunder, readSite, BudgetError } from "../lib/budget";
import { originAccount, ownerAccount, seedFromMnemonic } from "../lib/keys";
import { Ledger } from "../lib/ledger";
import { PaymentCore, type PaymentOutcome } from "../lib/payments";
import { memoryStore } from "../lib/storage";
import { startAnvil, type AnvilHandle } from "./helpers/anvil";
import { balanceOf, CHAIN_ID, deployBudget, MERCHANT, TEST_MNEMONIC, wallet, type Deployed } from "./helpers/chain";
import { startMockX402Server, type MockServer } from "./helpers/mockServer";

const ANVIL_PORT = 8565;
const PRICE = 250_000n; // 0.25 USDG
const CHUNK = 500_000n; // 0.5 USDG top-up chunk
const SITE_CAP = 1_000_000n; // 1 USDG per site

let anvil: AnvilHandle;
let deployed: Deployed;
let publicClient: PublicClient;
let server: MockServer;
let seed: Uint8Array;

const ORIGIN = () => new URL(server.url).origin;

beforeAll(async () => {
  anvil = await startAnvil(ANVIL_PORT, CHAIN_ID);
  deployed = await deployBudget(anvil.rpcUrl, { mint: 1_000_000_000n, deposit: 100_000_000n });
  publicClient = deployed.publicClient;
  seed = await seedFromMnemonic(TEST_MNEMONIC);
  expect(ownerAccount(TEST_MNEMONIC).address).toBe(deployed.owner.address);
  server = await startMockX402Server({
    publicClient,
    relayer: wallet(deployed.relayer, anvil.rpcUrl),
    asset: deployed.usdg,
    payTo: MERCHANT,
    amount: PRICE,
    chainId: CHAIN_ID,
    version: 2,
    port: 8566,
  });
});

afterAll(async () => {
  await server?.close();
  await anvil?.stop();
});

async function buildCore(options: { siteCap?: bigint; approve?: boolean; paused?: boolean }) {
  const ledger = new Ledger(memoryStore());
  await ledger.load();
  const prompt = vi.fn(() => Promise.resolve(options.approve ?? false));
  const ownerCtx = {
    publicClient,
    walletClient: wallet(ownerAccount(TEST_MNEMONIC), anvil.rpcUrl),
    usdg: deployed.usdg,
    budgetAccount: deployed.budgetAccount,
  };
  const core = new PaymentCore({
    chainId: CHAIN_ID,
    usdg: deployed.usdg,
    signerFor: (origin) => originAccount(seed, origin),
    funder: createSiteFunder(ownerCtx, { topUpChunk: CHUNK }),
    ledger,
    policy: () => ({ paused: options.paused ?? false, globalCap: 25_000_000n, siteCap: () => options.siteCap ?? SITE_CAP, isBlocked: () => false }),
    prompt,
  });
  return { core, ledger, prompt, ownerCtx };
}

/** What the background does for a page request: parse the 402, run the core, retry with the header. */
async function payWithCore(core: PaymentCore, path: string, tabId: number): Promise<{ outcome: PaymentOutcome; response: Response }> {
  const url = `${server.url}${path}`;
  const first = await fetch(url);
  expect(first.status).toBe(402);
  const required = parsePaymentRequired((n) => first.headers.get(n), await first.text());
  if (!required) throw new Error("no payment request");
  const outcome = await core.handle({ requestId: `${tabId}-${path}-${Date.now()}`, tabId, url, origin: ORIGIN(), paymentRequired: required });
  if (outcome.kind !== "pay") return { outcome, response: first };
  const response = await fetch(url, { headers: { [outcome.headerName]: outcome.headerValue } });
  await core.recordSettlement(outcome.ledgerId, (n) => response.headers.get(n), response.status);
  return { outcome, response };
}

describe("payment core against anvil", () => {
  it("funds the per-site address under the cap and settles the payment", async () => {
    const { core, ledger, prompt } = await buildCore({});
    const site = await originAccount(seed, ORIGIN());
    expect(await balanceOf(publicClient, deployed.usdg, site.address)).toBe(0n);
    const merchantBefore = await balanceOf(publicClient, deployed.usdg, MERCHANT);

    const { outcome, response } = await payWithCore(core, "/paid", 1);
    expect(outcome.kind).toBe("pay");
    if (outcome.kind !== "pay") return;
    expect(outcome.payer).toBe(site.address);
    expect(outcome.funding.funded).toBe(CHUNK);
    expect(outcome.funding.txHashes).toHaveLength(2); // setSiteCap then fund
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, paid: PRICE.toString() });
    const settlement = parseSettleResponse((n) => response.headers.get(n));
    expect(settlement?.success).toBe(true);
    expect(await balanceOf(publicClient, deployed.usdg, MERCHANT)).toBe(merchantBefore + PRICE);
    expect(await balanceOf(publicClient, deployed.usdg, site.address)).toBe(CHUNK - PRICE);
    const onChain = await readSite({ publicClient, usdg: deployed.usdg, budgetAccount: deployed.budgetAccount }, site.address);
    expect(onChain.cap).toBe(SITE_CAP);
    expect(onChain.funded).toBe(CHUNK);
    expect(prompt).not.toHaveBeenCalled();
    expect(ledger.spentFor(ORIGIN())).toBe(PRICE);
    expect(ledger.recent(1)[0]).toMatchObject({ status: "settled", txHash: settlement?.transaction });
    expect(server.stats).toMatchObject({ payments: 1, settled: 1, rejected: [] });

    // the second payment is covered by the site's remaining balance: no funding transaction
    const second = await payWithCore(core, "/paid?n=2", 1);
    expect(second.outcome.kind).toBe("pay");
    if (second.outcome.kind === "pay") expect(second.outcome.funding.funded).toBe(0n);
    expect(second.response.status).toBe(200);
    expect(await balanceOf(publicClient, deployed.usdg, site.address)).toBe(CHUNK - 2n * PRICE);
    expect(ledger.spentFor(ORIGIN())).toBe(2n * PRICE);
  });

  it("refuses an over-cap offer when the prompt is declined and signs nothing", async () => {
    const { core, ledger, prompt } = await buildCore({ siteCap: 100_000n });
    const payments = server.stats.payments;
    const { outcome, response } = await payWithCore(core, "/paid?over=1", 2);
    expect(outcome).toEqual({ kind: "refused", reason: "declined by the user" });
    expect(prompt).toHaveBeenCalledTimes(1);
    expect(response.status).toBe(402);
    expect(server.stats.payments).toBe(payments);
    expect(ledger.spentFor(ORIGIN())).toBe(0n);
    expect(ledger.recent(1)[0]?.status).toBe("refused");
  });

  it("pays an approved over-cap offer once", async () => {
    const { core, prompt } = await buildCore({ siteCap: 100_000n, approve: true });
    const { outcome, response } = await payWithCore(core, "/paid?approved=1", 3);
    expect(outcome.kind).toBe("pay");
    expect(prompt).toHaveBeenCalledTimes(1);
    expect(response.status).toBe(200);
  });

  it("reports missing gas and an empty account clearly", async () => {
    const funder = createSiteFunder(
      {
        publicClient,
        walletClient: wallet(ownerAccount(TEST_MNEMONIC), anvil.rpcUrl),
        usdg: deployed.usdg,
        budgetAccount: deployed.budgetAccount,
      },
      { topUpChunk: CHUNK },
    );
    const site = (await originAccount(seed, "https://empty.example")).address;
    // the account holds 100 USDG; ask for more than it has
    const error = await funder.ensure(site, 200_000_000n, 500_000_000n).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(BudgetError);
    expect((error as BudgetError).code).toBe("no-usdg");
    expect((error as BudgetError).message).toContain("top it up");

    // a site whose on-chain cap is exhausted
    const capped = (await originAccount(seed, "https://capped.example")).address;
    const exhausted = await funder.ensure(capped, PRICE, 0n).catch((e: unknown) => e);
    expect(exhausted).toBeInstanceOf(BudgetError);
    expect((exhausted as BudgetError).code).toBe("site-cap");

    // an owner without ETH
    const poor = wallet(ownerAccount("legal winner thank year wave sausage worth useful legal winner thank yellow"), anvil.rpcUrl);
    const poorFunder = createSiteFunder({ publicClient, walletClient: poor, usdg: deployed.usdg, budgetAccount: deployed.budgetAccount }, { topUpChunk: CHUNK });
    const noGas = await poorFunder.ensure(site, PRICE, SITE_CAP).catch((e: unknown) => e);
    expect(noGas).toBeInstanceOf(BudgetError);
    expect((noGas as BudgetError).code).toBe("no-gas");
  });

  it("keeps the global cap on chain intact for agents", async () => {
    const globalSpent = await publicClient.readContract({ address: deployed.budgetAccount, abi: budgetAccountAbi, functionName: "globalSpent" });
    expect(globalSpent).toBe(0n);
    const usdg: Address = deployed.usdg;
    expect(await balanceOf(publicClient, usdg, deployed.budgetAccount)).toBeLessThan(100_000_000n);
  });
});
