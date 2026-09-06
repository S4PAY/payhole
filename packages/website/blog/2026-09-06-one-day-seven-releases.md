---
title: One day, seven releases
date: 2026-09-06
tag: Release
summary: Everything that shipped on September 6, in order. The Android app went public and learned to answer from the share sheet, the resolver got a third list and an allowlist, tiers are priced in USDG and bought from the CLI or the node dashboard, every block carries a category, drainer flags take a fast lane, and verdicts are public.
---

A long day. This is the list of what went out, in the order it went out, with the exact settings
and addresses so an operator can read it as release notes. Two of the items have their own posts
already; the rest are described here.

## 1. The Android app went public

The beta grew a vortex that turns while the tunnel is up, the wordmark with the logo as its o, a
24-hour histogram of lookups and blocked answers, and counters that survive restarts and reboots.
The resolver check on the Resolver tab now says that a lookup came back with one address record
instead of printing the address. Version 0.1.5 went up at
[payhole.org/downloads/payhole.apk](/downloads/payhole.apk), with a card in the
[Sinkhole tutorial](/sinkhole.html#phone) and [its own post](/blog/payhole-for-android/).

## 2. A third list, and an allowlist that nothing overrides

The public resolver and every node that subscribes to the same lists now carry the
[Phishing.Database](https://github.com/Phishing-Database/Phishing.Database) active domains, about
390,000 names rebuilt hourly, next to the ScamSniffer scam database and the StevenBlack ad and
tracker list: about 820,000 names in all.

Phishing lists carry a problem with them. Pages that host phishing often live on shared platforms,
and the lists name the platform: sites.google.com, the IPFS gateways, wp.me, share.google, r2.dev,
and 380 names in the Tranco top million in that one list alone. Blocking them breaks the web for
everyone to stop a few pages. So Sinkhole now has an allowlist that no list and no swarm verdict
can override. Every node fetches PayHole's list from the repository, 155 rules today, exact names
and suffixes, and `MANUAL_ALLOWLIST_FILE` adds your own. The tutorial names all three lists and the
allowlist, and the app's Lists tab does too.

## 3. Tiers are priced in USDG

The BurnVault was redeployed with tiers priced in USDG instead of token amounts: 10 USDG for tier
one, 50 for tier two, 250 for tier three, set by the owner Safe. You pay USDG; the vault buys
PAYHOLE with it and burns what it bought. The price stays a dollar figure whatever the token does,
and no amount of the token changes hands, because the token is only ever burned. Until the Pons
pool graduates into its Uniswap V4 pool the vault holds the USDG and burns once the route exists.
This replaces the token-amount tiers described in
[the token post](/blog/payhole-token-on-pons/); the [token page](/token.html) reads the prices
from the vault.

## 4. Buy a tier from the CLI or the node dashboard

`@payhole/sdk` 0.2.0 on npm adds `payhole tier`, which prints the key's tier, the tier prices, and
its USDG and gas, and `payhole tier unlock 1`, which approves the vault for the price and unlocks.
The Sinkhole dashboard got a Membership block that shows the operator wallet's tier and buys one
from the box. The first tier one on the network was unlocked from a board on a home network, and
its flags have been counting in the swarm since.

## 5. Every block has a category

Sinkhole now classes every blocked name: drainer infrastructure, wallet drainer, phishing,
counterfeit token site, tracker, ad, or other. Lists carry a category, manual entries take one,
and flags in the swarm carry one; when a name is on several, the strongest wins. The query log
shows it, the dashboard counts blocks by category and how many dangerous names were stopped in the
last 24 hours, and the app shows it on every blocked name.

## 6. A fast lane for drainer flags, and public verdicts

The swarm still confirms a new name when `FLAG_THRESHOLD` separate operators flag it, five by
default. Drainer kits move domains faster than five operators notice, so there is now a fast lane:
a name that is already on a subscribed list, flagged as drainer infrastructure or a wallet drainer
by a reporter holding a tier, is confirmed at `FAST_LANE_THRESHOLD`, two by default, the list plus
one reporter, and becomes a curated block on every node. `FAST_LANE_CATEGORIES` sets which classes
qualify. The public node accepts flags only from wallets holding a tier (`MIN_TIER=1`) and redials
its bootstrap peers every minute, so a node that lost it comes back on its own.

What a node knows about a name is now a public answer. `GET https://dns.payhole.org/verdict?name=`
followed by a hostname returns JSON: `blocked`, `allowlisted`, `category`, `sources` (swarm, list,
manual, or the extension), `reasons`, `reporters`, `confirmed`, and `checkedAt`. It is open to any
origin, shares the resolver's rate limit, and a malformed request does not spend it. On your own
node the same answer is at `/api/verdict` on the admin API.

## 7. Share a link to PayHole, and check one on the web

PayHole for Android 0.2.0 answers from the share sheet, tags every block with its category, and
raises a notification when it stops a drainer or a phishing page. [Its post](/blog/share-a-link-to-payhole/)
has the details. The same question can be asked with nothing installed at
[payhole.org/check.html](/check.html), which calls the verdict endpoint from the page.

## Nothing today pays anyone

Tiers are bought with USDG and the USDG only ever buys and burns the token. Nodes are not paid
for running, reporting, or confirming. The return on all of it is a network that stops a drainer
on every phone and browser running PayHole a little sooner than it did yesterday.

## Next

The threat radar: what the swarm confirmed in the last hours, which lists grew and by how much,
and which brands the new names impersonate, built only from swarm flags and list deltas, never
from what phones looked up, because the public resolver keeps no query log. Then store builds of
the app and the iOS share extension.
