---
title: Extension 0.1.1 and the Chrome Web Store
date: 2026-09-05
tag: Release
summary: A new look for the popup and dashboard, the vortex as the icon, a fix for a bad first build, and the listing submitted for review.
---

## 0.1.1

- **New look.** Popup, dashboard, and the approval page now match the site: black ground, glass cards, the green accent, the same three typefaces bundled so they work offline, pill tabs, and the vortex mark in every header and as the toolbar icon.
- **Deployed addresses baked in.** The first public zip was built against a stale SDK and shipped with empty contract addresses, which made the dashboard ask for the factory address by hand. The build now refuses to produce an extension without the deployed addresses, so that cannot happen again.
- **Tighter ledger** in the popup at 360 pixels, and the package summary now matches the store listing.

## Installing today

Until the store listing is approved, install from the zip: download from [payhole.org/extension.html](/extension.html), extract it, open `chrome://extensions`, turn on Developer mode, and load the extracted folder. Your seed and settings survive updates as long as you load the same folder.

## The store

The listing has been submitted to the Chrome Web Store. Because the extension needs access to every site, a 402 can come from anywhere, Google routes it to a manual review, which usually takes several days. When it is approved, every "Get the extension" button on the site will point at the store page and installs become one click with automatic updates. The zip stays available for other Chromium browsers.

Firefox, including Firefox for Android, is the next target after Chrome.
