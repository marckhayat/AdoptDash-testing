// WorkSpan API Proxy — Node.js stdlib only, no npm required.
const http = require('http');
const https = require('https');
const url = require('url');
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

const PORT = 8765;
const WS_API = 'api.workspan.com';
const BASE_DIR = path.dirname(__dirname);
const APP_INDEX = path.join(BASE_DIR, 'index.html');

function addCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-ws-env');
}

const server = http.createServer((req, res) => {
  if (req.method === 'OPTIONS') { addCors(res); res.writeHead(204); res.end(); return; }

  const body = [];
  req.on('data', c => body.push(c));
  req.on('end', () => {
    const data = body.length ? Buffer.concat(body) : null;
    const fwdHeaders = {};
    ['authorization','content-type','x-ws-env'].forEach(h => {
      if (req.headers[h]) fwdHeaders[h] = req.headers[h];
    });
    if (!fwdHeaders['content-type'] && data) fwdHeaders['content-type'] = 'application/json';
    if (data) fwdHeaders['content-length'] = data.length;

    const opts = { hostname: WS_API, path: req.url, method: req.method, headers: fwdHeaders };
    const proxy = https.request(opts, r => {
      addCors(res);
      res.writeHead(r.statusCode, { 'content-type': r.headers['content-type'] || 'application/json' });
      r.pipe(res);
    });
    proxy.on('error', e => {
      addCors(res);
      res.writeHead(502, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    });
    if (data) proxy.write(data);
    proxy.end();
  });
});

server.listen(PORT, 'localhost', () => {
  console.log('='.repeat(50));
  console.log('  Adoption Dashboard — API Proxy (Node.js)');
  console.log('='.repeat(50));
  console.log(`  Proxy running on http://localhost:${PORT}`);
  if (fs.existsSync(APP_INDEX)) {
    const appUrl = 'file:///' + APP_INDEX.replace(/\\/g, '/');
    console.log(`  Opening app: ${appUrl}`);
    try {
      const cmd = process.platform === 'win32' ? `start "" "${appUrl}"` :
                  process.platform === 'darwin' ? `open "${appUrl}"` : `xdg-open "${appUrl}"`;
      execSync(cmd);
    } catch(e) {}
  } else {
    console.log('  Open index.html in your browser.');
  }
  console.log('  Keep this window open while using the API feature.');
  console.log('  Press Ctrl+C to stop.');
});
