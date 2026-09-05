#!/usr/bin/env python3
"""Converts the design artboards (.dc.html exported from the design canvas) into the static pages under static/.

Usage: python3 scripts/convert-artboards.py <directory with the five .dc.html files>

The markup, inline styles, and copy are kept verbatim. Only the template placeholders are expanded with the data
the artboards carry, links are pointed at real pages, and ids are added where the page scripts attach behaviour.
"""
import os, re, sys

if len(sys.argv) < 2:
    sys.exit("usage: convert-artboards.py <uploads dir>")
U = sys.argv[1]
W = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
S = os.path.join(W, "static")

def find(prefix):
    """Newest file named <hash>-<prefix>.dc.html or <prefix>.dc.html in the uploads directory."""
    matches = [os.path.join(U, f) for f in os.listdir(U) if f.endswith(f"-{prefix}.dc.html") or f == f"{prefix}.dc.html"]
    if not matches:
        sys.exit(f"missing {prefix}.dc.html in {U}")
    return max(matches, key=os.path.getmtime)

pages = {"index": find("Home"), "creators": find("Creators"), "developers": find("Developers"), "token": find("Token"), "trust": find("Trust")}
HREFS = [("Home.dc.html#sinkhole", "/sinkhole.html"), ("Home.dc.html", "/"), ("Creators.dc.html", "/creators.html"),
         ("Developers.dc.html", "/developers.html"), ("Token.dc.html", "/token.html"), ("Trust.dc.html", "/trust.html")]

def between(s, a, b):
    i = s.index(a) + len(a); j = s.index(b, i); return s[i:j]

styles, bodies = {}, {}
for name, path in pages.items():
    src = open(path, encoding="utf-8").read()
    helmet = between(src, "<helmet>", "</helmet>")
    styles[name] = between(helmet, "<style>", "</style>")
    bodies[name] = src[src.index("</helmet>") + len("</helmet>"):src.index("</x-dc>")]

seen = []
for name in ["index", "token", "creators", "developers", "trust"]:
    for line in styles[name].strip().split("\n"):
        line = line.strip()
        if line and line not in seen: seen.append(line)
shared = "\n".join(seen).replace("body{margin:0;", "body{margin:0;overflow-x:clip;")
shared += """
input:focus{border-color:var(--accent)!important}
.ph-layer{position:absolute;inset:0;padding:0 24px;opacity:0;transition:opacity .25s linear,transform .25s ease;pointer-events:none}
.ph-layer[data-layer="0"]{opacity:1;pointer-events:auto}
.ph-empty{padding:18px 24px;border-top:1px solid var(--border);font:400 14px Inter;color:var(--muted)}
.ph-hidden{display:none!important}
@media (max-width:720px){
[data-r=split]>*,[data-r=three]>*,[data-r=four]>*{min-width:0}
[data-r=table]{min-width:0;max-width:100%;overflow-x:auto!important}
[data-r=foot],[data-r=foot]>span{flex-wrap:wrap}
pre,code{overflow-wrap:anywhere}
.ph-nav[style*="2fr 1fr 1fr 1fr"]{grid-template-columns:1fr 1fr!important}
.ph-nav[style*="2fr 1fr 1fr 1fr"]>div:first-child{grid-column:1/-1}
.ph-nav a{overflow-wrap:anywhere}
input,textarea,select{box-sizing:border-box;max-width:100%}
#burned-note,#feed-note{white-space:normal!important}
[style*="grid-template-columns:1.4fr 3fr;"]{grid-template-columns:1fr!important;gap:4px!important}
[style*="linear-gradient(90deg,var(--bg) 0%"]{background:linear-gradient(180deg,var(--bg) 0%,rgba(0,0,0,.9) 45%,rgba(0,0,0,.4) 70%,transparent 90%)!important}
}
@media (max-width:860px){[data-r~=four]{grid-template-columns:repeat(2,minmax(0,1fr))!important}[data-r~=arch]{padding:24px!important}}
@media (max-width:720px){[style*="grid-template-columns:minmax(0,1fr) minmax(0,1fr)"]{grid-template-columns:1fr!important}[style*="display:flex;gap:12px;padding-top:4px"],[style*="grid-column:1 / -1;display:flex;align-items:center;gap:16px"]{flex-wrap:wrap}}
@media (max-width:520px){[data-r~=four]{grid-template-columns:minmax(0,1fr)!important}}
"""
open(os.path.join(S, "styles.css"), "w").write(shared + "\n")

FONTS = '<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">'
IMPORTMAP = '<script type="importmap">{"imports":{"three":"/js/vendor/three/build/three.module.js","three/addons/":"/js/vendor/three/examples/jsm/"}}</script>'
CARD_PAGES = {"creators.html", "developers.html", "token.html", "trust.html"}
def social(title, desc, name):
    url = "https://payhole.org/" + ("" if name == "index.html" else name)
    image = f"https://payhole.org/cards/{name[:-5]}.png" if name in CARD_PAGES else "https://payhole.org/og.jpg"
    itype = "image/png" if name in CARD_PAGES else "image/jpeg"
    return (f'<meta property="og:title" content="{title}"><meta property="og:description" content="{desc}"><meta property="og:type" content="website"><meta property="og:site_name" content="PayHole"><meta property="og:url" content="{url}">'
            f'<meta property="og:image" content="{image}"><meta property="og:image:secure_url" content="{image}"><meta property="og:image:type" content="{itype}"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630"><meta property="og:image:alt" content="{title}">'
            f'<meta name="twitter:card" content="summary_large_image"><meta name="twitter:site" content="@payhole_x402"><meta name="twitter:title" content="{title}"><meta name="twitter:description" content="{desc}"><meta name="twitter:image" content="{image}">'
            f'<link rel="me" href="https://x.com/payhole_x402"><link rel="canonical" href="{url}">')

def head(title, desc, script=None, scene=False, name="index.html"):
    s = f'<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<title>{title}</title>\n<meta name="description" content="{desc}">\n{social(title, desc, name)}<meta name="theme-color" content="#000000">\n<link rel="icon" href="/favicon.png" type="image/png" sizes="64x64"><link rel="apple-touch-icon" href="/apple-touch-icon.png">\n{FONTS}\n<link rel="stylesheet" href="/styles.css">\n'
    if scene:
        # The design's hero is the aperture-scene element from aperture.js (three.js), served from this origin.
        s += IMPORTMAP + "\n"
        if os.path.exists(os.path.join(S, "js", "aperture.js")): s += '<script type="module" src="/js/aperture.js"></script>\n'
    if script: s += f'<script type="module" src="/js/pages/{script}.js"></script>\n'
    return s + "</head>\n<body>\n"

def common(body):
    for a, b in HREFS: body = body.replace(f'href="{a}"', f'href="{b}"')
    body = body.replace('href="#sinkhole"', 'href="/sinkhole.html"')
    body = body.replace('<span class="ph-mark" style="display:inline-block;width:17px;height:17px;border-radius:50%;margin:0 1px"></span>', '<img src="/logo.png" alt="" width="19" height="19" style="display:inline-block;width:19px;height:19px;margin:0 1px;vertical-align:-2px">')
    body = body.replace('<a class="ph-lava" style=', '<a href="/extension.html" class="ph-lava" style=')
    body = body.replace("<a>Extension</a>", '<a href="/extension.html">Extension</a><a href="/try.html">Try it</a>')
    body = body.replace("<span style=\"font:600 20px 'Space Grotesk';letter-spacing:-0.03em\">PayHole</span>", "<span style=\"font:600 20px 'Space Grotesk';letter-spacing:-0.03em\">PayH<img src=\"/logo.png\" alt=\"\" width=\"17\" height=\"17\" style=\"display:inline-block;width:17px;height:17px;margin:0 1px;vertical-align:-2px\">le</span>")
    body = body.replace('<span>payhole.org</span></div>', '<span style="display:flex;gap:16px"><a href="/blog/">Blog</a><a href="/privacy.html">Privacy</a><a href="https://github.com/S4PAY/payhole">github.com/S4PAY/payhole</a><a href="https://www.npmjs.com/package/@payhole/sdk">npm @payhole/sdk</a><a href="https://x.com/payhole_x402" rel="me">x.com/payhole_x402</a><span>payhole.org</span></span></div>')
    body = body.replace('display:flex;justify-content:space-between;gap:16px;border-top:1px solid var(--border);padding-top:24px;font:400 13px', 'display:flex;justify-content:space-between;gap:16px;border-top:1px solid var(--border);padding-top:24px;font:400 13px').replace("<div style=\"max-width:1200px;margin:0 auto;padding:32px 24px;display:flex;justify-content:space-between;gap:16px;font:400 13px 'JetBrains Mono';color:var(--muted)\">", "<div data-r=\"foot\" style=\"max-width:1200px;margin:0 auto;padding:32px 24px;display:flex;justify-content:space-between;gap:16px;font:400 13px 'JetBrains Mono';color:var(--muted)\">").replace("<div style=\"display:flex;justify-content:space-between;gap:16px;border-top:1px solid var(--border);padding-top:24px;font:400 13px 'JetBrains Mono';color:var(--muted)\">", "<div data-r=\"foot\" style=\"display:flex;justify-content:space-between;gap:16px;border-top:1px solid var(--border);padding-top:24px;font:400 13px 'JetBrains Mono';color:var(--muted)\">")
    body = body.replace("<a>@payhole/sdk</a>", '<a href="/docs.html#sdk">@payhole/sdk</a>')
    body = body.replace("<a>verifier.payhole.org</a>", '<a href="https://verifier.payhole.org/healthz">verifier.payhole.org</a>')
    body = body.replace("<a>robinhoodchain.blockscout.com</a>", '<a href="https://robinhoodchain.blockscout.com">robinhoodchain.blockscout.com</a>')
    body = re.sub(r'\s*style-focus="[^"]*"', "", body)
    body = re.sub(r'\s*on(Change|Click)="\{\{ [^}]+ \}\}"', "", body)
    return body

def expand(body, list_name, rows):
    m = re.search(r'<sc-for list="\{\{ ' + list_name + r' \}\}" as="(\w+)"[^>]*>(.*?)</sc-for>', body, re.S)
    alias, tpl = m.group(1), m.group(2)
    out = []
    for r in rows:
        t = tpl
        for k, v in r.items():
            t = t.replace("{{ " + alias + "." + k + " }}", v)
            if k == alias: t = t.replace("{{ " + alias + " }}", v)
        out.append(t.strip())
    return body[:m.start()] + "\n".join(out) + body[m.end():]

SF = lambda a: f"https://repo.sourcify.dev/contracts/full_match/4663/{a}/"
BS = lambda a: f"https://robinhoodchain.blockscout.com/address/{a}"
CONTRACTS = [("BudgetAccountFactory", "0x68b5bb42fec83db9582758bbcb1fc43f748970d6"), ("BurnVault", "0x298712ca3a1367bbd8caabd5269b05985228eedf"), ("CreatorRegistry", "0x5d483aec0735d550d09018a2e89c49c190962deb")]

def write(name, title, desc, body, script=None, scene=False):
    open(os.path.join(S, name), "w").write(head(title, desc, script, scene, name) + body + "\n</body>\n</html>\n")

# ---- Home
b = common(bodies["index"])
b = b.replace('<x-import component-from-global-scope="aperture-scene" hint-size="100%,100%"></x-import>', '<aperture-scene style="position:absolute;inset:0;display:block"><canvas id="aperture" aria-hidden="true" style="position:absolute;inset:0;width:100%;height:100%"></canvas></aperture-scene>')
b = b.replace('<div data-scroll-track style="height:520vh;position:relative">', '<div id="track" data-scroll-track style="height:520vh;position:relative">')
for i in range(5):
    b = b.replace(f'<div style="{{{{ l{i} }}}}">', f'<div class="ph-layer" data-layer="{i}">')
b = b.replace("{{ ringBg }}", "conic-gradient(var(--accent) 0deg 9deg, var(--border) 9deg 360deg)").replace("{{ pct }}", "2%").replace("{{ spentText }}", "0.12")
b = b.replace('<div style="position:absolute;left:0;right:0;bottom:24px;display:flex;justify-content:center;gap:8px">', '<div id="dots" style="position:absolute;left:0;right:0;bottom:24px;display:flex;justify-content:center;gap:8px">')
for i in range(5):
    b = b.replace(f"background:{{{{ d{i} }}}}", "background:var(--accent)" if i == 0 else "background:var(--border)")
b = b.replace('<div class="ph-lava-ember-text" style="font:500 clamp(64px,8vw,112px) \'JetBrains Mono\';letter-spacing:-0.04em;line-height:1">{{ burned }}</div>', '<div id="burned" class="ph-lava-ember-text" style="font:500 clamp(64px,8vw,112px) \'JetBrains Mono\';letter-spacing:-0.04em;line-height:1">0</div>')
b = b.replace('<span style="white-space:nowrap">live · PAYHOLE · fixed supply</span>', '<span id="burned-note" style="white-space:nowrap">live · PAYHOLE · fixed supply</span>')
b = expand(b, "features", [
  {"t": "Caps", "d": "One number per site. Nothing above it moves without you.", "c": "var(--accent)"},
  {"t": "Silent payments", "d": "HTTP 402 settled in USDG. Gasless for you. No popups under the cap.", "c": "var(--accent)"},
  {"t": "Per-site addresses", "d": "Derived from your seed, one per origin. A site sees one address and nothing else.", "c": "var(--accent)"},
  {"t": "Agent session keys", "d": "Give a tool or agent its own key with its own cap. Revoke it any time.", "c": "var(--accent)"},
  {"t": "Creator tips", "d": "Registered domains get tipped per visit from your pocket. Fair by default.", "c": "var(--accent)"},
  {"t": "Sinkhole", "d": "Self-hosted DNS. Blocks trackers and drainers. Shares scam flags in a peer swarm.", "c": "#FF4D4D"},
  {"t": "Unlock tiers", "d": "Burn to raise your limits. Three tiers. Nothing else changes.", "c": "#FF9E3D"},
  {"t": "Token burns", "d": "Fixed supply. Only ever bought and burned. Pays no one.", "c": "#FF9E3D"},
])
b = expand(b, "tiers", [
  {"n": "Tier 1", "b": '<span data-tier="1">50,000</span>', "u": "Pocket cap to 50 USDG. 5 session keys."},
  {"n": "Tier 2", "b": '<span data-tier="2">100,000</span>', "u": "Pocket cap to 500 USDG. 50 keys. Custom Sinkhole lists."},
  {"n": "Tier 3", "b": '<span data-tier="3">500,000</span>', "u": "Pocket cap to 5,000 USDG. Unlimited keys. Swarm priority."},
])
b = expand(b, "contracts", [{"n": n, "a": a, "s": SF(a)} for n, a in CONTRACTS])
b = expand(b, "faq", [
  {"q": "What happens when a site goes over its cap?", "a": "You get one prompt. Approve, raise the cap, or decline. Nothing moves until you answer."},
  {"q": "Can a site see my other addresses?", "a": "No. Each address is derived for one origin. A site sees its own address and its own cap."},
  {"q": "Who pays gas?", "a": "Not you. x402 settlement is gasless for the payer. The facilitator submits the transaction."},
  {"q": "Does the token earn anything?", "a": "No. It is bought and burned. There is no staking, yield, cashback, or airdrop."},
  {"q": "Is Sinkhole a VPN?", "a": "No. It is a DNS resolver you run yourself. Blocked domains get no answer. Your traffic goes where it always went."},
  {"q": "Can I read the contracts?", "a": "Yes. They are open source, tested, and verified on Sourcify. Read them before you fund a pocket."},
])
write("index.html", "PayHole", "A capped spending pocket on Robinhood Chain that pays websites, tools, and agents over x402 while you browse.", b, "home", scene=True)

# ---- Creators
b = common(bodies["creators"])
b = b.replace('<input value="{{ domain }}" placeholder="example.com"', '<input id="domain" value="example.com" placeholder="example.com" autocomplete="off" spellcheck="false"')
b = b.replace('<input value="{{ wallet }}" placeholder="0x…"', '<input id="wallet" value="" placeholder="0x…" autocomplete="off" spellcheck="false"')
b = b.replace("{{ record }}", '_payhole.example.com  TXT  "payhole=0xYourWallet"')
b = re.sub(r'<pre style="margin:0;background:var\(--surface\);border:1px dashed', '<pre id="record" style="margin:0;background:var(--surface);border:1px dashed', b, count=1)
b = b.replace('<button class="ph-lava" style="font:600 15px Inter;padding:13px 22px;border-radius:8px;border:0;cursor:pointer;white-space:nowrap">Sign and verify</button>', '<button id="attest" type="button" class="ph-lava" style="font:600 15px Inter;padding:13px 22px;border-radius:8px;border:0;cursor:pointer;white-space:nowrap">Sign and verify</button>')
b = b.replace('<button class="ph-ghost" style="color:var(--text);font:600 15px Inter;padding:12px 22px;border-radius:8px;cursor:pointer;white-space:nowrap">Check DNS only</button></div>', '<button id="check" type="button" class="ph-ghost" style="color:var(--text);font:600 15px Inter;padding:12px 22px;border-radius:8px;cursor:pointer;white-space:nowrap">Check DNS only</button></div><div id="form-note" class="ph-hidden" style="font:400 13px/1.5 Inter;color:var(--muted)"></div>')
b = b.replace('border:1px solid {{ resultBorder }};border-radius:16px;padding:32px;display:flex;flex-direction:column;gap:24px;transition:border-color .3s">', 'border:1px solid var(--border);border-radius:16px;padding:32px;display:flex;flex-direction:column;gap:24px;transition:border-color .3s" id="result">')
b = b.replace('word-break:break-all">{{ domainShown }}</div>', 'word-break:break-all" id="r-domain">example.com</div>')
b = b.replace('<div style="font:500 12px Inter;color:{{ statusColor }};border:1px solid {{ resultBorder }};border-radius:999px;padding:5px 10px;white-space:nowrap">{{ status }}</div>', '<div id="r-status" style="font:500 12px Inter;color:var(--muted);border:1px solid var(--border);border-radius:999px;padding:5px 10px;white-space:nowrap">Not checked</div>')
b = b.replace('<div style="font:500 14px Inter;color:{{ statusColor }}">{{ txt }}</div>', '<div id="r-txt" style="font:500 14px Inter;color:var(--muted)">—</div>')
b = b.replace('<div style="font:500 14px Inter;color:{{ statusColor }}">{{ sig }}</div>', '<div id="r-sig" style="font:500 14px Inter;color:var(--muted)">—</div>')
b = b.replace('word-break:break-all">{{ walletShort }}</div>', 'word-break:break-all" id="r-wallet">—</div>')
b = b.replace('<span>{{ attestedAt }}</span>', '<span id="r-time">no attestation yet</span>')
b = b.replace('style="color:var(--muted)">View on explorer</a>', 'style="color:var(--muted)" id="r-explorer">View on explorer</a>')
b = b.replace('<div style="border-top:1px solid var(--border);padding-top:16px;display:flex;justify-content:space-between;font:400 13px \'JetBrains Mono\';color:var(--muted)"><span id="r-time">', '<pre id="r-calldata" class="ph-hidden" style="margin:0;background:var(--surface);border:1px dashed var(--border);border-radius:8px;padding:14px 16px;font:400 12px/1.6 \'JetBrains Mono\';white-space:pre-wrap;word-break:break-all"></pre><div style="border-top:1px solid var(--border);padding-top:16px;display:flex;justify-content:space-between;font:400 13px \'JetBrains Mono\';color:var(--muted)"><span id="r-time">')
b = b.replace('{{ domainShown }} · last 24 hours</div>', 'example.com · recent blocks</div>')
b = b.replace('<div style="font:400 13px \'JetBrains Mono\';color:var(--muted)">example.com · recent blocks</div>', '<div id="tips-note" style="font:400 13px \'JetBrains Mono\';color:var(--muted)">example.com · recent blocks</div>')
b = b.replace('<div data-r="table" class="ph-glass" style="border-radius:12px;overflow:hidden">', '<div id="tips" data-r="table" class="ph-glass" style="border-radius:12px;overflow:hidden">', 1)
m = re.search(r'<sc-for list="\{\{ tips \}\}".*?</sc-for>', b, re.S)
b = b[:m.start()] + '<div id="tips-empty" class="ph-empty">No tips in the most recent blocks. Older tips are on the explorer under the wallet\'s token transfers.</div>' + b[m.end():]
write("creators.html", "Creators · PayHole", "Register your domain with one DNS record and get tipped per visit in USDG.", b, "creators")

# ---- Developers
b = common(bodies["developers"])
b = b.replace('<button style="font:500 12px Inter;color:var(--muted);background:transparent;border:1px solid var(--border);border-radius:6px;padding:4px 8px;cursor:pointer">{{ copyLabel }}</button>', '<button id="copy" type="button" data-copy="npm i @payhole/sdk" style="font:500 12px Inter;color:var(--muted);background:transparent;border:1px solid var(--border);border-radius:6px;padding:4px 8px;cursor:pointer">Copy</button>')
b = expand(b, "facts", [{"k": k, "v": v} for k, v in [("protocol", "x402 version 2"), ("request header", "PAYMENT-SIGNATURE"), ("response headers", "PAYMENT-REQUIRED · PAYMENT-RESPONSE"), ("network", "eip155:4663"), ("asset", "USDG"), ("scheme", "exact"), ("gas", "paid by facilitator, never by the payer")]])
b = expand(b, "docs", [
  {"k": "npm", "t": "@payhole/sdk", "d": "payholeFetch, key management, session keys, types.", "l": "Package", "h": "/docs.html#sdk"},
  {"k": "reference", "t": "payhole CLI", "d": "key create, status, pay, and flags for agents.", "l": "Commands", "h": "/docs.html#cli"},
  {"k": "server", "t": "Accept x402", "d": "Return a 402 with a price. Verify the signature. Serve.", "l": "Guide", "h": "/docs.html#server"},
  {"k": "contracts", "t": "BudgetAccount ABI", "d": "Factory, vault, registry. Verified on Sourcify.", "l": "Source", "h": "/trust.html"},
])
write("developers.html", "Developers · PayHole", "payholeFetch, the payhole CLI, and the x402 facts a server needs to get paid in USDG on Robinhood Chain.", b, "developers")

# ---- Token
b = common(bodies["token"])
b = b.replace('line-height:1">{{ burned }}</div>', 'line-height:1" id="burned">0</div>')
b = b.replace('<span style="white-space:nowrap">live · PAYHOLE · fixed supply · {{ pctSupply }} of supply</span>', '<span id="burned-note" style="white-space:nowrap">live · PAYHOLE · fixed supply · 0.0% of supply</span>')
b = expand(b, "tiers", [
  {"n": "Tier 1", "b": '<span data-tier="1">50,000</span>', "c": "50 USDG", "k": "5", "a": "—"},
  {"n": "Tier 2", "b": '<span data-tier="2">100,000</span>', "c": "500 USDG", "k": "50", "a": "Custom Sinkhole lists"},
  {"n": "Tier 3", "b": '<span data-tier="3">500,000</span>', "c": "5,000 USDG", "k": "Unlimited", "a": "Swarm priority"},
])
b = b.replace('<span style="white-space:nowrap">live from BurnVault</span>', '<span id="feed-note" style="white-space:nowrap">live from BurnVault</span>')
m = re.search(r'<sc-for list="\{\{ feed \}\}".*?</sc-for>', b, re.S)
b = b[:m.start()] + '<div id="feed-empty" class="ph-empty">No burns in the most recent blocks.</div>' + b[m.end():]
b = b.replace('<div data-r="table" class="ph-glass" style="border-radius:12px;overflow:hidden">\n    <div style="display:grid;grid-template-columns:1.2fr 1.6fr 1.4fr 2fr', '<div id="feed" data-r="table" class="ph-glass" style="border-radius:12px;overflow:hidden">\n    <div style="display:grid;grid-template-columns:1.2fr 1.6fr 1.4fr 2fr')
write("token.html", "Token · PayHole", "The PayHole token is fixed supply and only ever bought and burned. Live total burned, tiers, and the burn feed.", b, "token")

# ---- Trust
b = common(bodies["trust"])
b = expand(b, "arch", [
  {"h": "Your machine", "t1": "Extension", "d1": "Manifest V3. Holds the seed. Intercepts 402s.", "b1": "var(--border)", "t2": "Sinkhole", "d2": "Self-hosted DNS. Blocks trackers and drainers. Peer swarm for scam flags.", "b2": "rgba(255,77,77,0.5)", "c2": "var(--text)"},
  {"h": "Derived", "t1": "Per-site addresses", "d1": "One per origin, from the seed. Each with its own cap.", "b1": "var(--border)", "t2": "BudgetAccount", "d2": "Your pocket. Enforces caps on chain. From BudgetAccountFactory.", "b2": "var(--accent)", "c2": "var(--text)"},
  {"h": "Settlement", "t1": "Facilitator", "d1": "Submits x402 settlements. Pays gas. Cannot exceed a cap.", "b1": "var(--border)", "t2": "Burn vault", "d2": "Buys and burns PAYHOLE. Credits tiers to pockets.", "b2": "rgba(255,158,61,0.6)", "c2": "#FF9E3D"},
  {"h": "Creators", "t1": "Verifier", "d1": "verifier.payhole.org. Reads TXT records, checks attestations.", "b1": "var(--border)", "t2": "Registry", "d2": "CreatorRegistry. Domain to wallet. Tips route here.", "b2": "var(--border)", "c2": "var(--text)"},
])
b = expand(b, "can", [{"x": x} for x in ["The one address derived for its origin", "The payments that address made to it", "Whether a 402 was settled or declined", "That the payer is a PayHole pocket, if it looks"]])
b = expand(b, "cannot", [{"x": x} for x in ["Your seed or any other site's address", "Your pocket balance or its cap", "Where else you have paid", "Your blocklist, your swarm peers, or your DNS queries"]])
b = expand(b, "contracts", [{"n": n, "a": a, "s": SF(a), "e": BS(a)} for n, a in CONTRACTS])
b = b.replace("{{ safeExplorer }}", BS("0xfCeB8905E316D383Cd90Aa1Ab04ab1650611445b"))
b = b.replace("<a>Contracts repository</a>", '<a href="https://github.com/S4PAY/payhole/tree/main/packages/contracts">Contracts repository</a>')
b = b.replace("<a>Extension repository</a>", '<a href="https://github.com/S4PAY/payhole/tree/main/packages/extension">Extension repository</a>')
b = b.replace("<a>Test reports</a>", '<a href="https://github.com/S4PAY/payhole/tree/main/packages/contracts/test">Test reports</a>')
# "Read the code" card: Sinkhole points at the package; every other Sinkhole link stays on the home section
i = b.index("Read the code"); j = b.index("Test reports", i)
b = b[:i] + b[i:j].replace("<a>Sinkhole</a>", '<a href="https://github.com/S4PAY/payhole/tree/main/packages/sinkhole">Sinkhole</a>') + b[j:]
b = b.replace("<a>Sinkhole</a>", '<a href="/sinkhole.html">Sinkhole</a>')
write("trust.html", "Trust · PayHole", "Every part that touches your money, what each one can see, and where to read the code.", b)

for f in sorted(os.listdir(S)):
    if f.endswith(".html") and f not in ("extension.html", "docs.html"):
        t = open(os.path.join(S, f)).read()
        left = re.findall(r"\{\{[^}]*\}\}|<sc-for|<x-import|style-focus|onChange|onClick", t)
        print(f, "leftovers:", left[:5] if left else "none")
