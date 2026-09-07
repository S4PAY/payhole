---
title: Extension 0.4, ready for the store
date: 2026-09-07
tag: Release
card: check
summary: The last round before the Chrome Web Store submission. Names on the PayHole list are now dropped inside pages, not only as pages; the unlimited-approval warning learned when to be quiet; the shield and the guard are walked in a real browser on every build.
---

Three releases in one day left a few edges. This one files them off, so the store gets one submission
and not three.

## Inside pages, not only pages

The wall stops a listed name from loading as a page. It did nothing about a listed name a page pulls
in: the drainer script, the hidden frame, the beacon. Now the PayHole list, the names the network
itself vouches for plus your own blocklist, becomes rules inside the browser that drop every such
request, refreshed every six hours. The page loads; the script from the drainer does not.

## A quieter guard

The heads-up on unlimited approvals was right about the risk and wrong about the frequency: every
DeFi site starts with one. Two changes. Permit2, the approval that nearly every swap goes through,
never asks. And any spender you chose Continue for is remembered, so the same site never asks
twice. The Shield tab shows how many you have continued for and forgets them on request. A known
drainer still stops every time.

## Small things

- The dashboard opens once, right after install, so the first minute is not a blank icon.
- The Settings tab shows the pocket's chain and contract fields only while the pocket is on.
- The manifest says what the extension is now.
- The whole walk, a clean site, a listed one, the wall, Open once, a blocked script, a stopped send,
  a clean send, a warned approval, a signed report, runs in headless Chromium as a test on every
  build.

## Install

[payhole.org/downloads/payhole-extension.zip](/downloads/payhole-extension.zip), steps on the
[extension page](/extension.html). The Chrome Web Store copy is 0.1 until the review of this build
lands; the zip is the one to use until then.
