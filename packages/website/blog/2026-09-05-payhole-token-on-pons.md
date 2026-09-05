---
title: PAYHOLE is on Pons, and how tiers are priced
date: 2026-09-05
tag: Token
summary: The token launched on the Pons launchpad on Robinhood Chain. It has one job, being burned to unlock tiers, and the tier costs track a fixed dollar target.
---

PAYHOLE launched today through the Pons V2 launchpad on Robinhood Chain, paired with ETH, with a fixed supply of one billion. The contract address is `0x292a1edc920745c055670bb9a91c910a3669b7ce`; check it against the [Token page](/token.html) before you interact with anything.

## What the token does

Exactly one thing. Burning it through the BurnVault unlocks a tier for the wallet that burns: a bigger pocket, more session keys, and from tier one the right to report domains into the Sinkhole swarm. Fees from the extension buy and burn it as well once the pool exists. Nothing is paid to anyone. There are no emissions, no staking, no cashback, and no rewards for running a node.

## Tier pricing

Tier costs are set by the Safe that owns the vault, as token amounts. The policy is a fixed dollar target per tier: about $10 for tier one, $50 for tier two, $250 for tier three. As the price moves, the Safe re-sets the token amounts to keep those targets, so early and late unlockers pay about the same. Unlocks already made are never affected; a cost change applies only to new unlocks.

## What happens at graduation

Trading starts on the Pons bonding curve. When the curve reaches its threshold, the token graduates into a Uniswap V4 pool with the Pons hook. That is the moment the vault gets its swap routes, one for USDG and one for ETH, and fee burns begin. Until then the vault accepts direct burns for tier unlocks and the extension skips the fee it cannot route.

## Where to watch

The Token page shows the total burned and the current tier costs, read from the chain by your browser. The [Trust page](/trust.html) lists the contracts and the Safe. None of this is financial advice; the token exists to be destroyed, and the site says so in as many words.
