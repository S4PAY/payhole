# @payhole/sdk

Client library and CLI for paying x402 resources on Robinhood Chain with USDG from a PayHole BudgetAccount.

## What it does

- **x402 core** (`createX402Fetch`, `parsePaymentRequired`, `selectOffer`, `preparePayment`): follows the x402 specification, version 2 first (`PAYMENT-REQUIRED`, `PAYMENT-SIGNATURE`, `PAYMENT-RESPONSE` headers, CAIP-2 network `eip155:4663`) with version 1 compatibility (`X-PAYMENT`, JSON body, the `robinhood` slug). Only the `exact` scheme with plain EIP-3009 `transferWithAuthorization` on USDG is accepted; anything else is rejected with the reasons listed. The signed payload echoes the accepted requirements verbatim.
- **Budget bindings** (`readSessionKey`, `ensureKeyFunds`): read a session key's live headroom and pull exactly the shortfall from the BudgetAccount through `pay(key, deficit)`. The account enforces the key cap, expiry, and the global cap on-chain; a refusal becomes `PaymentRefusedError` and nothing is signed.
- **`payholeFetch`**: `fetch` that pays 402s with a session key against a BudgetAccount. Under the cap the payment is silent; over it the call throws. Takes a `cap` in USDG per call.
- **`payhole` CLI**: keeps named session keys with local spending caps, shows the pocket and every key's spend, pays a URL on demand.
- **`parseUsdg` / `formatUsdg`**: "0.50" to 6-decimal base units and back.
- **`domainHash`**: the `keccak256(lowercase hostname)` used by CreatorRegistry.

The browser extension reuses the x402 core and the ABIs; the CLI and `payholeFetch` are Node only.

## Setup

```sh
pnpm install
pnpm --filter @payhole/contracts build   # produces the artifacts the integration tests deploy
pnpm sync-abi                            # regenerates src/generated from packages/contracts (committed)
pnpm build                               # dist/, including the payhole binary
```

Requirements: Node 22 or newer (24 in this repo), pnpm, and Foundry (`anvil`) for the integration tests.

## Environment

| Variable | Meaning |
|---|---|
| `PAYHOLE_BUDGET_ACCOUNT` | Pocket (BudgetAccount) the session keys were issued on. Without it the CLI and the direct form of `payholeFetch` pay from the key's own USDG balance, which is only meant for facilitator interop checks. |
| `PAYHOLE_HOME` | Directory of the CLI key file, default `~/.payhole`. Keys live in `keys.json` there, directory mode 700, file mode 600. |
| `PAYHOLE_SESSION_KEY` | Private key to use instead of the stored keys. No local cap applies; the chain still enforces the on-chain one. |
| `PAYHOLE_RPC_URL` | RPC endpoint, default the official Robinhood Chain RPC from `config/4663.json`. |
| `PAYHOLE_CHAIN_ID`, `PAYHOLE_USDG` | Overrides for local anvil runs. |
| `SINKHOLE_ADMIN_URL` | Sinkhole admin API probed by `payhole status`, default `http://127.0.0.1:8053`. |
| `PAYHOLE_BURN_VAULT` | BurnVault address override for `payhole tier`; defaults to the deployed vault. |

## CLI

```sh
payhole key create --name research --cap 5      # created  0x9c1e…4a2f  cap 5.00 USDG (--name defaults to "default")
payhole key import --name agent --cap 1 0x...    # store an existing key under a name and cap
payhole key list                                 # name, address, spent / cap
payhole key address --key research               # the address the pocket owner registers with setSessionKey
payhole key export --key research                # the private key
payhole tier                                     # the key's unlock tier, the tier prices in USDG, its USDG and gas
payhole tier unlock 1                            # buy tier 1: approve the vault for the price, then unlock; the vault buys and burns PAYHOLE

payhole status                                   # pocket   24.88 USDG  cap 100.00  spent 0.12  0x4b86…9931
                                                 # keys     research  0.12 / 5.00  live on chain, 0.88 left
                                                 # sinkhole on

payhole pay https://example.com/article --key research
                                                 # paid     0.02 USDG  tx 0x8e2c…91ab
payhole https://example.com/article --key research          # same as pay
payhole pay <url> --key research --method POST --data '{"q":1}' --header 'content-type: application/json' --max 0.05
```

Two caps apply to a stored key. The cap given at `key create` is enforced by the CLI itself, before anything is signed, and its spend is tracked in the key file. The cap the pocket owner sets on chain with `setSessionKey` is enforced by the BudgetAccount when USDG is pulled. `--max` adds a ceiling for one call. `--key` picks a stored key; with a single key it is optional, and `PAYHOLE_SESSION_KEY` bypasses the store.

Exit codes: 0 success, 1 error, 2 payment refused (cap, policy, key not live), 3 no acceptable offer.

The session key needs a little ETH for gas: pulling USDG from the BudgetAccount is a transaction the key sends itself. Signing the x402 authorization costs nothing; the facilitator settles it.

## Library

```ts
import { payholeFetch, PaymentRefusedError } from "@payhole/sdk";

// Same signature as fetch, one extra option. Key, pocket, and RPC come from
// PAYHOLE_SESSION_KEY, PAYHOLE_BUDGET_ACCOUNT, and PAYHOLE_RPC_URL.
const res = await payholeFetch("https://api.example.com/report", {
  method: "POST",
  body: JSON.stringify({ q: "usdg volume" }),
  cap: "0.50", // max USDG for this call
});

// Or configure once and reuse:
const fetchPaid = payholeFetch({ sessionKey, budgetAccount, cap: "0.50" });
try {
  const res = await fetchPaid("https://api.example.com/paid");
} catch (e) {
  if (e instanceof PaymentRefusedError) console.log(e.reason); // max-exceeded, cap-exceeded, key-not-live, ...
}
```

`cap` takes a USDG decimal as a string or number; `maxAmount` takes base units, and the lower of the two applies. An `authorize` callback runs after the cap check and before any funds move, for policies of your own.

Lower-level pieces for other integrations, all isomorphic:

```ts
import { parsePaymentRequired, selectOffer, preparePayment, USDG_ADDRESS } from "@payhole/sdk";

const required = parsePaymentRequired((n) => res.headers.get(n), await res.text());
const offer = selectOffer(required!, { chainId: 4663, asset: USDG_ADDRESS });
const payment = await preparePayment(signer, offer); // headerName, headerValue, authorization, signature
```

## Tests

```sh
pnpm test        # vitest: unit tests plus an anvil-backed integration suite
pnpm typecheck
pnpm lint
```

The integration suite starts anvil with chain id 4663, deploys `MockUSDG` (EIP-3009) and `BudgetAccountFactory` from the Foundry artifacts, runs a mock x402 resource server with an embedded facilitator that verifies the typed-data signature and settles through `transferWithAuthorization`, and then proves: silent payment under the cap (v2 and v1), settlement reported back, refusal once the cap is spent with no signature sent, refusal of a revoked key, refusal of a foreign asset, `cap` and `--max`, the direct form of `payholeFetch` configured from the environment, and the CLI's key store, status lines, local cap accounting, and exit codes.

## Facilitator interop

Naven and Primer run standard `exact` facilitators on chain 4663. Naven serves a public test 402 at `https://api.naven.network/x402-test/ping` priced at 0.0001 USDG. With a key holding a little USDG and no `PAYHOLE_BUDGET_ACCOUNT` set:

```sh
PAYHOLE_SESSION_KEY=0x... payhole pay https://api.naven.network/x402-test/ping
```

This spends real USDG and is run only on explicit go-ahead.
