---
title: The wallet guard
date: 2026-09-07
tag: Release
card: check
summary: PayHole for Chrome 0.3 reads what a page asks your wallet to sign and stops a send, an approval, or a permit to a known drainer address before the wallet opens. The browser gets a reporter key, reports of addresses, and bounties like the phone.
---

Until today everything PayHole did was about names. The app, the resolver, the lists, the bounties:
a scam page never loads. What none of it could see was the transaction. A drainer reached from a
page not on any list, or an address pasted into a real dapp, went straight to the wallet.

## What 0.3 does

- **Every wallet request is read first.** When a page asks MetaMask, Rabby, or any wallet for a
  send, an approval, a permit, or a signature, the extension reads it before the wallet does:
  the recipient, the spender, the contract, every address in the typed data.
- **Known drainers are stopped.** Each address is checked against the network's list of drainer
  contracts and the wallets behind them, ScamSniffer's list plus what the project confirmed. A
  match puts a warning on the page: what the address is, who says so, Stop or Continue anyway.
  Stop rejects the request the way a wallet does when you decline; the wallet never sees it.
- **Unlimited approvals get a heads-up.** An approval or permit that would let an address nobody
  knows move all of a token gets a warning too. Normal on some sites, a trap on others. Off in the
  Shield tab if you know what you are doing.
- **Works everywhere.** Every EVM chain, every wallet that speaks the standard, including several
  at once. No seed is involved; the guard only reads.

## The browser reports like the phone

The extension now has a reporter key of its own. Every report is signed by it, the Reports tab
takes the wallet bounties go to and the proof from the link page that ties the key to a tier
holder, and it shows what became of each report, with the node's evidence. Addresses can be
reported as well as names: paste one in the popup's check box. Same bounties as the app: 0.50 USDG
for a drainer contract or its infrastructure, 0.30 for a phishing page or wallet, first confirmed
report only.

## On the node

The public resolver keeps the address list next to the name lists, refreshed on the same schedule,
and answers `GET /address` for any address. The whole list is at `/lists/addresses.txt` for other
nodes and tools.

## Install

[payhole.org/downloads/payhole-extension.zip](/downloads/payhole-extension.zip), steps on the
[extension page](/extension.html). Updating means extracting over the same folder and pressing the
refresh arrow on the PayHole card in chrome://extensions.
