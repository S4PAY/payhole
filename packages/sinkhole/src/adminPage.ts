import { join } from "node:path";
import { fileURLToPath } from "node:url";

/** Package root, one level above `src/` and `dist/`, so assets resolve the same way before and after compilation. */
const packageRoot = fileURLToPath(new URL("..", import.meta.url));

export interface AdminAsset {
  file: string;
  contentType: string;
}

/** Static files the admin page loads. Everything is served from this origin; the page needs no internet. */
export const ADMIN_ASSETS: Readonly<Record<string, AdminAsset>> = {
  "/admin/styles.css": { file: join(packageRoot, "assets", "admin", "styles.css"), contentType: "text/css; charset=utf-8" },
  "/admin/client.js": { file: join(packageRoot, "dist", "adminClient.js"), contentType: "text/javascript; charset=utf-8" },
  "/admin/logo.png": { file: join(packageRoot, "assets", "admin", "logo.png"), contentType: "image/png" },
  "/admin/fonts/Inter.woff2": { file: join(packageRoot, "assets", "admin", "fonts", "Inter.woff2"), contentType: "font/woff2" },
  "/admin/fonts/SpaceGrotesk.woff2": { file: join(packageRoot, "assets", "admin", "fonts", "SpaceGrotesk.woff2"), contentType: "font/woff2" },
  "/admin/fonts/JetBrainsMono.woff2": { file: join(packageRoot, "assets", "admin", "fonts", "JetBrainsMono.woff2"), contentType: "font/woff2" },
};

/** Content security policy for the page: only this origin, no inline code. */
export const ADMIN_CSP = "default-src 'none'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'self'";

/** The admin page markup. All behaviour lives in `adminClient.ts`, served as `/admin/client.js`. */
export const ADMIN_PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>PayHole Sinkhole</title>
<link rel="icon" href="/admin/logo.png" type="image/png">
<link rel="stylesheet" href="/admin/styles.css">
<script type="module" src="/admin/client.js"></script>
</head>
<body>
<header class="top">
  <div class="top-inner">
    <a class="brand" href="/"><img src="/admin/logo.png" alt=""><span class="brand-name">PayHole <span>Sinkhole</span></span></a>
    <div class="conn">
      <span id="host" class="host mono muted"></span>
      <span id="conn" class="pill"><span class="pill-text" id="conn-text">offline</span></span>
      <button id="refresh" type="button" class="small" hidden>Refresh</button>
      <button id="disconnect" type="button" class="link small" hidden>Disconnect</button>
    </div>
  </div>
</header>

<main class="page">
  <section class="stats" id="stats" aria-label="Status">
    <div class="stat"><div class="label">Resolver</div><div class="value" id="s-resolver">&#8212;</div><div class="sub" id="s-resolver-sub">checking</div></div>
    <div class="stat"><div class="label">Domains blocked</div><div class="value" id="s-blocked">&#8212;</div><div class="sub" id="s-blocked-sub">connect to see the breakdown</div></div>
    <div class="stat"><div class="label">Swarm peers</div><div class="value" id="s-peers">&#8212;</div><div class="sub" id="s-peers-sub">checking</div></div>
    <div class="stat"><div class="label">Flags pending</div><div class="value" id="s-flags">&#8212;</div><div class="sub" id="s-flags-sub">connect to see</div></div>
    <div class="stat"><div class="label">Extension sync</div><div class="value small" id="s-ext">&#8212;</div><div class="sub" id="s-ext-sub">connect to see</div></div>
    <div class="stat"><div class="label">Swarm activity</div><div class="value small" id="s-swarm">&#8212;</div><div class="sub" id="s-swarm-sub">connect to see</div></div>
    <div class="stat"><div class="label">Resolver reloads</div><div class="value" id="s-reloads">&#8212;</div><div class="sub" id="s-reloads-sub">connect to see</div></div>
    <div class="stat"><div class="label">Peer id</div><div class="value small" id="s-peer">&#8212;</div><div class="sub" id="s-peer-sub"><button type="button" class="link small" id="copy-peer" hidden>Copy</button></div></div>
  </section>

  <section class="card connect" id="connect">
    <h2>Connect to this node</h2>
    <p>Paste the admin token from the node's <span class="mono">.env</span> file (ADMIN_TOKEN). It stays in this browser only.</p>
    <form id="token-form" class="stack">
      <input id="token" type="password" placeholder="admin token" autocomplete="off" spellcheck="false" required>
      <div class="row"><button type="submit" class="primary">Connect</button></div>
      <div class="error" id="token-error"></div>
    </form>
  </section>

  <nav class="tabs" id="tabs" hidden aria-label="Sections">
    <button type="button" class="tab active" data-tab="blocklist">Blocklist<span class="count" id="t-blocklist"></span></button>
    <button type="button" class="tab" data-tab="flags">Swarm flags<span class="count" id="t-flags"></span></button>
    <button type="button" class="tab" data-tab="directory">x402 directory<span class="count" id="t-directory"></span></button>
    <button type="button" class="tab" data-tab="node">Node</button>
  </nav>

  <section class="card" id="tab-blocklist" data-panel="blocklist" hidden>
    <div class="card-head"><h2>Blocklist</h2><div class="meta" id="bl-meta"></div></div>
    <form id="manual-form" class="row">
      <input id="manual-domain" type="text" placeholder="domain to block, e.g. drainer.example" required spellcheck="false">
      <input id="manual-reason" type="text" placeholder="reason (optional)">
      <button type="submit" class="primary">Block domain</button>
    </form>
    <div class="row">
      <input id="filter" type="search" placeholder="filter domains" spellcheck="false">
      <span class="hint">Export</span>
      <button type="button" class="small" data-format="hosts">hosts</button>
      <button type="button" class="small" data-format="dnsmasq">dnsmasq</button>
      <button type="button" class="small" data-format="plain">plain</button>
      <button type="button" class="small" data-format="json">json</button>
    </div>
    <div class="empty" id="bl-empty" hidden></div>
    <div class="table-wrap" id="bl-wrap"><table id="blocklist"><thead><tr><th>Domain</th><th>Sources</th><th>Reason</th><th></th></tr></thead><tbody></tbody></table></div>
  </section>

  <section class="card" id="tab-flags" data-panel="flags" hidden>
    <div class="card-head"><h2>Swarm flags</h2><div class="meta" id="flags-meta"></div></div>
    <div class="empty" id="flags-empty" hidden></div>
    <div class="table-wrap" id="flags-wrap"><table id="flags"><thead><tr><th>Domain</th><th>Reporters</th><th>Status</th><th>Last seen</th><th>Reasons</th></tr></thead><tbody></tbody></table></div>
  </section>

  <section class="card" id="tab-directory" data-panel="directory" hidden>
    <div class="card-head"><h2>x402 directory</h2><div class="meta" id="dir-meta"></div></div>
    <form id="dir-form" class="row">
      <input id="dir-url" type="url" placeholder="https://api.example/resource" required spellcheck="false">
      <input id="dir-payto" type="text" placeholder="payTo address" required spellcheck="false">
      <input id="dir-network" type="text" placeholder="network (default eip155:4663)" spellcheck="false">
      <input id="dir-asset" type="text" placeholder="asset (default USDG)" spellcheck="false">
      <button type="submit" class="primary">Probe and add</button>
    </form>
    <div class="empty" id="dir-empty" hidden></div>
    <div class="table-wrap" id="dir-wrap"><table id="directory"><thead><tr><th>URL</th><th>Network</th><th>Pay to</th><th>Amount</th><th>Origin</th><th>Verified</th></tr></thead><tbody></tbody></table></div>
  </section>

  <section class="card" id="tab-node" data-panel="node" hidden>
    <div class="card-head"><h2>Node</h2><div class="meta" id="node-meta"></div></div>
    <div class="two">
      <dl class="grid" id="node-left"></dl>
      <dl class="grid" id="node-right"></dl>
    </div>
  </section>

  <footer class="foot"><span id="foot-left">not connected</span><span id="foot-right"><a href="https://payhole.org">payhole.org</a></span></footer>
</main>
<div id="toast" class="toast" hidden></div>
</body>
</html>
`;
