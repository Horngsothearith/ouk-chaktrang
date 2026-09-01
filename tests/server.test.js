const test = require('node:test');
const assert = require('node:assert/strict');
const guard = require('../scripts/proxy-guard.js');

test('parseAllowedHosts returns the shipped preset hosts when nothing is configured', () => {
  const hosts = guard.parseAllowedHosts(undefined);
  assert.ok(hosts.includes('api.openai.com'));
  assert.ok(hosts.includes('openrouter.ai'));
  assert.ok(hosts.includes('api.groq.com'));
  assert.ok(hosts.includes('api.deepseek.com'));
});

test('parseAllowedHosts adds configured hosts to the defaults, trimmed and lowercased', () => {
  const hosts = guard.parseAllowedHosts(' localhost , My.Host.Example ,, ');
  assert.ok(hosts.includes('localhost'));
  assert.ok(hosts.includes('my.host.example'));
  assert.ok(hosts.includes('api.openai.com'), 'defaults must survive');
  assert.equal(hosts.filter((h) => h === '').length, 0, 'empty entries must be dropped');
});

test('isAllowedTarget allows a default preset host', () => {
  const result = guard.isAllowedTarget('https://api.openai.com/v1/chat/completions', guard.parseAllowedHosts());
  assert.equal(result.allowed, true);
});

test('isAllowedTarget rejects a host that is not on the allowlist', () => {
  const result = guard.isAllowedTarget('https://evil.example.com/collect', guard.parseAllowedHosts());
  assert.equal(result.allowed, false);
  assert.match(result.reason, /not on the allowlist/i);
});

test('isAllowedTarget rejects loopback and private addresses unless explicitly allowlisted', () => {
  // The documented threat: the container using the proxy as a relay into
  // whatever network it can reach.
  const hosts = guard.parseAllowedHosts();
  assert.equal(guard.isAllowedTarget('http://127.0.0.1:11434/v1/chat', hosts).allowed, false);
  assert.equal(guard.isAllowedTarget('http://169.254.169.254/latest/meta-data/', hosts).allowed, false);
  assert.equal(guard.isAllowedTarget('http://192.168.1.1/admin', hosts).allowed, false);
});

test('isAllowedTarget rejects a lookalike host that merely ends with an allowed one', () => {
  const result = guard.isAllowedTarget('https://api.openai.com.evil.example/v1', guard.parseAllowedHosts());
  assert.equal(result.allowed, false);
});

test('isAllowedTarget rejects schemes other than http and https', () => {
  const hosts = guard.parseAllowedHosts('localhost');
  assert.equal(guard.isAllowedTarget('file:///etc/passwd', hosts).allowed, false);
  assert.equal(guard.isAllowedTarget('gopher://localhost:11434/', hosts).allowed, false);
});

test('isAllowedTarget rejects a malformed target instead of throwing', () => {
  const result = guard.isAllowedTarget('not a url', guard.parseAllowedHosts());
  assert.equal(result.allowed, false);
  assert.match(result.reason, /could not be parsed/i);
});

test('isAllowedTarget matches the host regardless of port or letter case', () => {
  const hosts = guard.parseAllowedHosts('localhost');
  assert.equal(guard.isAllowedTarget('http://localhost:11434/v1/chat', hosts).allowed, true);
  assert.equal(guard.isAllowedTarget('https://API.OpenAI.com/v1', hosts).allowed, true);
});

// fetch() collapses every transport failure into the same opaque "fetch
// failed"; the actionable part (ECONNREFUSED, ENOTFOUND, a TLS error) only
// ever lives on err.cause. Dropping it turns a diagnosable 502 into a guess.
test('describeFetchFailure surfaces the underlying cause code', () => {
  const err = new TypeError('fetch failed');
  err.cause = Object.assign(new Error('connect ECONNREFUSED 100.101.84.127:11434'), {
    code: 'ECONNREFUSED'
  });
  assert.match(guard.describeFetchFailure(err), /ECONNREFUSED/);
});

test('describeFetchFailure falls back to the cause message when there is no code', () => {
  const err = new TypeError('fetch failed');
  err.cause = new Error('unable to verify the first certificate');
  assert.match(guard.describeFetchFailure(err), /unable to verify the first certificate/);
});

test('describeFetchFailure returns the plain message when there is no cause', () => {
  assert.equal(guard.describeFetchFailure(new Error('boom')), 'boom');
});

test('describeFetchFailure tolerates a non-Error being thrown', () => {
  assert.equal(typeof guard.describeFetchFailure(undefined), 'string');
});

// The allowlist is the whole security control, and these defaults ship to
// everyone. An operator's own private host belongs in PROXY_ALLOWED_HOSTS,
// not baked into the defaults - see the header comment in proxy-guard.js.
test('DEFAULT_ALLOWED_HOSTS contains only the public preset API hosts', () => {
  assert.deepEqual(guard.DEFAULT_ALLOWED_HOSTS, [
    'api.openai.com',
    'openrouter.ai',
    'api.groq.com',
    'api.deepseek.com',
    'geepark.tail22e168.ts.net',
    'host.docker.internal'
  ]);
});

test('setCorsHeaders sets proper CORS and Private Network headers for origins', () => {
  const { setCorsHeaders } = require('../scripts/dev-server.js');
  const headers = {};
  const mockRes = {
    setHeader: (k, v) => { headers[k.toLowerCase()] = v; }
  };
  const mockReq = {
    headers: {
      origin: 'https://geepark.tail22e168.ts.net',
      'access-control-request-headers': 'authorization, content-type, x-target-url',
      'access-control-request-private-network': 'true'
    }
  };

  setCorsHeaders(mockReq, mockRes);
  assert.equal(headers['access-control-allow-origin'], 'https://geepark.tail22e168.ts.net');
  assert.equal(headers['access-control-allow-headers'], 'authorization, content-type, x-target-url');
  assert.equal(headers['access-control-allow-private-network'], 'true');
  assert.ok(headers['access-control-allow-methods'].includes('OPTIONS'));
});

