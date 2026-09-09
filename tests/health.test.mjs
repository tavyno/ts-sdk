import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createApiClient } from '../dist/index.js';

for (const [status, data] of [
  [200, { status: 'ok', db: 'ok' }],
  [503, { status: 'error', db: 'error' }],
]) {
  test(`health check returns the ${status} contract and requests GET /health`, async () => {
    const signal = new AbortController().signal;
    const client = createApiClient('https://api.example.com/', {
      fetcher: async (url, init) => {
        assert.equal(String(url), 'https://api.example.com/health');
        assert.equal(init.method, 'GET');
        assert.equal(init.signal, signal);
        assert.equal(init.cache, 'no-store');
        return Response.json(data, { status });
      },
    });
    assert.deepEqual(await client.healthCheck({ signal }), { status, data });
  });
}

test('propagates network and cancellation failures', async () => {
  const failure = new Error('Network unavailable');
  const client = createApiClient('https://api.example.com', {
    fetcher: async () => { throw failure; },
  });
  await assert.rejects(client.healthCheck(), error => error === failure);
});

for (const [status, body] of [[200, {}], [200, { status: 'error', db: 'error' }], [503, { status: 'ok', db: 'ok' }], [200, null]]) {
  test(`rejects malformed health response ${status}: ${JSON.stringify(body)}`, async () => {
    const client = createApiClient('https://api.example.com', {
      fetcher: async () => Response.json(body, { status }),
    });
    await assert.rejects(client.healthCheck(), /Invalid health response/);
  });
}

test('rejects unexpected HTTP status without exposing the response body', async () => {
  const client = createApiClient('https://api.example.com', {
    fetcher: async () => new Response('private upstream details', { status: 502 }),
  });
  await assert.rejects(client.healthCheck(), /Health request failed \(502\)/);
});

for (const url of ['not a url', 'file:///tmp/api', 'https://user:secret@example.com', 'https://example.com?query=1', 'https://example.com/#hash']) {
  test(`rejects invalid API base URL: ${url}`, () => {
    assert.throws(() => createApiClient(url), /Invalid API base URL/);
  });
}

test('preserves a configured API base path', async () => {
  const client = createApiClient('https://api.example.com/v1/', {
    fetcher: async (url) => {
      assert.equal(url, 'https://api.example.com/v1/health');
      return Response.json({ status: 'ok', db: 'ok' });
    },
  });
  assert.equal((await client.healthCheck()).status, 200);
});

test('preserves the abort reason for an already cancelled request', async () => {
  const controller = new AbortController();
  controller.abort();
  const client = createApiClient('https://api.example.com', {
    fetcher: async (_url, init) => {
      init.signal.throwIfAborted();
      assert.fail('Cancelled requests must not succeed');
    },
  });
  await assert.rejects(client.healthCheck({ signal: controller.signal }), error => error === controller.signal.reason);
});

test('preserves a custom cancellation reason', async () => {
  const controller = new AbortController();
  controller.abort('Navigation cancelled');
  const client = createApiClient('https://api.example.com', {
    fetcher: async (_url, init) => { init.signal.throwIfAborted(); },
  });
  await assert.rejects(client.healthCheck({ signal: controller.signal }), reason => reason === controller.signal.reason);
});
