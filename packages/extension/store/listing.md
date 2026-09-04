# Chrome Web Store listing kit

Everything the developer console asks for, in the order it asks. Upload `.output/payholeextension-<version>-chrome.zip`
(build with `pnpm build && pnpm zip`; the version in `package.json` must go up on every upload). Images are in this
directory: `1-pages-pay-themselves.png` to `4-over-the-cap-one-prompt.png` (1280 by 800), `promo-small-440x280.png`,
`promo-marquee-1400x560.png`, and the icon is `public/icon/128.png`. Regenerate with `pnpm exec tsx scripts/store-shots.ts`
then `node scripts/store-frames.mjs`.

## Store listing tab

Name: PayHole

Summary (132 characters max):
A capped spending pocket on Robinhood Chain that pays websites, tools, and agents over x402 while you browse.

Category: Productivity. Language: English.

Description:

PayHole gives your browser a spending pocket. You fund it with USDG on Robinhood Chain and set a cap. When a page,
an API, or a tool answers with HTTP 402 and a price, PayHole pays it from an address that exists only for that site,
retries the request, and the page loads. Under the cap you never see a prompt. Over the cap you get one.

What it does
- Pays x402 requests (the open payment standard built on HTTP 402) with USDG, on Robinhood Chain, chain id 4663.
- Gives every site its own address, derived from your seed. A site sees only what it was paid. It never learns your
  other addresses, your balance, or what you paid elsewhere.
- Enforces caps on chain and in the extension: a cap per site, a shared cap for agent keys, and a prompt threshold.
- Keeps a ledger of every payment with the settlement transaction, in your browser only.
- Blocks known payment-drainer and tracker domains from a blocklist you control, before the browser connects to them.
- Lets you tip registered creators per visit, off by default.
- Hands out capped session keys for agents and command-line tools, so a script can pay from the same pocket
  without ever holding your seed.

What it does not do
- No account, no sign-up, no analytics, no telemetry. Your seed never leaves your device.
- No custody. Funds sit in a BudgetAccount contract that only your owner key controls; withdraw at any time.
- No rewards, cashback, or token emissions of any kind.

Getting started
1. Create a seed and a password. Write the recovery phrase down.
2. Send a little USDG and a little ETH for gas to the owner address shown in the dashboard.
3. Create the pocket, top it up, and browse. Try it on payhole.org/try.html, a real article behind a real 402.

Open source under the MIT license at github.com/S4PAY/payhole. Contracts are verified on Robinhood Chain. Privacy
policy at payhole.org/privacy.html.

Official URL: https://payhole.org
Homepage URL: https://payhole.org
Support URL: https://github.com/S4PAY/payhole/issues

## Privacy tab

Single purpose description:
PayHole is a capped spending pocket for the browser. When a website or API answers a request with HTTP 402 and a
price, the extension pays that price in USDG from an address dedicated to that site, within limits the user set, and
retries the request. Every other feature exists to run that pocket: funding it, setting caps, reviewing the ledger,
approving a payment above a cap, and blocking known payment-drainer domains.

Permission justifications:

- storage: keeps the encrypted vault, per-site caps, the payment ledger, the blocklist, and settings on the device.
  Nothing is synced or sent to us.
- alarms: refreshes balances and the blocklist on a schedule while the browser is idle, so the popup is current
  and blocking rules stay up to date.
- tabs: reads the origin of the active tab so the popup shows the pocket, address, and spend for the site you are on,
  and opens the dashboard and approval pages in tabs.
- webRequest: observes responses with status 402 and the payment headers they carry. That is the only way to notice
  that a page or API asked to be paid. Request bodies are never read.
- webNavigation: notices page loads that ended in a 402, so a top-level navigation can be paid and reloaded, and
  clears the one-time payment header rule afterwards.
- declarativeNetRequest and declarativeNetRequestWithHostAccess: adds the payment header to exactly one retried
  request per payment, and blocks domains on the user's blocklist before the browser connects to them.
- Host permission on all sites: a 402 can come from any site or API, and payment must work wherever the user
  browses. The extension only acts on responses with status 402 and on domains the user has chosen to block; it does
  not read or change page content otherwise.

Remote code: No. All code ships in the package. The extension talks to the Robinhood Chain RPC endpoint, to the site
being paid, and to the facilitator that site names, over plain HTTPS requests. No scripts are fetched or evaluated.

Data usage, what to tick:
- Financial and payment information: yes. The extension creates signed USDG transfer authorizations and sends them to
  the website being paid or the facilitator that site names, at the user's request. Amounts and addresses are public
  on chain by nature.
- Everything else: no. No personally identifiable information, health, authentication, personal communications,
  location, web history, user activity, or website content is collected or transmitted. The ledger and settings stay
  in the browser's local extension storage.
- Certifications: tick all three. Data is not sold to third parties, not used for purposes unrelated to the single
  purpose, and not used to determine creditworthiness or for lending.

Privacy policy URL: https://payhole.org/privacy.html

## Distribution tab

Visibility: Public. Regions: all. Pricing: free. Mature content: no.
