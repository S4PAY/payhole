/** Single-file admin page served at `/`. It only talks to the JSON API with the token pasted by the operator. */
export const ADMIN_PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>PayHole Sinkhole</title>
<style>
  :root { color-scheme: light dark; font-family: system-ui, sans-serif; }
  body { margin: 0; padding: 1rem 1.5rem 3rem; max-width: 1100px; }
  header { display: flex; flex-wrap: wrap; gap: 1rem; align-items: center; justify-content: space-between; }
  h1 { font-size: 1.4rem; margin: 0.5rem 0; }
  h2 { font-size: 1.1rem; margin: 1.5rem 0 0.5rem; border-bottom: 1px solid #8884; padding-bottom: 0.25rem; }
  input, button { font: inherit; padding: 0.3rem 0.5rem; }
  input { min-width: 12rem; }
  button { cursor: pointer; }
  table { border-collapse: collapse; width: 100%; font-size: 0.9rem; }
  th, td { text-align: left; padding: 0.3rem 0.5rem; border-bottom: 1px solid #8883; vertical-align: top; word-break: break-all; }
  dl { display: grid; grid-template-columns: max-content 1fr; gap: 0.2rem 1rem; font-size: 0.9rem; }
  dt { opacity: 0.7; }
  dd { margin: 0; word-break: break-all; }
  form { display: flex; flex-wrap: wrap; gap: 0.5rem; margin: 0.5rem 0; }
  #message { min-height: 1.2rem; font-size: 0.9rem; color: #b00; }
  .muted { opacity: 0.7; }
  .actions button { font-size: 0.8rem; }
</style>
</head>
<body>
<header>
  <h1>PayHole Sinkhole</h1>
  <form id="token-form">
    <input id="token" type="password" placeholder="admin token" autocomplete="off">
    <button type="submit">Connect</button>
    <button type="button" id="refresh">Refresh</button>
  </form>
</header>
<div id="message"></div>

<h2>Status</h2>
<dl id="status"></dl>

<h2>Blocklist <span class="muted" id="bl-count"></span></h2>
<form id="manual-form">
  <input id="manual-domain" placeholder="domain to block" required>
  <input id="manual-reason" placeholder="reason (optional)">
  <button type="submit">Add manual entry</button>
</form>
<p>
  <input id="filter" placeholder="filter domains">
  Export:
  <button type="button" data-format="hosts">hosts</button>
  <button type="button" data-format="dnsmasq">dnsmasq</button>
  <button type="button" data-format="plain">plain</button>
  <button type="button" data-format="json">json</button>
</p>
<table id="blocklist"><thead><tr><th>Domain</th><th>Sources</th><th>Reason</th><th></th></tr></thead><tbody></tbody></table>

<h2>Swarm flags <span class="muted" id="flags-count"></span></h2>
<table id="flags"><thead><tr><th>Domain</th><th>Reporters</th><th>Confirmed</th><th>Last seen</th><th>Reasons</th></tr></thead><tbody></tbody></table>

<h2>x402 directory <span class="muted" id="dir-count"></span></h2>
<form id="dir-form">
  <input id="dir-url" placeholder="https://api.example/resource" required>
  <input id="dir-payto" placeholder="payTo address" required>
  <input id="dir-network" placeholder="network (default eip155:4663)">
  <input id="dir-asset" placeholder="asset (default USDG)">
  <button type="submit">Probe and add</button>
</form>
<table id="directory"><thead><tr><th>URL</th><th>Network</th><th>Pay to</th><th>Amount</th><th>Origin</th><th>Verified</th></tr></thead><tbody></tbody></table>

<script>
(function () {
  'use strict';
  var tokenInput = document.getElementById('token');
  var message = document.getElementById('message');
  var allEntries = [];
  try { tokenInput.value = sessionStorage.getItem('sinkhole-token') || ''; } catch (e) { /* storage unavailable */ }

  function token() { return tokenInput.value.trim(); }
  function say(text) { message.textContent = text || ''; }
  function api(path, init) {
    init = init || {};
    var headers = { authorization: 'Bearer ' + token() };
    if (init.body !== undefined) headers['content-type'] = 'application/json';
    return fetch(path, { method: init.method || 'GET', headers: headers, body: init.body === undefined ? undefined : JSON.stringify(init.body) })
      .then(function (res) {
        var type = res.headers.get('content-type') || '';
        var parse = type.indexOf('application/json') === 0 ? res.json() : res.text();
        return parse.then(function (data) {
          if (!res.ok) throw new Error((data && data.error ? data.error + ': ' + (data.message || '') : 'HTTP ' + res.status));
          return data;
        });
      });
  }
  function cell(row, text) { var td = document.createElement('td'); td.textContent = text === null || text === undefined ? '' : String(text); row.appendChild(td); return td; }
  function when(ms) { return ms ? new Date(ms).toISOString().replace('T', ' ').slice(0, 19) : ''; }

  function renderStatus(status) {
    var dl = document.getElementById('status');
    dl.textContent = '';
    var rows = [
      ['Peer id', status.peerId || 'swarm disabled'],
      ['Listen addresses', (status.listenAddrs || []).join('\\n')],
      ['Connected peers', (status.connectedPeers || []).length],
      ['Operator', status.identity ? status.identity.address + (status.identity.publishing ? ' (publishing)' : ' (receive only)') : 'none'],
      ['Local flags', status.counts.local],
      ['Manual entries', status.counts.manual],
      ['Swarm confirmed', status.counts.swarmConfirmed + ' of ' + status.counts.swarmFlagged + ' flagged (threshold ' + status.flagThreshold + ')'],
      ['Merged blocklist', status.counts.merged],
      ['Directory entries', status.directory],
      ['Last extension sync', status.lastSync.extension.updatedAt || 'never'],
      ['Last swarm message', when(status.lastSync.swarm) || 'never'],
      ['Swarm messages', status.swarm ? status.swarm.received + ' received, ' + status.swarm.accepted + ' accepted, dropped ' + JSON.stringify(status.swarm.dropped) : 'n/a'],
      ['dnsmasq', status.dnsmasq.running ? 'running (pid ' + status.dnsmasq.pid + ', ' + status.dnsmasq.restarts + ' reloads)' : 'not running'],
      ['Uptime', Math.round(status.uptimeSeconds) + ' s']
    ];
    rows.forEach(function (row) {
      var dt = document.createElement('dt'); dt.textContent = row[0];
      var dd = document.createElement('dd'); dd.textContent = String(row[1]); dd.style.whiteSpace = 'pre-line';
      dl.appendChild(dt); dl.appendChild(dd);
    });
  }

  function renderBlocklist() {
    var filter = document.getElementById('filter').value.trim().toLowerCase();
    var body = document.querySelector('#blocklist tbody');
    body.textContent = '';
    var shown = 0;
    allEntries.forEach(function (entry) {
      if (filter && entry.domain.indexOf(filter) === -1) return;
      if (shown++ >= 500) return;
      var tr = document.createElement('tr');
      cell(tr, entry.domain);
      cell(tr, entry.sources.join(', '));
      cell(tr, entry.reason);
      var actions = cell(tr, '');
      actions.className = 'actions';
      if (entry.sources.indexOf('manual') !== -1) {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = 'Remove manual';
        btn.onclick = function () {
          api('/api/blocklist/manual/' + encodeURIComponent(entry.domain), { method: 'DELETE' }).then(refresh).catch(function (e) { say(e.message); });
        };
        actions.appendChild(btn);
      }
      body.appendChild(tr);
    });
    document.getElementById('bl-count').textContent = '(' + allEntries.length + ' domains' + (shown < allEntries.length ? ', showing ' + shown : '') + ')';
  }

  function renderFlags(data) {
    var body = document.querySelector('#flags tbody');
    body.textContent = '';
    data.entries.forEach(function (entry) {
      var tr = document.createElement('tr');
      cell(tr, entry.domain);
      cell(tr, entry.reporters + ' / ' + data.threshold);
      cell(tr, entry.confirmed ? 'yes' : 'no');
      cell(tr, when(entry.lastSeen));
      cell(tr, entry.reasons.join('; '));
      body.appendChild(tr);
    });
    document.getElementById('flags-count').textContent = '(' + data.entries.length + ')';
  }

  function renderDirectory(data) {
    var body = document.querySelector('#directory tbody');
    body.textContent = '';
    data.entries.forEach(function (entry) {
      var tr = document.createElement('tr');
      cell(tr, entry.url);
      cell(tr, entry.network);
      cell(tr, entry.payTo);
      cell(tr, entry.amount === null ? '' : entry.amount);
      cell(tr, entry.origin);
      cell(tr, when(entry.verifiedAt));
      body.appendChild(tr);
    });
    document.getElementById('dir-count').textContent = '(' + data.entries.length + ')';
  }

  function refresh() {
    if (!token()) { say('Enter the admin token.'); return; }
    say('');
    return Promise.all([api('/api/status'), api('/api/blocklist'), api('/api/flags'), api('/api/directory')])
      .then(function (results) {
        renderStatus(results[0]);
        allEntries = results[1].entries;
        renderBlocklist();
        renderFlags(results[2]);
        renderDirectory(results[3]);
      })
      .catch(function (e) { say(e.message); });
  }

  document.getElementById('token-form').onsubmit = function (event) {
    event.preventDefault();
    try { sessionStorage.setItem('sinkhole-token', token()); } catch (e) { /* storage unavailable */ }
    refresh();
  };
  document.getElementById('refresh').onclick = refresh;
  document.getElementById('filter').oninput = renderBlocklist;
  document.getElementById('manual-form').onsubmit = function (event) {
    event.preventDefault();
    var domain = document.getElementById('manual-domain').value.trim();
    var reason = document.getElementById('manual-reason').value.trim() || 'manual';
    api('/api/blocklist/manual', { method: 'POST', body: { domain: domain, reason: reason } })
      .then(function () { document.getElementById('manual-domain').value = ''; return refresh(); })
      .catch(function (e) { say(e.message); });
  };
  document.getElementById('dir-form').onsubmit = function (event) {
    event.preventDefault();
    var body = { url: document.getElementById('dir-url').value.trim(), payTo: document.getElementById('dir-payto').value.trim() };
    var network = document.getElementById('dir-network').value.trim();
    var asset = document.getElementById('dir-asset').value.trim();
    if (network) body.network = network;
    if (asset) body.asset = asset;
    say('Probing...');
    api('/api/directory', { method: 'POST', body: body })
      .then(function () { say('Endpoint verified and added.'); return refresh(); })
      .catch(function (e) { say(e.message); });
  };
  Array.prototype.forEach.call(document.querySelectorAll('button[data-format]'), function (button) {
    button.onclick = function () {
      var format = button.getAttribute('data-format');
      fetch('/api/blocklist/export?format=' + format, { headers: { authorization: 'Bearer ' + token() } })
        .then(function (res) { if (!res.ok) throw new Error('HTTP ' + res.status); return res.blob(); })
        .then(function (blob) {
          var a = document.createElement('a');
          a.href = URL.createObjectURL(blob);
          a.download = 'sinkhole-blocklist.' + (format === 'json' ? 'json' : 'txt');
          document.body.appendChild(a);
          a.click();
          a.remove();
        })
        .catch(function (e) { say(e.message); });
    };
  });
  if (token()) refresh();
})();
</script>
</body>
</html>
`;
