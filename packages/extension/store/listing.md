# Chrome Web Store listing kit

Everything the developer console asks for, in the order it asks. Upload `.output/payholeextension-<version>-chrome.zip`
(build with `pnpm build && pnpm zip`; the version in `package.json` must go up on every upload). Images are in this
directory: `1-scam-pages-stop.png` to `4-reports-that-pay.png` (1280 by 800), `promo-small-440x280.png`,
`promo-marquee-1400x560.png`, and the icon is `public/icon/128.png`. Regenerate the frames with
`node scripts/store-frames.mjs` after refreshing the raw captures in `store/raw`.

The listing is live at https://chromewebstore.google.com/detail/calplcemfhaiomnhjphgmicdamdjhhep. Every field below
replaces what the first submission said; the extension changed from a spending pocket to a shield in 0.2 and 0.3.

## Store listing tab

Name: PayHole

Summary (132 characters max):
Scam links stop loading, and drainers stop before your wallet opens. Checks every site and every wallet request.

Category: Privacy & Security (Tools if the console does not offer it). Language: English.

Description:

PayHole stops crypto scams in two places: the page and the wallet.

Every site you open is checked against the PayHole resolver, the same answer the PayHole app gives on a phone. A
known wallet drainer, phishing page, or counterfeit token site never loads. In its place you see what the name is and
who says so, with Go back or Open once. A name the browser has already seen blocked is stopped inside the browser
before a single request leaves.

Before MetaMask, Rabby, or any wallet opens, PayHole reads what the page asked for: a send, an approval, a permit, a
signature. Every address in it is checked against the network's list of drainer contracts and the wallets behind
them. A known one is stopped with a warning you can override; an unlimited approval to an address nobody knows gets a
heads-up, once per spender: Continue and it does not ask about that spender again. It works with every wallet, on
every EVM chain, and never touches a seed.

What it does
- Checks each site as it loads and walls off listed names: drainers, phishing, counterfeit token sites.
- Drops requests inside pages to names on the PayHole list, the scripts and frames a page pulls in, not only the
  page itself.
- Reads wallet requests before the wallet sees them and stops sends, approvals, and permits to known drainer
  addresses. Optional warning on unlimited approvals.
- Shows a badge on blocked tabs; the popup gives the verdict for any site, a box to check any link or address, and a
  report button.
- Right-click any link: Check this link with PayHole.
- Reports are signed by a key that lives in the extension. Name a rewards wallet and confirmed first reports pay in
  USDG. Link the key to a tier holder's wallet on payhole.org and reports count as that wallet's flags.
- Point it at your own PayHole resolver on your network if you run one.

What it does not do
- No account, no sign-up, no analytics, no telemetry. The only thing that leaves the browser is the hostname of a
  site or the addresses in a wallet request, sent to the resolver you chose, which answers from memory and keeps no
  log.
- No wallet, no keys to your funds, no custody. The guard only reads requests. (An optional x402 spending pocket for
  Robinhood Chain is included, off by default, for sites that charge per page.)
- No rewards in a token, ever. Bounties are paid in USDG by the project.

What it cannot see
- Wallets that speak to a phone over a QR code (WalletConnect) never pass through the browser, so the guard does not
  see them. Non-EVM chains are not covered.

Getting started
1. Pin the icon. Everything is on from the first page.
2. Open the dashboard from the popup for the session log, the switches, and your reporter key.
3. To earn bounties, add a rewards wallet in the Reports tab.

Open source under the MIT license. Privacy policy at payhole.org/privacy.html.

Official URL: https://payhole.org
Homepage URL: https://payhole.org
Support URL: https://payhole.org/extension.html
Privacy policy URL: https://payhole.org/privacy.html (required because Web history is declared under data usage)
Contact email: hello@payhole.org

## Privacy tab

Single purpose description:
PayHole protects the browser from crypto scams: it stops known scam sites before they load and stops wallet requests
that would send funds, approvals, or permits to known drainer addresses. Every other feature exists to run that
protection: checking a link or address by hand, reporting one, showing what was stopped, and choosing the resolver.

Permission justifications:

- Host permission on all sites: a scam page can be on any site, and a wallet request can come from any page, so the
  extension must see navigations and wallet requests everywhere. It reads only the hostname of each navigation and
  the requests a page makes to a wallet.
- webNavigation: to notice a page load as it starts, ask the resolver about the name, and send a listed one to the
  wall page before it loads.
- declarativeNetRequest and declarativeNetRequestWithHostAccess: to redirect a name the browser already saw blocked
  to the wall page before any request leaves, and to drop requests inside pages to names on the PayHole list and the
  user's own list.
- tabs: to know which site is in the active tab so the popup and the badge show the right verdict, and to open the
  wall page.
- contextMenus: for "Check this link with PayHole" and "Check this page with PayHole".
- webRequest: to notice HTTP 402 responses when the optional spending pocket is on. Request bodies are never read.
- storage: to keep settings, the reporter key, the rewards wallet, the user's own blocklist, the PayHole list, the
  spenders the user continued for, and the session log on the device; with the pocket on, the encrypted vault and
  the ledger too. Nothing is synced or sent to us.
- alarms: to refresh the PayHole list and the user's own blocklist on a schedule while the extension is idle.
- Content scripts on all sites: one in the page's world wraps the wallet's request function so a request can be read
  before the wallet sees it; one in the isolated world shows the warning and talks to the extension.

Remote code: No. All code ships in the package. The extension talks over plain HTTPS to the resolver the user chose
(dns.payhole.org by default) for verdicts, address checks, and reports; with the pocket on, also to the Robinhood
Chain RPC endpoint, to the site being paid, and to the facilitator that site names. No scripts are fetched or
evaluated.

Data usage disclosure:
- Web history: the hostname of each site the user opens is sent to the resolver to learn whether it is listed. It is
  answered from memory and not stored by the resolver; the extension keeps the answer in memory for a while.
- Financial and payment information: the addresses in a wallet request are sent to the resolver to learn whether any
  is a known drainer; with the pocket on, payment authorizations are signed and sent to the site being paid.
- Certifications: data is not sold to third parties, not used or transferred for purposes unrelated to the
  extension's single purpose, and not used or transferred to determine creditworthiness or for lending.

## Distribution tab

Visibility: Public. Regions: all. Free.

## Trader declaration

Non-trader. The publisher is an individual without a registered business; the extension is free and open source.
