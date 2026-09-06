---
title: Report a scam from your phone
date: 2026-09-07
tag: Release
card: link
summary: PayHole for Android 0.4 lets anyone report a name the network does not block yet, and lets a tier holder make their phone report for their wallet, so the report enters the swarm as a real flag. Plus the PayHole list, a bounty ledger, and the radar's new hints.
---

Until today the swarm learned only from nodes. A phone could check a name and see the verdict, but
when the answer was "not blocked" and the person knew better, there was nowhere to say so. Now
there is.

## Report it

Check a link on the Check tab, or share it there from any app. If the network does not block it,
a report card appears: pick what it is, wallet drainer, phishing, counterfeit token, or drainer
infrastructure, add a few words if you like, and send. The resolver counts it. Nothing blocks on
reports alone. They are hints: counted per name, kept with the reasons people gave, shown to the
operators who can confirm them, and listed on the radar so a name many phones report gets seen
fast. Ten people reporting the same fake airdrop is a signal a tier holder can act on in one tap.

## Make it count with a tier

Every phone now carries a reporter key. It never holds money; it only signs. A wallet that holds a
tier can link that key by signing one message on [payhole.org/link](/link.html): the same
membership proof a Sinkhole node uses, with the phone's key in the peer slot. Paste the proof into
the app and from then on every report from that phone enters the swarm as the wallet's flag. It
counts toward confirmation like a node's flag, and it takes the fast lane: a name already on a
public list, flagged by a tier holder as a drainer, is blocked on every node at once.

The app checks the proof itself before accepting it, and every node checks the signature and the
wallet's BurnVault tier before counting a flag. A tier is 10 USDG, bought by the vault and burned.
That is the whole story of the token in one feature: the network trusts a report because someone
paid to be trusted, and the payment left the supply.

Signed reports open on the network once every node runs today's version. Until then the app sends
them as plain reports and says so.

## The PayHole list

What the swarm confirms, what operators add by hand, and what the extension flags now sit at
`https://dns.payhole.org/lists/payhole.txt`, and in hosts format at `/lists/payhole.hosts`. Any
Pi-hole, AdGuard Home, or Sinkhole can subscribe to it. It carries only PayHole's own names, not
the public lists the resolver already runs, so it is small and it moves when the swarm moves.

## The ledger

Every confirmation now records which wallet flagged the name first. Operators read the tally at
`/api/reports/ledger` on their node. That is the record a bounty is paid from, in USDG, from the
protocol's fees, to the reporter who was first on a name that later got confirmed. The amounts are
being set; the ledger exists so that when they are, nobody has to argue about who reported what.

## Install

[payhole.org/downloads/payhole.apk](/downloads/payhole.apk), same link as always, installs over the
last beta. Report from the Check tab. Link a tier at [payhole.org/link](/link.html).
