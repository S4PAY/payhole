# PayHole on Google Play: listing kit

Everything the Play Console asks for, in the order it asks. Images are in this folder and mirrored at
https://payhole.org/store/app/ so they can be downloaded from a phone or another machine.

## App details

- App name: PayHole
- Default language: English (United States)
- App or game: App
- Free or paid: Free
- Package name (fixed by the first upload): org.payhole.app
- Category: Tools
- Tags: privacy, security, DNS
- Contact email: hello@payhole.org
- Website: https://payhole.org
- Privacy policy: https://payhole.org/privacy.html

## Store listing

Short description (80 characters max):

    Drainers and phishing die at DNS. One tap covers every app. No account.

Full description:

    PayHole stops wallet drainers, phishing pages, and trackers at DNS, before your phone ever connects to them.

    One tap opens a DNS-only tunnel and sends every lookup on the phone, encrypted, to the PayHole resolver. Every app is covered: browsers, wallets, messengers, games. Nothing else about your traffic changes and nothing leaves the phone except the DNS queries themselves.

    WHAT IT DOES
    - Blocks about 815,000 names from three open lists: the ScamSniffer scam database, the Phishing.Database active phishing domains, and the StevenBlack ad and tracker list.
    - Adds the verdicts of a swarm of independent Sinkhole nodes, confirmed by tier holders, with a fast lane for drainer infrastructure.
    - Shares to check: send any link from any app to PayHole and get the answer: blocked or not, what kind of threat, and who confirmed it. Share the verdict back into the chat it came from.
    - Names every block: the last names it stopped, each with its category, with the full verdict and a report-a-mistake link one tap away.
    - Raises a notification when it stops a wallet drainer, drainer infrastructure, a phishing page, or a counterfeit token site. Trackers and ads go quietly.
    - Shows the radar: what the whole network learned in the last 24 hours, built from swarm confirmations and list refreshes, never from anyone's lookups.
    - Works with your own resolver: point it at a Sinkhole node you run, over DNS over HTTPS or DNS over TLS.

    WHAT IT DOES NOT DO
    - No account, no sign-in, no analytics, no ads.
    - No query log on the public resolver.
    - No traffic other than DNS goes through the tunnel. It is not a VPN for your browsing; it only carries lookups.
    - Nothing is stored off the phone. Counters and the last blocked names live in the app's private storage.

    HOW IT WORKS
    Android asks once to set up a VPN connection. That is how a DNS-only tunnel works on Android. The tunnel hands the phone one DNS address and routes only that address, so all other traffic keeps its normal path. Each query goes to the resolver over HTTPS, with TLS as the fallback, and comes back as a normal DNS answer. A blocked name answers with an empty address, so the app trying to reach it simply fails to connect.

    PayHole is part of an open project on Robinhood Chain. The token that funds it is only ever bought and burned; nobody is paid in it, and the app never asks you for it.

## Graphics

- App icon: icon-512.png (512 x 512, PNG)
- Feature graphic: feature-graphic-1024x500.png (1024 x 500, PNG)
- Phone screenshots, in this order (1080 x 1920, PNG): 1-one-tap.png, 2-share-to-check.png, 3-drainer-stopped.png, 4-every-block-named.png, 5-radar.png
- No 7-inch or 10-inch tablet screenshots; the app is phone-only for now. Play accepts the phone set alone.

## App content declarations

Privacy policy: https://payhole.org/privacy.html (the page has a section for the app).

Ads: No, the app contains no ads.

App access: All functionality is available without special access. No login.

Content rating questionnaire: category Utility, productivity, communication, or other. Answer no to every content question (no violence, sexuality, language, controlled substances, gambling, user interaction, sharing of location, purchases). Expected rating: Everyone.

Target audience: 18 and over. The app is not designed for children.

News app: No. COVID-19: No. Government app: No. Financial features: No, the app does not provide loans, banking, or payment features. (The wallet stays outside the app.)

Health: No health features.

Data safety:
- Does the app collect or share any of the required user data types: No.
  Rationale: DNS queries are sent to the resolver the user chose and are processed in memory; the public resolver keeps no query log. A hostname from a shared link is sent to the verdict endpoint and processed in memory. Neither is stored, which Google counts as ephemeral processing, not collection. Nothing is shared with third parties.
- Is all user data encrypted in transit: Yes (DNS over HTTPS, DNS over TLS, HTTPS).
- Do you provide a way for users to request deletion: Not applicable; nothing is collected. If the form insists, answer yes and point to hello@payhole.org.
- Security practices: data is encrypted in transit; the app follows the Families policy: not applicable.

Foreground service permissions (required for apps targeting Android 14 or later):
- The app uses one foreground service with type systemExempted, which Android allows for VpnService apps.
- Description to enter: "PayHole runs a DNS-only VpnService while protection is on. The foreground service keeps the tunnel alive so every DNS lookup on the device is forwarded encrypted to the chosen resolver and blocked names are refused. The service starts only when the user taps the ring and stops when they tap it again or use the Turn off action on the notification."
- If the form asks for a video, record the emulator or a phone: open the app, tap the ring, accept the VPN prompt, open a browser, then tap the ring again. Under thirty seconds is enough.

VPN policy: PayHole uses VpnService for device-level DNS filtering, which the policy allows. It does not collect data through the tunnel, does not redirect or inject traffic, and does not monetize the tunnel. Say so in the reviewer notes if asked.

## Releases

- Track for the first upload: Internal testing, then promote to Production once it installs. Skipping straight to Production also works; the review is the same.
- File: dist/payhole-0.3.0-release.aab, signed with the upload key. Play App Signing will generate the app signing key on the first upload; keep it on.
- Version: 0.3.0, versionCode 8.
- Release name: 0.3.0
- Release notes:

    First Play release. Encrypted DNS for every app on the phone with one tap. Share any link to check it. Every block named with its category. Notifications when a drainer or phishing page is stopped. The radar: what the network learned today.

- Countries: all.

Beta users who installed the APK from payhole.org must uninstall it before installing from Play; the Play build is signed with a different key. Their counters start fresh.

## Reviewer notes

    PayHole is a DNS filter. Tap the ring on the Home tab, accept the VPN prompt, and DNS is forwarded encrypted to dns.payhole.org. The tunnel carries only DNS. To test a block, open https://payhole.org/check.html on the phone, paste any name the Check tab reports as blocked, then try to open it in the browser: it fails to connect. The Radar tab and the Check tab read public endpoints on dns.payhole.org. No account is needed anywhere.

## Keys

The upload keystore and its passwords live outside the repository, in ~/.payhole on the build machine and in /opt/payhole/app on the box. The build reads them from the environment through plugins/withReleaseSigning.js. Never commit them.
