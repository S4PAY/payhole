# PayHole website brief

Brand system and design brief for payhole.org. The design is produced as artboards first; the site is then built as a static package in this repository and served from the VPS.

## Brand

- Name: PayHole, one word, capital P and capital H. Never "Payhole" or "pay hole".
- Idea: a hole in your pocket, on purpose. Money can only leave through a hole you sized. Trackers fall into the sinkhole. The token falls into the burn.
- Pillars: Capped (never more than you meant), Automatic (pages pay themselves over x402, silent under the cap), Private (every site gets its own address, trackers and drainers die at DNS), Fair (registered creators are paid per visit), Burned (the token is only ever bought and burned).
- Voice: plain, confident, dry. Short sentences with verbs. No hype words, no exclamation marks, no emojis. Numbers only when they are real.
- Tagline: "It pays itself." Alternatives: "Small budget. Every site its own pocket." and "Spend the web without thinking about it."

## Visual identity

- Dark-first. Neutrals: background #0B0B0F, surface #15151B, border #2A2A33, text #F3F3F6, muted text #9A9AA6. Light theme: background #F7F6F2, surface #FFFFFF, text #141419, muted #5C5C66.
- Primary accent, "ember": gradient #FF6A00 to #FF9E3D, used for the mark, primary buttons, and burn-related figures. Secondary accent, "mint": #7DF9C8, used sparingly for paid, settled, and under-cap states. Danger: #FF4D4D for blocked and over-cap.
- Motif: the aperture. A perfect circle with a soft inner gradient that reads as looking into a void; the o in PayHole can carry the mark. Concentric rings, a coin dropping into a circle, dotted flow lines. No stock photography, no mascots, no 3D coins.
- Typography: Space Grotesk for display (tight tracking, large sizes), Inter for body, JetBrains Mono for addresses, amounts, and code.
- Layout: 12-column grid, 1200 px max content width, generous whitespace, one idea per section. Icons are thin line icons with a 1.5 px stroke.

## Pages

1. Home: hero with headline, subhead, two calls to action ("Get the extension", "Read the docs") and a visual of the extension popup showing a site card; "How it works" in four steps (fund a pocket, each site gets its own address, pages pay themselves over x402, trackers die at DNS); feature grid (caps, silent payments, per-site addresses, agent session keys, creator tips, Sinkhole, unlock tiers, token burns); creators band; developers band with an SDK snippet; token band with live total burned and tiers; trust band with the contracts table; FAQ; footer.
2. Creators: publish `_payhole.<domain>` TXT `payhole=0x...`, request the attestation, submit the claim, receive tips per visit.
3. Developers: install `@payhole/sdk`, `payholeFetch` example, `payhole` CLI, x402 facts (version 2 headers, USDG on `eip155:4663`), links to package READMEs.
4. Token: only bought and burned; `burnWith`, `burnDirect`, `unlock`; tier table; burn feed from BurnVault events; the statement that the token never pays anyone.
5. Sinkhole: what it blocks, how to run a node, swarm membership by tier, privacy statement (only explicit flags leave a node).
6. Trust: architecture, key handling, what a page can and cannot see, contract addresses with Sourcify links, the Slither result, and a clear "not audited" disclosure.

## Facts the site may state

- Chain: Robinhood Chain, chain id 4663. Settlement asset: USDG only.
- Contracts, all owned by the Safe 0xfCeB8905E316D383Cd90Aa1Ab04ab1650611445b and verified on Sourcify: BudgetAccountFactory 0x68b5bb42fec83db9582758bbcb1fc43f748970d6, BurnVault 0x298712ca3a1367bbd8caabd5269b05985228eedf, CreatorRegistry 0x5d483aec0735d550d09018a2e89c49c190962deb. Explorer: robinhoodchain.blockscout.com.
- Extension: Manifest V3 for Chromium. SDK: `@payhole/sdk` with the `payhole` CLI. Verifier: verifier.payhole.org.
- Facilitators known to work: Naven and Primer.

## Rules

- No emojis anywhere. No references to AI tooling.
- No fabricated statistics; dynamic figures are labelled live and read from chain events.
- No rewards, yield, staking, cashback, or airdrop language. The token is bought and burned and pays no one.
- No claims of audits. State plainly that the contracts are open source, tested, and not audited.
- Accessible contrast in both themes; keyboard-navigable; responsive from 390 px up.
