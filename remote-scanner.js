// Experimental LAN companion scanner.
//
// On demand, starts a local HTTPS server on a random port, serves a
// phone-friendly page that uses ZXing to scan a barcode via the phone's
// camera, and pushes the decoded code back to the desktop renderer. Stops
// itself when the desktop cancels or after a timeout.
//
// Self-signed cert: necessary because mobile browsers require HTTPS for
// getUserMedia. The phone will show a scary warning the first time — the
// user has to tap through. No real certificate authority is involved.

const https = require('https');
const crypto = require('crypto');
const os = require('os');
const fs = require('fs');
const path = require('path');
const selfsigned = require('selfsigned');

const PHONE_PAGE_PATH = path.join(__dirname, 'renderer', 'phone-scan.html');
const ZXING_PATH = path.join(__dirname, 'renderer', 'vendor', 'zxing-browser.min.js');

let activeSession = null;

// Barcode charset — covers UPC/EAN/Code 128/Code 39/ITF in practice. Rejecting
// anything else (including QR payloads) prevents a compromised phone from
// injecting arbitrary strings, and gives defense-in-depth if a future renderer
// change ever drops an escapeHtml() on the way to a DOM sink.
const CODE_RE = /^[A-Za-z0-9\-._]{1,64}$/;

// Windows often has virtual adapters (VMware, Hyper-V, Docker, VPN) whose
// addresses the phone can't reach. Filter by interface name.
const VIRTUAL_IFACE_PATTERNS = [
  /vmware/i, /virtualbox/i, /vethernet/i, /loopback/i, /hyper-v/i,
  /docker/i, /wsl/i, /tap/i, /tun/i, /bluetooth/i, /vpn/i, /tailscale/i,
  /zerotier/i
];

function lanAddresses() {
  const ifaces = os.networkInterfaces();
  const candidates = [];
  for (const [name, list] of Object.entries(ifaces)) {
    const virtual = VIRTUAL_IFACE_PATTERNS.some(re => re.test(name));
    for (const net of list || []) {
      if (net.family !== 'IPv4' || net.internal) continue;
      candidates.push({ name, address: net.address, virtual });
    }
  }
  // Prefer non-virtual interfaces; within each group, prefer common home subnets.
  const score = (c) => {
    let s = 0;
    if (c.virtual) s += 100;
    if (c.address.startsWith('192.168.')) s -= 2;
    else if (c.address.startsWith('10.')) s -= 1;
    else if (c.address.startsWith('172.')) s -= 0;
    else s += 10;
    return s;
  };
  candidates.sort((a, b) => score(a) - score(b));
  if (!candidates.length) candidates.push({ name: 'loopback', address: '127.0.0.1', virtual: false });
  return candidates.map(c => c.address);
}

function lanAddress() {
  return lanAddresses()[0];
}

async function makeCert(ips) {
  const attrs = [{ name: 'commonName', value: 'crumbtracker-local' }];
  const altNames = [
    ...ips.map(ip => ({ type: 7, ip })),
    { type: 7, ip: '127.0.0.1' },
    { type: 2, value: 'localhost' }
  ];
  // selfsigned v5 returns a Promise, not a sync object — awaiting it is
  // load-bearing. Without await, key/cert are undefined and Node silently
  // starts a TLS server that produces ERR_SSL_PROTOCOL_ERROR on every request.
  const pems = await selfsigned.generate(attrs, {
    days: 365,
    algorithm: 'sha256',
    keySize: 2048,
    extensions: [
      { name: 'extKeyUsage', serverAuth: true, clientAuth: true },
      { name: 'subjectAltName', altNames }
    ]
  });
  return { key: pems.private, cert: pems.cert };
}

function readFileCached(p) {
  if (!readFileCached.cache) readFileCached.cache = new Map();
  if (!readFileCached.cache.has(p)) readFileCached.cache.set(p, fs.readFileSync(p));
  return readFileCached.cache.get(p);
}

// Start the companion-scanner server. Returns { url, token, stop }. `onCode`
// receives each scanned barcode string.
async function start({ onCode, onError, timeoutMs = 10 * 60 * 1000 }) {
  stop(); // never allow two at once
  const token = crypto.randomBytes(16).toString('hex');
  const ips = lanAddresses();
  const { key, cert } = await makeCert(ips);

  // Populated after listen() — checked per-request to block DNS-rebinding,
  // where an attacker-controlled DNS name resolves to the user's LAN IP.
  // Requests without a matching Host header get rejected even before the
  // token check.
  let allowedHosts = null;

  const server = https.createServer({ key, cert }, (req, res) => {
    if (allowedHosts && !allowedHosts.has(String(req.headers.host || '').toLowerCase())) {
      res.writeHead(403); res.end('forbidden'); return;
    }
    // Every route is under /<token>/... — mismatch → 404.
    const prefix = `/${token}/`;
    if (!req.url.startsWith(prefix) && req.url !== `/${token}`) {
      res.writeHead(404); res.end('not found'); return;
    }
    // Reset idle timer on any authenticated request.
    if (activeSession && activeSession.timer) {
      clearTimeout(activeSession.timer);
      activeSession.timer = setTimeout(() => stop('timeout'), timeoutMs);
    }
    const route = req.url === `/${token}` ? '' : req.url.slice(prefix.length);

    if (req.method === 'GET' && (route === '' || route === 'index.html')) {
      const html = readFileCached(PHONE_PAGE_PATH).toString('utf8')
        .replace(/__TOKEN__/g, token);
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(html);
      return;
    }
    if (req.method === 'GET' && route === 'zxing.min.js') {
      res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8', 'Cache-Control': 'public, max-age=60' });
      res.end(readFileCached(ZXING_PATH));
      return;
    }
    if (req.method === 'POST' && route === 'code') {
      let body = '';
      req.on('data', chunk => {
        body += chunk;
        if (body.length > 1024) { req.destroy(); }
      });
      req.on('end', () => {
        try {
          const { code } = JSON.parse(body || '{}');
          if (typeof code === 'string' && CODE_RE.test(code)) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true }));
            try { onCode && onCode(code); } catch (e) { console.error('onCode handler threw', e); }
            return;
          }
        } catch {}
        res.writeHead(400); res.end('bad request');
      });
      return;
    }
    res.writeHead(404); res.end('not found');
  });

  server.on('error', (err) => {
    console.error('[remote-scanner] server error', err);
    onError && onError(err);
    stop();
  });

  return new Promise((resolve, reject) => {
    server.listen(0, '0.0.0.0', () => {
      const port = server.address().port;
      const urls = ips.map(ip => `https://${ip}:${port}/${token}`);
      // IPv6 Host header arrives bracketed (e.g. "[::1]:12345"); we only bind
      // the v4 IPs enumerated above, plus localhost/127.0.0.1 for any
      // same-host debugging from the desktop.
      allowedHosts = new Set([
        ...ips.map(ip => `${ip}:${port}`),
        `localhost:${port}`,
        `127.0.0.1:${port}`
      ].map(s => s.toLowerCase()));
      const timer = setTimeout(() => stop('timeout'), timeoutMs);
      activeSession = { server, token, urls, timer };
      resolve({ url: urls[0], urls, token });
    });
    server.on('error', reject);
  });
}

function stop(reason) {
  if (!activeSession) return;
  const s = activeSession;
  activeSession = null;
  clearTimeout(s.timer);
  try { s.server.close(); } catch {}
  if (reason) console.log('[remote-scanner] stopped:', reason);
}

module.exports = { start, stop };
