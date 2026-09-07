---
title: Reports get reviewed
date: 2026-09-07
tag: Release
card: check
summary: A report no longer has to wait two weeks for the swarm. The project reviews the evidence and confirms or rejects it; a confirmed name pays and joins the PayHole list. PayHole for Android 0.5.1 shows what the node found while a report waits.
---

Yesterday's rules said a first report pays when two other tier holders confirm it, or a public list
catches up within fourteen days. Both are still true. But while the swarm is small, most reports
would sit at "waiting" for the full two weeks and lapse, which is not a bounty anyone would bother
with.

## A third way to be confirmed

From today the project reviews reports itself. Every report, hint or signed flag, gets the node's
evidence: does the name resolve, how old is the registration, how new the certificate, what the
page does. The project looks at that and decides. A confirmed report becomes payable at once and
the name is added to the PayHole list, so every phone and browser on the public resolver blocks it
from that moment. A rejected report is closed as not paid. Both decisions are recorded in the
node's ledger next to the evidence, and neither cancels the other two paths: the swarm and the
lists still confirm on their own.

A name that is dead by the time it is reviewed cannot be verified, so it will usually be closed.
Report what is live.

## Two fixes on the node

A tier holder's lone flag now shows as waiting in the ledger, so the count in the app matches what
the node holds. And the node writes every flag to disk as it arrives; before, a flag that had not
yet changed the blocked set could be lost on a restart.

## In the app

PayHole for Android 0.5.1 puts the node's findings under each report while it waits, in a few
words: "does not resolve right now", "checked, nothing found". A reviewed report says so.

## Install

[payhole.org/downloads/payhole.apk](/downloads/payhole.apk), same link as always, installs over the
last one.
