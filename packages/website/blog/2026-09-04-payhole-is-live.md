---
title: PayHole is live on Robinhood Chain
date: 2026-09-04
tag: Launch
summary: The contracts, the extension, the SDK, the verifier, and the website shipped together, and the first real payment settled through a public facilitator the same day.
---

PayHole is a capped spending pocket for the browser. You fund it with USDG on Robinhood Chain, set a cap, and pages that ask for a cent over HTTP 402 get paid without prompts. Today everything needed for that went live.

## What shipped

- **Three contracts on Robinhood Chain, chain id 4663.** `BudgetAccountFactory` creates a pocket per user as a minimal proxy, `BudgetAccount` holds USDG and enforces per-site caps and session keys on chain, `BurnVault` buys and burns the token and unlocks tiers, and `CreatorRegistry` maps DNS-attested domains to wallets for tips. All three are owned by one Safe and verified on Sourcify. The addresses are on the [Trust page](/trust.html).
- **The extension**, a Manifest V3 build for Chrome and other Chromium browsers. It keeps an encrypted seed on the device, derives one address per site, observes 402 responses, signs USDG transfer authorizations, retries the request, and keeps a local ledger. [Download and install steps](/extension.html).
- **`@payhole/sdk` 0.1.0** on npm: an x402 client that speaks protocol version 2 with version 1 compatibility, plus the `payhole` command line for agents and scripts with capped session keys.
- **The verifier** at [verifier.payhole.org](https://verifier.payhole.org/healthz): reads a `_payhole` TXT record, checks that it names the wallet, and signs an EIP-712 attestation the registry accepts.
- **This website**, with live values read from the chain by the browser.

## The first payment

The extension paid Naven's public x402 test endpoint from a fresh pocket: the site answered 402, the pocket funded a per-site address, the extension signed, the facilitator settled on chain, and the page loaded with the settlement transaction attached. Two loads, two settlements, exactly the amounts asked.

payhole.org itself is now a registered creator. The TXT record is public, the claim is on chain, and visitors with tips on send a small amount once a day.

## Try it

A real article behind a real 402 lives at [payhole.org/try.html](/try.html). Without the extension you see the price and the 402. With it, the page pays for itself.

Everything is open source under the MIT license at [github.com/S4PAY/payhole](https://github.com/S4PAY/payhole).
