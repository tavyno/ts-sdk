import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createApiClient } from '../dist/index.js';

for (const [status, expectedResponse] of [
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

                return Response.json(expectedResponse, { status });
            },
        });

        assert.deepEqual(await client.healthCheck({ signal }), { status, data: expectedResponse });
    });
}

test('propagates network and cancellation failures', async () => {
    const failure = new Error('Network unavailable');
    const client = createApiClient('https://api.example.com', {
        fetcher: async () => {
            throw failure;
        },
    });
    await assert.rejects(client.healthCheck(), (error) => error === failure);
});

for (const [status, body] of [
    [200, {}],
    [200, { status: 'error', db: 'error' }],
    [503, { status: 'ok', db: 'ok' }],
    [200, null],
]) {
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

for (const url of [
    'not a url',
    'file:///tmp/api',
    'https://user:secret@example.com',
    'https://example.com?query=1',
    'https://example.com/#hash',
]) {
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
    await assert.rejects(
        client.healthCheck({ signal: controller.signal }),
        (error) => error === controller.signal.reason,
    );
});

test('preserves a custom cancellation reason', async () => {
    const controller = new AbortController();
    controller.abort('Navigation cancelled');
    const client = createApiClient('https://api.example.com', {
        fetcher: async (_url, init) => {
            init.signal.throwIfAborted();
        },
    });
    await assert.rejects(
        client.healthCheck({ signal: controller.signal }),
        (reason) => reason === controller.signal.reason,
    );
});

test('gets the current access token for every request', async () => {
    let accessToken = 'first.jwt.token';
    const authorizationHeaders = [];
    const client = createApiClient('https://api.example.com', {
        getAccessToken: async () => accessToken,
        fetcher: async (_url, init) => {
            authorizationHeaders.push(new globalThis.Headers(init.headers).get('authorization'));

            return Response.json({ status: 'ok', db: 'ok' });
        },
    });
    await client.healthCheck();
    accessToken = 'rotated.jwt.token';
    await client.healthCheck();
    assert.deepEqual(authorizationHeaders, ['Bearer first.jwt.token', 'Bearer rotated.jwt.token']);
});

test('allows anonymous public requests without inventing a token', async () => {
    const client = createApiClient('https://api.example.com', {
        fetcher: async (_url, init) => {
            assert.equal(new globalThis.Headers(init.headers).get('authorization'), null);

            return Response.json({ status: 'ok', db: 'ok' });
        },
    });
    await client.healthCheck();
});

test('session and identity methods send JWTs and return only internal user identity', async () => {
    const calls = [];
    const client = createApiClient('https://api.example.com', {
        getAccessToken: () => 'access.jwt.token',
        fetcher: async (url, init) => {
            calls.push([String(url), init.method]);
            assert.equal(new globalThis.Headers(init.headers).get('authorization'), 'Bearer access.jwt.token');

            return Response.json({ id: 'internal-user', providerSecret: 'must-not-leak' });
        },
    });
    assert.deepEqual(await client.establishSession(), { id: 'internal-user' });
    assert.deepEqual(await client.me(), { id: 'internal-user' });
    assert.deepEqual(calls, [
        ['https://api.example.com/session', 'POST'],
        ['https://api.example.com/me', 'GET'],
    ]);
});

test('calendar connection requests use provider-neutral contracts and caller JWT', async () => {
    const calls = [];
    const client = createApiClient('https://api.example.com', {
        getAccessToken: () => 'caller.jwt',
        fetcher: async (url, init) => {
            assert.equal(new globalThis.Headers(init.headers).get('authorization'), 'Bearer caller.jwt');
            calls.push([String(url), init.method]);

            return Response.json([{ id: 'c', provider: 'google', status: 'connected', credentials: 'secret' }]);
        },
    });
    assert.deepEqual(await client.calendarConnections(), [{ id: 'c', provider: 'google', status: 'connected' }]);
    assert.deepEqual(calls, [['https://api.example.com/calendar-connections', 'GET']]);
});

test('serializes request bodies with JSON and safely encodes path parameters', async () => {
    const client = createApiClient('https://api.example.com/v1', {
        fetcher: async (url, init) => {
            assert.equal(String(url), 'https://api.example.com/v1/external-calendars/team%2Fcalendar');
            assert.equal(init.method, 'PATCH');
            assert.equal(new globalThis.Headers(init.headers).get('content-type'), 'application/json');
            assert.deepEqual(JSON.parse(init.body), { selected: true });

            return Response.json({ id: 'team/calendar', selected: true });
        },
    });

    assert.deepEqual(await client.selectExternalCalendar('team/calendar', true), {
        id: 'team/calendar',
        selected: true,
    });
});

for (const [method, args, suffix, verb, expectedResponse] of [
    [
        'authorizeCalendar',
        [],
        '/calendar-connections/google/authorize',
        'POST',
        { authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth?state=test' },
    ],
    [
        'completeCalendarAuthorization',
        [{ state: 'state', code: 'code' }],
        '/calendar-connections/google/complete',
        'POST',
        { id: 'connection' },
    ],
    [
        'connectionCalendars',
        ['connection'],
        '/calendar-connections/connection/calendars',
        'GET',
        [{ id: 'calendar', name: 'Calendar', selected: true, syncStatus: 'idle', lastSyncedAt: null }],
    ],
    ['refreshConnectionCalendars', ['connection'], '/calendar-connections/connection/refresh', 'POST', []],
    [
        'selectExternalCalendar',
        ['calendar', true],
        '/external-calendars/calendar',
        'PATCH',
        { id: 'calendar', selected: true },
    ],
    ['syncExternalCalendar', ['calendar'], '/external-calendars/calendar/sync', 'POST', { status: 'synced' }],
    [
        'disconnectCalendar',
        ['connection'],
        '/calendar-connections/connection?retention=delete',
        'DELETE',
        { disconnected: true },
    ],
]) {
    test(`${method} preserves its wire contract and JWT`, async () => {
        const client = createApiClient('https://api.example.com', {
            getAccessToken: () => 'jwt',
            fetcher: async (url, init) => {
                assert.equal(String(url), `https://api.example.com${suffix}`);
                assert.equal(init.method, verb);
                assert.equal(new globalThis.Headers(init.headers).get('authorization'), 'Bearer jwt');

                return Response.json(expectedResponse);
            },
        });

        assert.deepEqual(await client[method](...args), expectedResponse);
    });
}
