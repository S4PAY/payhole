# @payhole/extension

Manifest V3 extension for Chromium: a spending-pocket wallet on Robinhood Chain (chain id 4663). Every site gets its own capped address derived from the user's seed; x402 payments (EIP-3009 `transferWithAuthorization` on USDG) are signed by that address and settled by the server's facilitator, so the payer never pays gas. The owner account controls a `BudgetAccount` contract that funds the per-site addresses under on-chain caps, issues session keys to agents, pays creator tips, and burns the top-up fee through the `BurnVault`.

Built with WXT, React 19, viem, and `@payhole/sdk` (the x402 core and the contract ABIs are reused, not reimplemented).

## Setup

```sh
pnpm install                              # from the repository root; runs `wxt prepare` for this package
pnpm --filter @payhole/contracts build    # Foundry artifacts for the chain-backed tests
pnpm --filter @payhole/sdk build          # dist/ the extension imports
pnpm --filter @payhole/extension build    # .output/chrome-mv3
```

Requirements: Node 22 or newer, pnpm, and Foundry (`anvil`) for the integration and end-to-end tests.

## Scripts

| Script | What it does |
|---|---|
| `pnpm dev` | WXT dev mode with reload. |
| `pnpm build` | Production build to `.output/chrome-mv3`. |
| `pnpm zip` | Zips the build for distribution. |
| `pnpm typecheck` | `wxt prepare` then `tsc --noEmit` with the repository's strict flags. |
| `pnpm lint` | `eslint .` with the root flat config. |
| `pnpm test` | Builds, then runs vitest: unit tests, an anvil-backed integration test, and the Playwright end-to-end test. |

## Load unpacked

1. `pnpm --filter @payhole/extension build`.
2. Open `chrome://extensions`, enable Developer mode, choose "Load unpacked", pick `packages/extension/.output/chrome-mv3`.
3. Click the PayHole toolbar icon: create a seed (the mnemonic is shown once and two words are checked back) or import one, then set a password.
4. Open the dashboard (button in the popup). Under Settings fill in the contract addresses if the SDK's deployment record does not carry them yet, then under Budget create the BudgetAccount (the owner needs a little ETH for gas) and top it up with USDG.

## Settings

All settings live in `browser.storage.local`; there is no `.env`.

| Setting | Default | Meaning |
|---|---|---|
| RPC URL, chain id | official Robinhood Chain RPC, 4663 | Any RPC and chain id work, so anvil runs are possible. |
| USDG, BudgetAccountFactory, BurnVault, CreatorRegistry | from the SDK's chain config and deployment record | Overridable. Empty protocol addresses disable the feature that needs them. |
| BudgetAccount | set when created | The user's account; can be pasted for an existing one. |
| Default per-site cap | 1 USDG | Lifetime amount an origin may spend before a prompt; per-origin overrides in Sites. |
| Global cap | 25 USDG | Total of per-site payments before a prompt. |
| Top-up chunk | 0.5 USDG | Pushed to a per-site address when it runs short (bounded by the on-chain site remaining). |
| Fee percent | 1 | Share of every top-up burned through the BurnVault. |
| Auto-lock | 15 minutes | Idle time after which the seed is dropped from memory and session storage. |
| Tips | off, 0.01 USDG, once per domain per 24 h, 1 USDG float | Creator tips on top-level navigations. |
| Sinkhole URL and token | empty | Where the blocklist is pushed. |

Caps are bounded by the BurnVault tier of the owner (constants in `lib/tiers.ts`): tier 0 allows 3 agent keys, a 25 USDG global cap, and a 5 USDG per-site cap; tier 1 allows 10, 100, 20; tier 2 and above 100, 1000, 100. The limits are enforced in the dashboard and in the background handlers.

## How a 402 gets paid

1. **Observe.** `webRequest.onHeadersReceived` (main frames, sub frames, XHR and fetch) records every 402 with its `PAYMENT-REQUIRED` header for 60 seconds, keyed by tab and URL.
2. **Decide.** `lib/policy.ts`: refused while paused or when the site's hostname (or a parent domain) is on the blocklist; silent when the origin's ledger spend plus the amount stays under its cap and the global cap; otherwise exactly one approval window per observed offer (`approve.html`). Approving pays that one request without changing caps. A request that already carried a payment is never paid again, so a second 402 cannot loop.
3. **Fund.** The per-site address must hold the amount. If not, the owner raises the on-chain site cap to the configured cap when it is lower, then `fund(site, max(deficit, chunk))`, bounded by the on-chain remaining. Missing gas, an empty account, or an exhausted cap produce a clear refusal in the ledger.
4. **Sign.** `preparePayment(perOriginSigner, offer)` from the SDK.
5. **Retry.**
   - Top-level navigations: a session `declarativeNetRequest` rule sets the payment header for that tab and exact URL, the tab is reloaded, and the rule is removed when the request completes or after 60 seconds. `PAYMENT-RESPONSE` on the retried response is read through `webRequest` and recorded.
   - Page requests: a `world: "MAIN"` content script wraps `fetch` and `XMLHttpRequest`. Request bodies are buffered before the first send. On a 402 the wrapper posts the details to the isolated bridge content script, which forwards them to the background; the background only acts when it observed that 402 through `webRequest` for the same tab and URL (or when the body is a valid x402 request), then answers with the header. The wrapper retries once and hands the second response to the page as the only response. The XHR facade holds the page at `OPENED` while paying and replays events from the retried request, so `onreadystatechange`, `onload`, `addEventListener`, and `responseType` behave as usual.
6. **Ledger.** `lib/ledger.ts` keeps per-origin records, daily totals, running sums, and the last 500 payments in `browser.storage.local`. Settlement is recorded from the `webRequest` observation of the retried response; the page's report is only a fallback.

Which origin pays: the page that made the request (its `origin`), or the destination origin for a navigation. The address is `HMAC-SHA-256(seed, "payhole/origin/v1/" + origin)` wrapped as a secp256k1 key, so the same site always gets the same address and no two sites share one.

## Security model

- The seed is a BIP-39 mnemonic encrypted with AES-GCM-256 under a PBKDF2-SHA-256 key (600000 iterations, random 16-byte salt) in `browser.storage.local`. The decrypted mnemonic exists only in the background service worker's memory and in `browser.storage.session` (access level `TRUSTED_CONTEXTS`), so it survives worker restarts but not a browser restart. Locking, auto-lock, and removing the seed clear it.
- Derivations: owner `m/44'/60'/0'/0/0`, agent key `i` at `m/44'/60'/2'/0/i`, per-site keys by HMAC as above. Private keys never leave the background; extension pages receive addresses, signatures, and, only on an explicit export, an agent key.
- Pages see nothing of the extension except a wrapped `fetch` and `XMLHttpRequest` in their own world. A page can learn its own per-site address from the payment header it sends, which is by design: that address holds at most the site's cap. A page cannot read other sites' addresses, cannot ask for a payment the network did not challenge, and cannot move funds beyond what the owner pushed to its address.
- Messages crossing the page, bridge, and background boundaries are validated structurally (`lib/bridge.ts`), and the background checks the sender's extension id, tab, and http(s) origin. Extension-page API calls are accepted only from the extension's own pages.
- The `$PayHole` token is only ever bought and burned by the vault; the extension never pays anyone in it.

## Sinkhole sync contract

On every blocklist change and every 15 minutes the extension sends

```
PUT <sinkhole-url>/api/blocklist
Authorization: Bearer <token>
Content-Type: application/json

{"version":1,"updatedAt":"2026-09-04T12:00:00.000Z","entries":[{"domain":"tracker.example","reason":"tracker","flaggedAt":1757000000000}]}
```

Entries are sorted by domain; `reason` is one of `drainer`, `scam`, `tracker`, `other`. Any 2xx counts as success; the last attempt, success, HTTP status, and error are shown in the dashboard. The same list exports as plain hostnames, `dnsmasq` `address=/host/0.0.0.0` lines, a hosts file, and the JSON above.

## Tests

```sh
pnpm --filter @payhole/extension test       # builds first, then vitest
```

- Unit (`test/*.test.ts`, fake browser through WXT's vitest plugin): vault round trip and wrong password; per-origin key determinism and distinctness; policy (silent under cap, one prompt over cap, blocked and paused refused, second 402 not paid); ledger totals and bounds; blocklist matching and every export format plus the sync request; tip scheduling and lookup caching; declarativeNetRequest rule construction; bridge message and sender validation.
- Integration (`test/integration.test.ts`): starts anvil with chain id 4663, deploys `MockUSDG` and `BudgetAccountFactory` from the Foundry artifacts, creates the account with the owner key, deposits, and runs the background payment core (no browser APIs, dependencies injected) against a mock x402 server with an embedded facilitator: the per-site address is funded under the cap, the payment settles, an over-cap offer is refused when declined and paid once when approved, and funding failures are named.
- End-to-end (`test/e2e.test.ts`): loads `.output/chrome-mv3` into headless Chromium through Playwright (`channel: "chromium"`, which is the full browser in new headless mode; extensions do not load in the headless shell) and pays the mock server from a navigation, a `fetch` with a JSON body, and an `XMLHttpRequest`, then denies an over-cap approval. The test skips with a printed reason when the build output is missing or Chromium cannot start.

Installing the browser without touching the system:

```sh
cd packages/extension
PLAYWRIGHT_BROWSERS_PATH=0 pnpm exec playwright install chromium   # into node_modules/playwright-core/.local-browsers
```

Chromium needs the usual desktop shared libraries (`libnss3`, `libatk`, `libgbm`, `libasound2`, ...). On a machine where only `libasound.so.2` is missing and packages cannot be installed, a stub built with `gcc` is enough for the tests since no audio is produced: list the `snd_*` symbols Chromium imports (`nm -D --undefined-only --with-symbol-versions chrome`), compile no-op definitions into `libasound.so.2` with a version script that defines `ALSA_0.9` and `ALSA_0.9.0rc4`, and run the tests with `LD_LIBRARY_PATH` pointing at that directory.

Manual procedure when the end-to-end test cannot run: load the unpacked build, point Settings at an anvil RPC where `MockUSDG` and the factory are deployed (the integration test shows how), create the account, top it up, then visit the mock server's `/paid`, `/fetch.html`, and `/xhr.html` from `test/helpers/mockServer.ts` and watch the ledger in the popup.

## Live test against a public facilitator

Only on explicit go-ahead, because it spends real USDG. Naven serves a public 402 priced at 0.0001 USDG:

1. Build and load the extension against the real chain (default settings). Create the BudgetAccount, send a little ETH to the owner address for gas, and top up with at least 0.5 USDG (one top-up chunk).
2. Set the default per-site cap to at least 0.0001 USDG (the default is well above it) and make sure payments are not paused.
3. Navigate to `https://api.naven.network/x402-test/ping`. The first response is a 402; the extension funds the per-site address (two owner transactions the first time: `setSiteCap` and `fund`), signs the authorization, reloads the tab with `PAYMENT-SIGNATURE`, and the page shows the paid body. The popup lists the payment with the settlement transaction from `PAYMENT-RESPONSE`.
4. Optionally repeat from a page that calls the endpoint with `fetch`; the second payment needs no funding transaction because the address still holds the rest of the chunk.

Primer (`https://x402.primer.systems`) runs the same scheme; any resource whose 402 lists `eip155:4663` with USDG and `extra: {name: "Global Dollar", version: "1"}` works.

## Brand assets

The toolbar icons in `public/icon/` and the in-page logo `public/logo.png` are rendered from `assets/brand/vortex.png` by `pnpm icons` (Playwright draws the circular crops; the PNGs are committed so a build needs no browser). The pages bundle Inter, Space Grotesk, and JetBrains Mono as variable woff2 files under `assets/fonts/` so they render offline; see `assets/fonts/LICENSE.md`.

## Known limitations

- Sub-frame document loads that answer 402 are observed but not retried; requests made from inside frames by `fetch` or XHR are handled.
- The page-side retry is subject to the site's CORS policy: a cross-origin API must allow the `PAYMENT-SIGNATURE` request header. When the retry fails the ledger marks the payment failed and the unused authorization simply expires.
- The XHR facade forwards `upload` events of the first request only; synchronous XHR and `no-cors` fetches are passed through unpaid.
- An approval window left open longer than three minutes counts as denied; the service worker may also be stopped by the browser while waiting, in which case the page receives the original 402.
- The top-up fee is quoted only for single-hop vault routes; two-hop routes, an unset token, or a failed quote skip the fee and deposit the full amount, and the dashboard says so.
- Tier limits are read from the vault at most every five minutes, so an unlock shows up after the next refresh of the Tiers page.
- Playwright is Apache-2.0 licensed and only a development dependency.
