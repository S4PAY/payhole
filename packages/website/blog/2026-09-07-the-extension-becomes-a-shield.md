---
title: The extension becomes a shield
date: 2026-09-07
tag: Release
card: check
summary: PayHole for Chrome 0.2 checks every site you open against the resolver and puts a wall in front of drainers, phishing, and counterfeit token sites before they load. The x402 pocket is still there, off by default.
---

The extension shipped on day one as a spending pocket: a capped USDG wallet that pays sites over
x402 while you browse. Few sites speak x402 yet, and a wallet you have to fund before it does
anything is not something people install. So the extension now does first what the app does on the
phone, and the pocket waits behind a switch.

## What 0.2 does

- **Every site is checked.** As a page starts to load, the extension asks the public resolver about
  the name, the same `verdict` the app and the check page use. A listed name never loads. In its
  place: what it is, who says so, Go back, or Open once for ten minutes.
- **The second time is instant.** A name the browser saw blocked becomes a rule inside the browser,
  so the next visit is redirected before a single request leaves, extension awake or not.
- **A badge on the tab.** Red mark on a blocked site; the popup shows the verdict for any site, a
  Report button, and a box to check a link you were sent before you open it.
- **Right-click any link.** Check this link with PayHole opens the verdict without visiting.
- **Reports from the browser.** Four kinds, a note, done. They count as hints for now; the signed
  key that earns bounties comes to the extension next.
- **The pocket, off by default.** Turn it on in the Shield tab and the Budget, Sites, Agents,
  Registry, Tips, and Tiers tabs come back exactly as before. Tiers are now priced in USDG, like the
  tier page.

The only thing that leaves the browser is a hostname, once, the first time in a while, to a
resolver you can change to your own Sinkhole node. No page content, no path, no identifier. The
public resolver keeps no query log.

## What comes next for it

The wallet guard: a warning before a signature to a known drainer address, an approval to a
flagged spender, or an unlimited approval to a contract nobody has seen. That is the first thing
PayHole will do that is not about names. Then the Chrome Web Store listing gets resubmitted as what
the extension now is.

## Install

[payhole.org/downloads/payhole-extension.zip](/downloads/payhole-extension.zip), and the steps on
the [extension page](/extension.html). Updating from 0.1 means extracting over the same folder and
pressing the refresh arrow on the PayHole card in chrome://extensions. Settings stay.
