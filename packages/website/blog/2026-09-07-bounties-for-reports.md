---
title: Bounties for reports
date: 2026-09-07
tag: Release
card: tier
summary: A confirmed first report now earns USDG: 0.50 for a wallet drainer or its infrastructure, 0.30 for phishing or a counterfeit token. PayHole for Android 0.5 adds the rewards wallet and shows what became of every report. Tiers can be bought from any wallet on the site.
---

The report button went out yesterday. Today it pays.

## The rules

- **0.50 USDG** for a wallet drainer or drainer infrastructure. **0.30 USDG** for phishing or a
  counterfeit token site. Trackers and ads earn nothing; the lists handle those.
- **First reporter only.** The network keeps one first reporter per name. A name already on a list
  or already blocked is answered "already blocked" and never counted, so duplicates cost nothing
  and earn nothing.
- **Confirmed later.** Two tier holders other than the reporter confirmed the name, or a public
  list caught up with it within fourteen days. A report that stays unconfirmed for two weeks lapses.
  A name later allowlisted pays nothing.
- **Ten a day** per wallet. Beyond that, reports still count for the network and earn nothing.
- **Paid on request from 10 USDG**, to a wallet that holds a tier or at least ten dollars of PAYHOLE at
  the moment of payout, priced live from the chain: the Pons curve until the pool graduates, the pool
  after. The token is never the payment; it is the ticket.

Money comes from the protocol's fees. Nobody is paid in the token, and the token still only burns.

## What the node does before anyone is paid

Every reported name gets evidence gathered by the node: does it resolve, which brand does it trade
on, is it on a free hosting platform, how old is the registration, how new is the certificate, and
what the page itself does: a seed phrase form, a wallet connection tied to a claim or an airdrop,
approval calls, a brand login, heavy obfuscation. The result is a score from 0 to 100 and a list
of marks in words, next to the report, so a tier holder can confirm in one look and the person
paying can see why. The node also remembers which wallets confirmed each name, so a reporter cannot
confirm their own report.

## In the app

PayHole for Android 0.5 adds the rewards wallet. Paste any wallet address once under Your reporter
key and every report from the phone carries it, signed by the phone's key so nobody can swap it.
A new Your reports card shows each name you reported and what became of it: waiting, confirmed and
payable, paid, or not paid, with the amount. When the wallet is owed 10 USDG and holds the token or
a tier, one button requests the payout.

## Tiers from any wallet

[payhole.org/tier.html](/tier.html) buys a tier from a wallet in the browser: connect, approve,
unlock. Two signatures. The vault takes the USDG and buys and burns PAYHOLE with it. No node and no
command line needed anymore, which was the last piece missing for a phone-only holder: buy a tier
here, link the phone on the [link page](/link.html), and reports from the phone enter the swarm as
the wallet's flags.

## Install

[payhole.org/downloads/payhole.apk](/downloads/payhole.apk), same link as always, installs over the
last one.
