---
title: Share a link to PayHole
date: 2026-09-06
tag: Release
card: check
summary: PayHole for Android 0.2 answers from the share sheet. Send it any link and the resolver says whether the network blocks it and why. Blocked names carry their category, and a stopped drainer raises a notification.
---

The first beta made the resolver visible: a ring, counters, the names it stopped. The second one
lets you ask it a question before you tap. Update the beta from
[payhole.org/downloads/payhole.apk](/downloads/payhole.apk), or check a link on the web at
[payhole.org/check.html](/check.html) with nothing installed.

## Share to check

Any app with a share sheet can now hand a link to PayHole: a message, a mail, a tweet, a QR
scanner. Pick PayHole from the sheet and the Check tab opens with the verdict already on it. The
app pulls the first hostname out of whatever was shared, so a whole pasted message works as well as
a bare link, and asks the resolver's public verdict endpoint. The answer is one of three:

- **Blocked**, with the category: wallet drainer, drainer infrastructure, phishing, counterfeit
  token site, tracker, or ad. Under it, who said so: the swarm and how many nodes agreed, a
  subscribed list, or an operator.
- **Allowlisted**: a shared platform such as sites.google.com that lists keep naming and every node
  keeps reachable on purpose.
- **Not blocked**: the network has nothing on the name today. That is not a clean bill. New phishing
  pages appear every hour and the swarm catches them as nodes report.

The verdict shares back out as text, so the answer can go straight into the chat where the link
came from. The same endpoint is open to anyone: `https://dns.payhole.org/verdict?name=` followed by
a hostname returns JSON, with the same rate limit as the resolver itself.

## Every block has a category

The last-blocked list on the Home tab now tags each name with what it was. The tunnel only sees
that an answer was sunk, so the app asks the resolver about each new name once, off the DNS path,
and remembers the answer. Tap a name for the full verdict and a button that reports a mistake to
the operators, because lists are written by people and a wrong block should be easy to say out
loud.

## A drainer stopped is worth a notification

Trackers and ads go by silently; nobody wants a buzz for every one. But when the resolver stops a
wallet drainer, drainer infrastructure, a phishing page, or a counterfeit token site on your phone,
that is the moment a link in a message tried to get at you. The app raises a notification saying
what it stopped, at most once per name in a while. It comes from the phone itself, not from a
server, because the app has no server.

## Smaller things

Storage and overlay permissions that libraries request by default are stripped from the manifest;
the app needs none of them. The resolver check prints that a lookup came back with one address
record and no longer the address. Version 0.2.0 replaces 0.1.5 at the same link, and the beta key
is unchanged, so it installs over the old one.
