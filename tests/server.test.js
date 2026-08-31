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
