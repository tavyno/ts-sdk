import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createApiClient } from '../dist/index.js';

test('lists canonical calendars with no provider connection', async () => {
    const signal = new AbortController().signal;
    const client = createApiClient('https://api.example.com/v1/', {
        getAccessToken: () => 'caller.jwt',
        fetcher: async (url, init) => {
            assert.equal(String(url), 'https://api.example.com/v1/calendars');
            assert.equal(init.method, 'GET');
            assert.equal(init.signal, signal);
            assert.equal(init.cache, 'no-store');
            assert.equal(new globalThis.Headers(init.headers).get('authorization'), 'Bearer caller.jwt');

            return Response.json({ calendars: [] });
        },
    });

    assert.deepEqual(await client.calendars({ signal }), { calendars: [] });
});

import { ApiRequestError } from '../dist/index.js';
import { calendar, event, occurrence, group, field, range, eventInput } from './schedule-fixtures.mjs';

const rangeQuery = '?start=2026-09-01T00:00:00Z&end=2026-10-01T00:00:00Z';

for (const [method, args, path, verb, body, response] of [
    ['calendars', [], '/calendars', 'GET', undefined, { calendars: [calendar] }],
    [
        'createCalendar',
        [{ name: 'Calendar', timeZone: 'UTC' }],
        '/calendars',
        'POST',
        { name: 'Calendar', timeZone: 'UTC' },
        calendar,
    ],
    [
        'updateCalendar',
        ['calendar/1', { name: 'Renamed' }],
        '/calendars/calendar%2F1',
        'PATCH',
        { name: 'Renamed' },
        calendar,
    ],
    ['deleteCalendar', ['calendar/1'], '/calendars/calendar%2F1', 'DELETE', undefined, { deleted: true }],
    [
        'events',
        [range],
        `/events${rangeQuery}`,
        'GET',
        undefined,
        { events: [event], occurrences: [occurrence] },
    ],
    ['event', ['event/1'], '/events/event%2F1', 'GET', undefined, event],
    ['createEvent', [eventInput], '/events', 'POST', eventInput, event],
    [
        'updateEvent',
        ['event/1', { title: 'Updated' }],
        '/events/event%2F1',
        'PATCH',
        { title: 'Updated' },
        event,
    ],
    ['deleteEvent', ['event/1'], '/events/event%2F1', 'DELETE', undefined, { deleted: true }],
    ['eventGroups', [], '/event-groups', 'GET', undefined, { groups: [group] }],
    [
        'eventGroup',
        ['group/1', range],
        `/event-groups/group%2F1${rangeQuery}`,
        'GET',
        undefined,
        { group, events: [event], occurrences: [occurrence], fields: [] },
    ],
    ['createEventGroup', [{ name: 'Course' }], '/event-groups', 'POST', { name: 'Course' }, group],
    [
        'updateEventGroup',
        ['group/1', { name: 'Renamed' }],
        '/event-groups/group%2F1',
        'PATCH',
        { name: 'Renamed' },
        group,
    ],
    ['deleteEventGroup', ['group/1'], '/event-groups/group%2F1', 'DELETE', undefined, { deleted: true }],
    [
        'addEventGroupMember',
        ['group/1', 'event/1'],
        '/event-groups/group%2F1/members',
        'POST',
        { eventId: 'event/1' },
        { groupId: 'group/1', eventId: 'event/1' },
    ],
    [
        'removeEventGroupMember',
        ['group/1', 'event/1'],
        '/event-groups/group%2F1/members/event%2F1',
        'DELETE',
        undefined,
        { groupId: 'group/1', eventId: 'event/1' },
    ],
]) {
    test(`${method} preserves its canonical HTTP contract, auth, signal, and base path`, async () => {
        const signal = new AbortController().signal;
        const client = createApiClient('https://api.example.com/v1/', {
            getAccessToken: () => 'caller.jwt',
            fetcher: async (url, init) => {
                const actualUrl = new globalThis.URL(String(url));
                const expectedUrl = new globalThis.URL(`https://api.example.com/v1${path}`);
                assert.equal(actualUrl.pathname, expectedUrl.pathname);
                assert.deepEqual([...actualUrl.searchParams], [...expectedUrl.searchParams]);
                assert.equal(init.method, verb);
                assert.equal(init.signal, signal);
                assert.equal(init.cache, 'no-store');
                assert.equal(new globalThis.Headers(init.headers).get('authorization'), 'Bearer caller.jwt');
                assert.deepEqual(init.body === undefined ? undefined : JSON.parse(init.body), body);

                if (body !== undefined) {
                    assert.equal(
                        new globalThis.Headers(init.headers).get('content-type'),
                        'application/json',
                    );
                }

                return Response.json(response);
            },
        });

        assert.deepEqual(await client[method](...args, { signal }), response);
    });
}

test('range filters and occurrence edit scopes preserve canonical identifiers', async () => {
    const requests = [];
    const client = createApiClient('https://api.example.com', {
        fetcher: async (url, init) => {
            requests.push(new globalThis.URL(String(url)));

            if (init.method === 'GET') {
                return Response.json({ events: [event], occurrences: [occurrence] });
            }

            return Response.json(init.method === 'PATCH' ? event : { deleted: true });
        },
    });
    await client.events({ ...range, calendarId: 'calendar/1', groupId: 'group?2' });
    await client.updateEvent(
        event.id,
        { title: 'This occurrence' },
        { scope: 'occurrence', occurrenceId: 'occurrence/1?x' },
    );
    await client.deleteEvent(event.id, { scope: 'occurrence', occurrenceId: 'occurrence/1?x' });
    assert.equal(requests[0].searchParams.get('calendarId'), 'calendar/1');
    assert.equal(requests[0].searchParams.get('groupId'), 'group?2');

    for (const request of requests.slice(1)) {
        assert.deepEqual(
            [...request.searchParams],
            [
                ['scope', 'occurrence'],
                ['occurrenceId', 'occurrence/1?x'],
            ],
        );
    }
});

test('native and provider events share generic metadata without leaking provider payloads', async () => {
    const expectedEvent = {
        ...event,
        origin: 'provider',
        capabilities: { canEditSchedule: false, canEditMetadata: true },
        fields: [field],
    };
    const client = createApiClient('https://api.example.com', {
        fetcher: async () =>
            Response.json({
                events: [
                    {
                        ...expectedEvent,
                        providerId: 'private-provider-id',
                        credentials: 'private-provider-credentials',
                        fields: [{ ...field, credentials: 'private' }],
                    },
                ],
                occurrences: [{ ...occurrence, providerId: 'private-provider-occurrence' }],
            }),
    });
    assert.deepEqual(await client.events(range), { events: [expectedEvent], occurrences: [occurrence] });
});

test('all-day dates, cancellation, and stable original occurrence start survive transport', async () => {
    const allDayEvent = { ...event, allDay: true, start: '2026-09-12', end: '2026-09-14', recurrence: null };
    const allDayOccurrence = {
        ...occurrence,
        allDay: true,
        start: '2026-09-13',
        end: '2026-09-15',
        originalStart: '2026-09-12',
        status: 'cancelled',
    };
    const client = createApiClient('https://api.example.com', {
        fetcher: async () => Response.json({ events: [allDayEvent], occurrences: [allDayOccurrence] }),
    });
    assert.deepEqual(await client.events(range), { events: [allDayEvent], occurrences: [allDayOccurrence] });
});

for (const [method, args, response] of [
    ['calendars', [], []],
    ['calendars', [], { calendars: [{ ...calendar, capabilities: {} }] }],
    ['calendars', [], { calendars: [{ ...calendar, source: {} }] }],
    ['event', ['event-1'], null],
    ['event', ['event-1'], { ...event, id: '' }],
    ['event', ['event-1'], { ...event, groups: [{ id: 'group-1' }] }],
    ['event', ['event-1'], { ...event, origin: 'google' }],
    ['event', ['event-1'], { ...event, recurrence: [123] }],
    [
        'event',
        ['event-1'],
        { ...event, fields: [{ ...field, target: { type: 'PROVIDER', id: 'provider-1' } }] },
    ],
    ['events', [range], { events: [event] }],
    ['events', [range], { events: [event], occurrences: [{ ...occurrence, status: 'active' }] }],
    ['events', [range], { events: [event], occurrences: [{ ...occurrence, allDay: 'false' }] }],
    ['eventGroup', ['group-1', range], { group, events: [], occurrences: [] }],
    ['deleteEventGroup', ['group-1'], { deleted: false }],
    ['addEventGroupMember', ['group-1', 'event-1'], { groupId: 'group-1' }],
]) {
    test(`${method} rejects a malformed response: ${JSON.stringify(response)}`, async () => {
        const client = createApiClient('https://api.example.com', {
            fetcher: async () => Response.json(response),
        });
        await assert.rejects(client[method](...args), /^Error: Invalid schedule response$/);
    });
}

for (const [status, code] of [
    [400, 'INVALID_REQUEST'],
    [400, 'RANGE_TOO_LARGE'],
    [401, 'UNAUTHORIZED'],
    [404, 'NOT_FOUND'],
    [409, 'READ_ONLY'],
]) {
    test(`preserves documented ${status} ${code} outcomes`, async () => {
        const client = createApiClient('https://api.example.com', {
            fetcher: async () => Response.json({ error: code, details: 'private' }, { status }),
        });
        await assert.rejects(client.events(range), (error) => {
            assert.ok(error instanceof ApiRequestError);
            assert.equal(error.status, status);
            assert.equal(error.code, code);
            assert.equal(error.message.includes('private'), false);

            return true;
        });
    });
}

test('sanitizes unknown HTTP errors and malformed JSON independently', async () => {
    const client = createApiClient('https://api.example.com', {
        fetcher: async () => new Response('Private upstream details', { status: 502 }),
    });
    await assert.rejects(client.events(range), (error) => {
        assert.ok(error instanceof ApiRequestError);
        assert.equal(error.status, 502);
        assert.equal(error.code, 'REQUEST_FAILED');
        assert.equal(error.message.includes('Private'), false);

        return true;
    });
    const malformed = createApiClient('https://api.example.com', {
        fetcher: async () => new Response('{malformed'),
    });
    await assert.rejects(malformed.eventGroups(), /Invalid schedule response/);
});

test('propagates network and custom cancellation failures without retries', async () => {
    const failure = new Error('Network unavailable');
    let requests = 0;
    const client = createApiClient('https://api.example.com', {
        fetcher: async () => {
            requests += 1;
            throw failure;
        },
    });
    await assert.rejects(client.createEvent(eventInput), (error) => error === failure);
    assert.equal(requests, 1);
    const controller = new AbortController();
    controller.abort('Navigation changed');
    const cancelled = createApiClient('https://api.example.com', {
        fetcher: async (_url, init) => init.signal.throwIfAborted(),
    });
    await assert.rejects(
        cancelled.events(range, { signal: controller.signal }),
        (reason) => reason === controller.signal.reason,
    );
});

test('resolves fresh authentication per canonical request and propagates credential failure', async () => {
    let token = 'first.jwt';
    const authorizations = [];
    const client = createApiClient('https://api.example.com', {
        getAccessToken: async () => token,
        fetcher: async (_url, init) => {
            authorizations.push(new globalThis.Headers(init.headers).get('authorization'));

            return Response.json({ groups: [] });
        },
    });
    await client.eventGroups();
    token = 'rotated.jwt';
    await client.eventGroups();
    assert.deepEqual(authorizations, ['Bearer first.jwt', 'Bearer rotated.jwt']);
    const failure = new Error('Session expired');
    const expired = createApiClient('https://api.example.com', {
        getAccessToken: () => {
            throw failure;
        },
        fetcher: async () => assert.fail('Credential failure must not send a request'),
    });
    await assert.rejects(expired.calendars(), (error) => error === failure);
});

for (const id of ['', '.', '..']) {
    test(`rejects resource identifiers that could change route structure: ${JSON.stringify(id)}`, async () => {
        const client = createApiClient('https://api.example.com', {
            fetcher: async () => assert.fail('Invalid identifiers must not reach transport'),
        });
        await assert.rejects(client.event(id), /Invalid resource identifier/);
        await assert.rejects(client.removeEventGroupMember('group', id), /Invalid resource identifier/);
    });
}
