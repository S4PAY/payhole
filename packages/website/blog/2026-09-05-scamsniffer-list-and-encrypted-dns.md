---
title: 353,000 scam domains on every node, and encrypted DNS for your phone
date: 2026-09-05
tag: Release
summary: Sinkhole now reads JSON blocklists and every node carries the ScamSniffer scam database. The public resolver at dns.payhole.org speaks DNS over HTTPS and TLS, so a phone can use it anywhere.
---

Two things landed today that change what Sinkhole blocks and where it can block it.

## The ScamSniffer scam database

[ScamSniffer](https://github.com/scamsniffer/scam-database) publishes an open database of phishing and wallet-drainer domains, about 353,000 names at the time of writing, updated daily, under the GPL-3.0 license. It is exactly the class of domain Sinkhole exists to stop, and it is the best public source we know of for it.

The list is published as a JSON array, which Sinkhole's subscription parser did not read. It does now: a list can be a hosts file, one name per line, a JSON array of hostnames, or a JSON object with a `domains` array. The parser change is small and covered by tests.

Every node we run subscribed to it today, next to the StevenBlack ad and tracker list. Each node now blocks about 433,000 domains, loaded into the resolver as a hosts file, refreshed with conditional requests every 24 hours. On a 2 GB board that pair leaves about a gigabyte of memory free; treat it as the sensible ceiling for lists on a small box.

To add it to your own node, paste this into the Lists tab or into `BLOCKLIST_URLS`:

```
https://raw.githubusercontent.com/scamsniffer/scam-database/refs/heads/main/blacklist/domains.json
```

The swarm keeps its job. Public lists know a domain once someone has reported it publicly; the swarm's flags are for the domains PayHole users hit first.

## dns.payhole.org

The public PayHole resolver now speaks DNS over HTTPS at `https://dns.payhole.org/dns-query` and DNS over TLS on `dns.payhole.org` port 853. It carries the same lists as the nodes, keeps no query log, and rate-limits each client.

That is what makes it useful on a phone away from home:

- Android: Settings, Network and internet, Private DNS, hostname `dns.payhole.org`. Every app, on Wi-Fi and on mobile data.
- iPhone and iPad: install the [profile](/dns/payhole-dns-signed.mobileconfig), which sets DNS over HTTPS system wide.
- Desktop browsers: the HTTPS address works as a custom secure DNS provider in Chrome, Edge, Brave, and Firefox.

Operators can do the same for their own node: the DoH and DoT listeners ship in this release, off by default, and take a certificate from the environment. The [Sinkhole page](/sinkhole.html) has the steps and the [README](https://github.com/S4PAY/payhole/tree/main/packages/sinkhole) has every variable.
