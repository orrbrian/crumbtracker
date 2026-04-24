const https = require('https');
const rs = require('../remote-scanner');

function req({ host, path, method = 'GET', body, ip, port }) {
  return new Promise((resolve, reject) => {
    const r = https.request({
      host: ip, port, path, method,
      headers: { host, 'content-type': 'application/json' },
      rejectUnauthorized: false
    }, res => {
      let data = ''; res.on('data', d => data += d);
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    r.on('error', reject);
    if (body) r.write(body);
    r.end();
  });
}

(async () => {
  const codes = [];
  const { url, urls, token } = await rs.start({
    onCode: c => codes.push(c),
    onError: e => console.error('err', e)
  });
  const m = url.match(/https:\/\/([^:]+):(\d+)\/(.+)/);
  const ip = m[1], port = Number(m[2]);
  const goodHost = `${ip}:${port}`;

  const tests = [
    ['rebind-host', await req({ host: 'evil.com', path: `/${token}`, ip, port })],
    ['good-host-bad-token', await req({ host: goodHost, path: `/nope`, ip, port })],
    ['good-host-good-token-get', await req({ host: goodHost, path: `/${token}`, ip, port })],
    ['valid-code', await req({ host: goodHost, path: `/${token}/code`, method: 'POST', body: JSON.stringify({ code: '012345678901' }), ip, port })],
    ['bad-charset-code', await req({ host: goodHost, path: `/${token}/code`, method: 'POST', body: JSON.stringify({ code: '<script>alert(1)</script>' }), ip, port })],
    ['oversized-code', await req({ host: goodHost, path: `/${token}/code`, method: 'POST', body: JSON.stringify({ code: 'A'.repeat(65) }), ip, port })],
    ['unicode-code', await req({ host: goodHost, path: `/${token}/code`, method: 'POST', body: JSON.stringify({ code: '123\u202E456' }), ip, port })],
  ];

  for (const [name, res] of tests) console.log(name.padEnd(28), res.status, res.body.slice(0, 40));
  console.log('codes forwarded to onCode:', codes);

  rs.stop();
})().catch(e => { console.error(e); process.exit(1); });
