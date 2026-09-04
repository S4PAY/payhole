# @payhole/sdk

Client library and CLI for paying x402 resources on Robinhood Chain with USDG from a PayHole BudgetAccount.

## What it does

- **x402 core** (`createX402Fetch`, `parsePaymentRequired`, `selectOffer`, `preparePayment`): follows the x402 specification, version 2 first (`PAYMENT-REQUIRED`, `PAYMENT-SIGNATURE`, `PAYMENT-RESPONSE` headers, CAIP-2 network `eip155:4663`) with version 1 compatibility (`X-PAYMENT`, JSON body, the `robinhood` slug). Only the `exact` scheme with plain EIP-3009 `transferWithAuthorization` on USDG is accepted; anything else is rejected with the reasons listed. The signed payload echoes the accepted requirements verbatim.
- **Budget bindings** (`readSessionKey`, `ensureKeyFunds`): read a session key's live headroom and pull exactly the shortfall from the BudgetAccount through `pay(key, deficit)`. The account enforces the key cap, expiry, and the global cap on-chain; a refusal becomes `PaymentRefusedError` and nothing is signed.
- **`payholeFetch`**: `fetch` that pays 402s with a session key against a BudgetAccount. Under the cap the payment is silent; over it the call throws.
- **`payhole` CLI**: holds a session key, shows remaining cap, pays a URL on demand.
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
| `PAYHOLE_BUDGET_ACCOUNT` | BudgetAccount the session key was issued on. Without it the CLI pays from the key's own USDG balance, which is only meant for facilitator interop checks. |
| `PAYHOLE_KEY_FILE` | Session key file, default `~/.payhole/session-key.json` (mode 600). |
| `PAYHOLE_SESSION_KEY` | Private key override, takes precedence over the file. |
| `PAYHOLE_RPC_URL` | RPC endpoint, default the official Robinhood Chain RPC from `config/4663.json`. |
| `PAYHOLE_CHAIN_ID`, `PAYHOLE_USDG` | Overrides for local anvil runs. |

## CLI

```sh
payhole key create                       # prints the key address; the account owner registers it with setSessionKey
payhole status                           # cap, spent, remaining, key balances
payhole pay https://api.example.com/x    # pays the 402 if the cap allows, prints the body
payhole pay <url> --method POST --data '{"q":1}' --header 'content-type: application/json' --max 0.05
```

Exit codes: 0 success, 1 error, 2 payment refused (cap, policy, key not live), 3 no acceptable offer.

The session key needs a little ETH for gas: pulling USDG from the BudgetAccount is a transaction the key sends itself. Signing the x402 authorization costs nothing; the facilitator settles it.

## Library

```ts
import { payholeFetch, PaymentRefusedError } from "@payhole/sdk";

const fetchPaid = payholeFetch({ sessionKey, budgetAccount, maxAmount: 50_000n });
try {
  const res = await fetchPaid("https://api.example.com/paid");
} catch (e) {
  if (e instanceof PaymentRefusedError) console.log(e.reason); // cap-exceeded, key-not-live, ...
}
```

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

The integration suite starts anvil with chain id 4663, deploys `MockUSDG` (EIP-3009) and `BudgetAccountFactory` from the Foundry artifacts, runs a mock x402 resource server with an embedded facilitator that verifies the typed-data signature and settles through `transferWithAuthorization`, and then proves: silent payment under the cap (v2 and v1), settlement reported back, refusal once the cap is spent with no signature sent, refusal of a revoked key, refusal of a foreign asset, `--max`, and the CLI's exit codes.

## Facilitator interop

Naven and Primer run standard `exact` facilitators on chain 4663. Naven serves a public test 402 at `https://api.naven.network/x402-test/ping` priced at 0.0001 USDG. With a key holding a little USDG and no `PAYHOLE_BUDGET_ACCOUNT` set:

```sh
PAYHOLE_SESSION_KEY=0x... payhole pay https://api.naven.network/x402-test/ping
```

This spends real USDG and is run only on explicit go-ahead.
