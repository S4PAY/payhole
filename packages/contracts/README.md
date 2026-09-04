# @payhole/contracts

Solidity contracts for PayHole on Robinhood Chain (chain id 4663). Foundry project, OpenZeppelin 5.7, Uniswap v4-core.

## Contracts

| Contract | Purpose | Owner |
|---|---|---|
| `BudgetAccountFactory` | Deploys `BudgetAccount` minimal proxies (EIP-1167) at deterministic addresses. | Safe (sweep only, no power over accounts) |
| `BudgetAccount` | A user's spending pocket: USDG deposit and withdraw, session keys with per-key cap and expiry, a global cap across keys, one-call `revokeAll`, `pay` for keys, `fund` for per-site addresses with on-chain per-site caps. | The user, and only the user |
| `BurnVault` | Swaps USDG or ETH into $PayHole through Uniswap V4 (PoolManager) or Uniswap V3 (SwapRouter02), owner-selectable per input, and sends the output to `0x...dEaD`. `burnWith` for anyone with their own funds, `burnHeld` (owner) for assets sent directly, `burnDirect`, and `unlock(tier)` which burns a configured amount and records the tier. | Safe |
| `CreatorRegistry` | Maps `keccak256(hostname)` to a creator wallet after an EIP-712 attestation from the verifier key; `tip` moves USDG straight to that wallet. | Safe |
| `OwnerSweep` | Base for the protocol contracts: owner-only `sweep` and `sweepETH`. | |

Trust model: no protocol key can move funds held by a `BudgetAccount`. The Safe owns the factory, vault, and registry, and can rotate the verifier, price unlock tiers, set the token address once, configure vault routes, and recover assets stuck in protocol contracts.

## Setup

```sh
git submodule update --init --recursive   # forge-std, openzeppelin-contracts, v4-core (with solmate)
cp .env.example .env                       # fill in values; .env is ignored by git
forge build
```

Compiler: production sources compile with solc 0.8.35, `evm_version = cancun`, optimizer 200 runs. Uniswap's `PoolManager.sol` pins solc 0.8.26, so the tests that deploy a PoolManager locally live in `test/v4/` and run under the `v4` profile. Everything else, including the fork suites, uses the default profile.

## Environment

| Variable | Used by | Meaning |
|---|---|---|
| `RPC_URL_4663` | deploy, snapshots | Official RPC. The only endpoint that broadcasts. `scripts/deploy.sh` refuses any other value. |
| `ARCHIVE_RPC_URL_4663` | fork tests | Archive endpoint for anvil forks and reads. Never broadcasts; must differ from the official URL. |
| `DEPLOYER_PRIVATE_KEY` | deploy | Dedicated EOA that only signs deployments. |
| `SAFE_ADDRESS` | deploy | Protocol owner Safe. Checked to have code and a non-zero `getThreshold()`. |
| `VERIFIER_ADDRESS` | deploy (registry) | Initial verifier key of the registry. |
| `ANVIL_PORT` | fork tests | Local anvil port, default 8546. |

The official RPC keeps state for only a few thousand blocks, so long-lived anvil forks need the archive endpoint.

## Chain configuration

`config/4663.json` holds every external address the contracts and tests depend on: USDG, WETH, the Uniswap V4 deployment, the Pons launchpad, and the x402 network settings. Nothing is hard-coded in Solidity; deploy scripts and fork tests read this file. Change it only with a verified source and a commit message that says how the value was confirmed.

## Tests

```sh
pnpm test        # forge test (unit, fuzz, invariants) + FOUNDRY_PROFILE=v4 forge test for the local PoolManager suite
pnpm test:fork   # anvil fork of Robinhood Chain (ARCHIVE_RPC_URL_4663 or RPC_URL_4663), real PoolManager, USDG, WETH
pnpm lint        # forge fmt --check && forge lint
pnpm slither     # slither with slither.config.json; fails on medium or worse
```

Fuzz runs default to 1024 (`[fuzz]` in `foundry.toml`); `FOUNDRY_PROFILE=ci` raises them. The invariant suite drives a `BudgetAccount` through random owner and key actions and checks that global spend equals what keys paid, balances match the ledger, and no key outlives its epoch.

Fork suites are skipped unless `FORK_RPC_URL` is set; `scripts/fork-test.sh` starts anvil and sets it. Because the $PayHole pool does not exist before launch, the vault fork suite creates hookless pools with a mock token on the real PoolManager and swaps real USDG and WETH through them. `BurnVaultPons.fork.t.sol` additionally pins block 54015994 and burns through real Pons pools of both kinds (a V3 WETH pool and V4 pools carrying the live Pons hook), which needs the archive endpoint as the fork source.

Slither triage: `BurnVault._requireNonZero` carries a `slither-disable-next-line incorrect-equality` because a `== 0` guard on a held balance cannot be exploited (a donation only lets the burn proceed). Remaining findings are low or informational: timestamp comparisons for expiries and deadlines, an external call inside the two-hop loop, and a benign write ordering in `createAccount`.

## Deploy

Deployments go straight to mainnet through `scripts/deploy.sh`, one target at a time or all at once:

```sh
scripts/deploy.sh vault               # simulate only
scripts/deploy.sh vault --broadcast   # full procedure
```

With `--broadcast` the script:

1. refuses to run with uncommitted changes, an RPC other than the official one, or an archive URL equal to it;
2. copies `deployments/4663.json` and a `cast` snapshot of dependent on-chain state (owners, code hashes, vault token and routes, registry verifier) into `deployments/backups/<timestamp>/` and commits it;
3. runs the fork suites on an anvil fork;
4. simulates, then broadcasts with `--slow`;
5. records address, transaction hash, block, and constructor args in `deployments/4663.json`;
6. verifies source on Blockscout (`--verifier blockscout --verifier-url https://robinhoodchain.blockscout.com/api/`), falling back to Sourcify, which Blockscout imports; if both fail it prints the manual upload command;
7. asserts `owner()` equals `SAFE_ADDRESS` for every deployed contract and commits the record.

Every contract takes the Safe as `initialOwner` in its constructor, so the deployer never owns anything. The Solidity scripts also assert ownership before returning, and revert unless `RPC_URL_4663` equals the official RPC and differs from `ARCHIVE_RPC_URL_4663`.

Keep the deployer funded with only what the next deploy needs.

## Safe operations

Owner actions are executed from the Safe UI. Generate calldata with `cast`, paste it as a custom transaction to the contract, and describe it in one line.

Set the token once (after the Pons launch):

```sh
cast calldata "setToken(address)" <PAYHOLE_TOKEN>
```

Configure the vault route once the token trades. Which route depends on how the token was launched on Pons: the app's default V2 flow graduates into a Uniswap V4 pool with fee 0, tick spacing 200, and the Pons meme hook; the app's v1 tab launches straight into a Uniswap V3 token/WETH pool with fee 10000. `config/4663.json` records both under `pons`.

V4 pool (V2 graduation), reading the exact key from the PoolManager's `Initialize` event for the token:

```sh
cast logs --rpc-url $RPC_URL_4663 --address <POOL_MANAGER> --from-block <GRADUATION_BLOCK> \
  "Initialize(bytes32,address,address,uint24,int24,address,uint160,int24)" | grep -i -B2 -A8 <PAYHOLE_TOKEN>
# currency0 and currency1 are sorted numerically; for an ETH pair currency0 is 0x0000...0000
cast calldata "setRoute(address,(address,address,uint24,int24,address)[])" 0x0000000000000000000000000000000000000000 \
  "[(<CURRENCY0>,<CURRENCY1>,0,200,<PONS_HOOK>)]"
# USDG route through the same pool if the launch was paired with USDG, or two hops USDG/ETH then ETH/token otherwise
cast calldata "setRoute(address,(address,address,uint24,int24,address)[])" <USDG> "[(<C0>,<C1>,<FEE>,<SPACING>,<HOOKS>),(<C0>,<C1>,0,200,<PONS_HOOK>)]"
```

V3 pool (v1 tab launch), as a packed SwapRouter02 path `token | fee | token ...` that must start at WETH for the ETH route and at USDG for the USDG route (the vault wraps ETH itself). Fee 10000 is `0x002710`, fee 100 is `0x000064`:

```sh
cast calldata "setRouteV3(address,bytes)" 0x0000000000000000000000000000000000000000 "$(cast concat-hex <WETH> 0x002710 <PAYHOLE_TOKEN>)"
cast calldata "setRouteV3(address,bytes)" <USDG> "$(cast concat-hex <USDG> 0x000064 <WETH> 0x002710 <PAYHOLE_TOKEN>)"
```

Setting a route of one kind replaces the other kind for that input. `routeKind(tokenIn)` reports 0 (none), 1 (V4), or 2 (V3).

Price unlock tiers, rotate the verifier, convert assets sent directly to the vault, recover stuck assets:

```sh
cast calldata "setTierCost(uint8,uint256)" 1 <AMOUNT_IN_TOKEN_UNITS>
cast calldata "setVerifier(address)" <NEW_VERIFIER>
cast calldata "burnHeld(address,uint256,uint256)" <USDG_OR_ZERO_OR_TOKEN> <MIN_OUT> <DEADLINE_UNIX>
cast calldata "sweep(address,address,uint256)" <TOKEN> <TO> <AMOUNT>
cast calldata "sweepETH(address,uint256)" <TO> <WEI>
```

For `burnHeld` and `burnWith`, quote `minAmountOut` off-chain (V4 routes: `uniswapV4.quoter` `quoteExactInputSingle`; V3 routes: `uniswapV3.quoterV2` `quoteExactInput` with the same packed path, both via `eth_call`) and subtract a tolerance that covers the Pons hook fee.

## Deployment record

`deployments/4663.json`:

```json
{
  "chainId": 4663,
  "contracts": {
    "BurnVault": {
      "address": "0x...", "txHash": "0x...", "block": 0, "deployedAt": "...",
      "constructorArgs": "0x...", "verified": "blockscout"
    }
  }
}
```

Backups live in `deployments/backups/<timestamp>/` with the previous record and a state snapshot, committed before every broadcast.
