// Guard for the dev server's /api/proxy endpoint.
//
// That endpoint forwards a caller-supplied URL, together with the caller's
// Authorization header. Unchecked, anything that can reach the server can use
// it as an open relay into whatever network the process sits in - which is why
// docker-compose.yml binds the port to loopback. This allowlist is the check
// that makes the endpoint safe to expose, and it is the WHOLE control: a host
// on the list is reachable, anything else is refused. Putting a loopback or
// private host on the list is therefore a deliberate operator decision, made
// through PROXY_ALLOWED_HOSTS.
'use strict';

// The hosts behind the presets the settings dialog ships (see src/ui.js).
// Ollama and LM Studio are deliberately absent: they are loopback addresses,
// which inside a container point at the container itself. An operator running
// the server on their own machine can add them with PROXY_ALLOWED_HOSTS.
const DEFAULT_ALLOWED_HOSTS = [
  'api.openai.com',
  'openrouter.ai',
  'api.groq.com',
  'api.deepseek.com',
  'geepark.tail22e168.ts.net',
  'host.docker.internal'
];

function parseAllowedHosts(configured) {
  const extra = String(configured || '')
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter((h) => h !== '');
  return DEFAULT_ALLOWED_HOSTS.concat(extra);
}

function isAllowedTarget(targetUrl, allowedHosts) {
  let url;
  try {
    url = new URL(targetUrl);
  } catch (err) {
    return { allowed: false, reason: 'Target URL could not be parsed' };
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { allowed: false, reason: 'Only http and https targets are proxied, not ' + url.protocol };
  }

  // hostname, not host, so the port is ignored - and an exact match, never a
  // suffix test, which would accept api.openai.com.evil.example.
  const hostname = url.hostname.toLowerCase();
  if (allowedHosts.indexOf(hostname) === -1) {
    return { allowed: false, reason: 'Host ' + hostname + ' is not on the allowlist' };
  }

  return { allowed: true, reason: 'ok' };
}

// fetch() reports every transport failure - connection refused, DNS miss,
// timeout, TLS rejection - as the same opaque TypeError: "fetch failed". The
// part an operator can act on is always one level down, on err.cause, so
// unwrap it. Without this a 502 says nothing about which of those happened.
function describeFetchFailure(err) {
  const message = (err && err.message) || 'Unknown error';
  const cause = err && err.cause;
  if (!cause) return message;
  const detail = cause.code || cause.message;
  return detail ? message + ' (' + detail + ')' : message;
}

module.exports = { DEFAULT_ALLOWED_HOSTS, parseAllowedHosts, isAllowedTarget, describeFetchFailure };
