# PayHole

A spending-pocket wallet for Robinhood Chain. The user funds a small USDG budget; every site, tool, and agent gets its own capped address; anything under the cap pays itself over x402; trackers and drainers die at DNS; registered creators get paid per visit. The $PayHole token is only ever bought and burned.

| Package | What it is |
|---|---|
| [`packages/contracts`](packages/contracts/README.md) | Foundry. `BudgetAccountFactory` and `BudgetAccount` (minimal proxies with session keys, per-site caps, revoke-all), `BurnVault` (USDG and ETH to $PayHole through Uniswap V4, straight to the burn address, unlock tiers), `CreatorRegistry` (DNS-attested domain to wallet mapping, tips). Deploy scripts with backups, verification, and Safe ownership asserts. |
| [`packages/sdk`](packages/sdk/README.md) | `@payhole/sdk`. x402 client (version 2 first, version 1 compatible), EIP-3009 signing on USDG, BudgetAccount bindings, `payholeFetch`, and the `payhole` CLI that holds a session key, shows remaining cap, and pays a URL. |
| [`packages/verifier`](packages/verifier/README.md) | Service that reads a `_payhole` DNS TXT record, checks it names the wallet, and signs the EIP-712 attestation that `CreatorRegistry.claim` accepts. Rate limited, Dockerfile. |
| [`packages/extension`](packages/extension/README.md) | Manifest V3 extension (WXT, React, viem): encrypted seed, per-origin addresses, 402 handling for fetch, XHR, and navigations, spend ledger, dashboard, tips, agent session keys, blocklist with Sinkhole sync, unlock tiers. |
| [`packages/sinkhole`](packages/sinkhole/README.md) | Docker image: dnsmasq blocker plus a sync agent that takes the extension's blocklist and joins a libp2p gossipsub swarm for drainer flags and an x402 endpoint directory, gated by BurnVault unlock tiers. |

## Chain

Robinhood Chain, chain id 4663, settlement in USDG only. External addresses (USDG, WETH, Uniswap V4, the Pons launchpad, x402 facilitators) live in [`packages/contracts/config/4663.json`](packages/contracts/config/4663.json) and are consumed by every package through `@payhole/sdk`. Deployed protocol addresses are recorded in `packages/contracts/deployments/4663.json`.

## Setup

```sh
git clone <repo> payhole && cd payhole
git submodule update --init --recursive
pnpm install
pnpm -r build
pnpm -r test
pnpm -r lint
```

Toolchain: Node 24, pnpm 10, Foundry (forge, cast, anvil), Slither for the contracts, Docker for the verifier and Sinkhole images.

Each package has a `.env.example`; copy it to `.env` and fill in values. `.env` files are never committed.

## Operations

- Deployments go straight to mainnet through `packages/contracts/scripts/deploy.sh`, which snapshots state, runs fork tests, simulates, broadcasts through the official RPC only, verifies source, and asserts that the Safe owns every contract.
- Owner actions (token address, vault routes, tier prices, verifier rotation, sweeps) are executed from the Safe with calldata recipes in the contracts README.
- The verifier and the Sinkhole run as containers on the VPS.
