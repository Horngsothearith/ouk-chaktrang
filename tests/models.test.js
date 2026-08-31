const test = require('node:test');
const assert = require('node:assert/strict');
const OukReview = require('../src/review.js');

const SETTINGS = { baseURL: 'https://example.test/v1', apiKey: 'sk-test', model: 'm' };

// Stands in for the browser's fetch for one test, and always restores it.
// Awaits the run: a request that retries makes its second call long after the
// first returns, and restoring early would send that one to the real network.
async function withFetch(impl, run) {
  const original = globalThis.fetch;
  globalThis.fetch = impl;
  try {
    return await run();
  } finally {
    globalThis.fetch = original;
  }
}

function jsonResponse(body, status) {
  return Promise.resolve({
    ok: status === undefined || (status >= 200 && status < 300),
    status: status || 200,
    statusText: 'OK',
    headers: { get: () => 'application/json' },
    text: () => Promise.resolve(typeof body === 'string' ? body : JSON.stringify(body))
  });
}

test('parseModelList reads the shapes OpenAI-compatible endpoints actually return', () => {
  // OpenAI / Ollama: objects wrapped in `data`.
  assert.deepEqual(
    OukReview.parseModelList({ object: 'list', data: [{ id: 'gpt-4o' }, { id: 'gpt-4o-mini' }] }),
    ['gpt-4o', 'gpt-4o-mini']
  );
  // A bare array of objects.
  assert.deepEqual(OukReview.parseModelList([{ id: 'b-model' }, { id: 'a-model' }]), ['a-model', 'b-model']);
  // Plain strings rather than objects.
  assert.deepEqual(OukReview.parseModelList({ data: ['zeta', 'alpha'] }), ['alpha', 'zeta']);
  // `models` + `name`, as some gateways answer.
  assert.deepEqual(OukReview.parseModelList({ models: [{ name: 'llama3' }] }), ['llama3']);
});

test('parseModelList sorts case-insensitively and drops duplicates and junk', () => {
  const ids = OukReview.parseModelList({
    data: [{ id: 'Zeta' }, { id: 'alpha' }, { id: 'alpha' }, { id: '  ' }, { id: 42 }, null, { nope: 1 }]
  });
  assert.deepEqual(ids, ['alpha', 'Zeta']);
});

test('parseModelList returns nothing rather than throwing on unusable bodies', () => {
  assert.deepEqual(OukReview.parseModelList(null), []);
  assert.deepEqual(OukReview.parseModelList({}), []);
  assert.deepEqual(OukReview.parseModelList({ data: 'not-a-list' }), []);
});

test('listModels GETs /models on the configured base URL with the API key', async () => {
  let seen = null;
  const ids = await withFetch((url, init) => {
    seen = { url, init };
    return jsonResponse({ data: [{ id: 'gpt-4o-mini' }, { id: 'gpt-4o' }] });
  }, () => OukReview.listModels(SETTINGS));

  assert.equal(seen.url, 'https://example.test/v1/models');
  assert.equal(seen.init.method, 'GET');
  assert.equal(seen.init.headers.Authorization, 'Bearer sk-test');
  assert.equal(seen.init.body, undefined, 'a GET carries no body');
  assert.deepEqual(ids, ['gpt-4o', 'gpt-4o-mini']);
});

test('listModels trims a trailing slash off the base URL', async () => {
  let seen = null;
  await withFetch((url) => {
    seen = url;
    return jsonResponse({ data: [{ id: 'x' }] });
  }, () => OukReview.listModels({ baseURL: 'https://example.test/v1/', apiKey: '' }));

  assert.equal(seen, 'https://example.test/v1/models');
});

test('listModels sends no Authorization header when there is no key', async () => {
  let seen = null;
  await withFetch((url, init) => {
    seen = init;
    return jsonResponse({ data: [{ id: 'llama3' }] });
  }, () => OukReview.listModels({ baseURL: 'http://localhost:11434/v1', apiKey: '' }));

  assert.equal('Authorization' in seen.headers, false);
});

test('listModels goes through the dev proxy when asked to', async () => {
  let seen = null;
  await withFetch((url, init) => {
    seen = { url, init };
    return jsonResponse({ data: [{ id: 'x' }] });
  }, () => OukReview.listModels({ baseURL: 'https://example.test/v1', apiKey: 'k', useProxy: true }));

  assert.equal(seen.url, '/api/proxy');
  assert.equal(seen.init.headers['x-target-url'], 'https://example.test/v1/models');
  assert.equal(seen.init.method, 'GET', 'the proxy is told to forward a GET');
});

test('listModels retries through the proxy when the browser blocks the direct call', async () => {
  const urls = [];
  const ids = await withFetch((url, init) => {
    urls.push(url);
    if (url !== '/api/proxy') {
      const err = new TypeError('Failed to fetch');
      return Promise.reject(err);
    }
    return jsonResponse({ data: [{ id: 'local-model' }] });
  }, () => OukReview.listModels({ baseURL: 'http://localhost:1234/v1', apiKey: '' }));

  assert.deepEqual(urls, ['http://localhost:1234/v1/models', '/api/proxy']);
  assert.deepEqual(ids, ['local-model']);
});

test('an endpoint with no model list reports that, rather than looking empty', async () => {
  await assert.rejects(
    () => withFetch(() => jsonResponse({ data: [] }), () => OukReview.listModels(SETTINGS)),
    /listed no models/
  );
});

test('listModels surfaces the endpoint\'s own error message', async () => {
  await assert.rejects(
    () => withFetch(
      () => jsonResponse({ error: { message: 'Invalid API key provided' } }, 401),
      () => OukReview.listModels(SETTINGS)
    ),
    /Invalid API key provided/
  );
});

test('sendChatRequest still posts to /chat/completions with stream disabled', async () => {
  let seen = null;
  await withFetch((url, init) => {
    seen = { url, init };
    return jsonResponse({ choices: [{ message: { content: 'hi' } }] });
  }, () => OukReview.sendChatRequest(SETTINGS, { model: 'm', messages: [] }));

  assert.equal(seen.url, 'https://example.test/v1/chat/completions');
  assert.equal(seen.init.method, 'POST');
  assert.equal(JSON.parse(seen.init.body).stream, false);
});
