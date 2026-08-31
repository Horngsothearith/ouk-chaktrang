// Zero-dependency static file server & API proxy. Serves the project root and
// proxies API requests to bypass browser CORS. This is also the server the
// container runs (see Dockerfile), so its two exposed surfaces - the file
// handler and /api/proxy - are both written to be safe to expose.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { parseAllowedHosts, isAllowedTarget, describeFetchFailure } = require('./proxy-guard.js');

const root = path.join(__dirname, '..');
const port = process.env.PORT || 5173;
const allowedHosts = parseAllowedHosts(process.env.PROXY_ALLOWED_HOSTS);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8'
};

function setCorsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');
}

http.createServer(async (req, res) => {
  const urlObj = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  let reqPath = decodeURIComponent(urlObj.pathname);

  // Handle /api/proxy to forward OpenAI-compatible requests and bypass browser CORS
  if (reqPath === '/api/proxy') {
    // Deliberately no CORS headers on this route: the app calls it
    // same-origin, and a wildcard would let any page open in the browser
    // drive the relay.
    const targetUrl = req.headers['x-target-url'] || urlObj.searchParams.get('url');
    if (!targetUrl) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'Missing x-target-url header or ?url parameter' } }));
      return;
    }

    const verdict = isAllowedTarget(targetUrl, allowedHosts);
    if (!verdict.allowed) {
      // Only an allowlist rejection is fixable by widening the allowlist;
      // suggesting it for a bad scheme or an unparseable URL would mislead.
      const hint = /allowlist/.test(verdict.reason)
        ? ' Set PROXY_ALLOWED_HOSTS to permit additional hosts.'
        : '';
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'Proxy refused the target: ' + verdict.reason + '.' + hint } }));
      return;
    }

    try {
      const chunks = [];
      for await (const chunk of req) {
        chunks.push(chunk);
      }
      const bodyBuffer = Buffer.concat(chunks);

      const forwardHeaders = {};
      if (req.headers['authorization']) forwardHeaders['Authorization'] = req.headers['authorization'];
      if (req.headers['content-type']) forwardHeaders['Content-Type'] = req.headers['content-type'];
      else forwardHeaders['Content-Type'] = 'application/json';

      const forwardRes = await fetch(targetUrl, {
        method: req.method,
        headers: forwardHeaders,
        body: bodyBuffer.length > 0 ? bodyBuffer : undefined
      });

      const resBody = await forwardRes.text();
      res.writeHead(forwardRes.status, {
        'Content-Type': forwardRes.headers.get('content-type') || 'application/json'
      });
      res.end(resBody);
    } catch (err) {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'Proxy request failed: ' + describeFetchFailure(err) } }));
    }
    return;
  }

  setCorsHeaders(res);

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (reqPath === '/') reqPath = '/index.html';
  const filePath = path.join(root, reqPath);

  // path.relative, not startsWith: a plain prefix test also accepts siblings
  // whose name merely starts with the root's (/app matching /app-private).
  const relative = path.relative(root, filePath);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  // Nothing the app needs lives in a dotted path, while plenty that should
  // never be served does - .git and .claude most of all.
  if (relative.split(path.sep).some((segment) => segment.startsWith('.'))) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found: ' + reqPath);
      return;
    }
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
}).listen(port, () => {
  console.log('Serving ' + root + ' at http://localhost:' + port);
});

