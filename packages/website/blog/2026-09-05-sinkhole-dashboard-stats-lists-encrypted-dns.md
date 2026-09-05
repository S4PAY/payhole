---
title: Sinkhole gets a dashboard, query statistics, list subscriptions, and encrypted DNS
date: 2026-09-05
tag: Release
summary: Sinkhole, PayHole's DNS blocker, now runs on 64-bit ARM boards, shows Pi-hole-class statistics, subscribes to public blocklists, and speaks DNS over HTTPS and TLS.
---

Sinkhole is the resolver you run at home or on a server. It blocks drainer, phishing, and tracker domains for every device on the network and shares verdicts with every other node through a peer swarm. This release turns it from a service with an API into something you can look at.

## Dashboard

The admin page is now a dashboard in the site's visual language: status cards that work before you log in, a token screen, pill tabs, source tags on every blocked domain, a reporters-over-threshold meter on each swarm flag, and a Node tab that shows the running configuration. It reads well on a phone.

## Query statistics and a query log

The resolver now logs queries to the supervisor, which aggregates them in memory and persists a snapshot every minute:

- 24 hours at one-minute resolution and 7 days at one-hour resolution, permitted against blocked
- clients, top permitted and top blocked domains, query types, upstreams
- a live query log with a filter and status chips

Charts are inline SVG, drawn by the page, no external library and no external requests. `QUERY_LOG_ENABLED=0` turns all of it off for nodes that should not keep query data.

## Blocklist subscriptions

Subscribe to hosts-format lists by URL from the Lists tab or with `BLOCKLIST_URLS`. Lists are fetched with conditional requests, refreshed every 24 hours, and loaded into the resolver as a hosts file. Rendering 300,000 names takes about 150 ms on a laptop; the resolver reload on a 2 GB board is being measured and will be recorded in the README.

## Encrypted DNS

Two new listeners, both off by default: DNS over HTTPS on port 8054, meant to sit behind a reverse proxy that terminates TLS, and DNS over TLS on port 853 with the node's own certificate, re-read when it renews. Both share a per-client rate limit and count in the statistics. This is what lets a phone use a node from anywhere: Android's Private DNS setting takes a hostname, iOS takes a profile. The public PayHole resolver at dns.payhole.org is the next deployment.

## Tested on real boards

The image builds on 64-bit ARM: a Radxa Rock Pi and an NVIDIA Jetson took about fifteen minutes each to build and run the container at about 120 MB of memory. Four nodes on one network confirmed a domain flagged by two of them and blocked it on the others within seconds. Pi-hole can sit in front of Sinkhole on the same box by pointing its upstream at the node on port 5335.

## Public bootstrap node

A relay-only node runs on the PayHole server. Its address is on the [Sinkhole page](/sinkhole.html), and it accepts flags only from wallets that hold a tier. Nodes behind home routers connect to it outbound with no port forwarding.

The full guide, hardware list, and every setting are on [payhole.org/sinkhole.html](/sinkhole.html) and in the [README](https://github.com/S4PAY/payhole/tree/main/packages/sinkhole).
