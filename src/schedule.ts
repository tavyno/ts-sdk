import type { ScheduleClient } from './schedule-contracts.js';
import {
    readCalendar,
    readCalendarList,
    readDeleted,
    readEvent,
    readEventRange,
    readGroup,
    readGroupDetail,
    readGroupList,
    readMembership,
} from './schedule-responses.js';
import { createApiFetch, unwrap } from './transport.js';
import type { ClientOptions } from './transport.js';

function segment(id: string): string {
    if (typeof id !== 'string' || id.length === 0 || id === '.' || id === '..') {
        throw new Error('Invalid resource identifier');
    }

    return encodeURIComponent(id);
}

export function createScheduleClient(baseUrl: string, options: ClientOptions): ScheduleClient {
    const $fetch = createApiFetch(baseUrl, options);

    return {
        async calendars(opts) {
            return readCalendarList(unwrap(await $fetch.raw('calendars', opts)));
        },
        async createCalendar(input, opts) {
            return readCalendar(
                unwrap(await $fetch.raw('calendars', { ...opts, method: 'POST', body: input })),
            );
        },
        async updateCalendar(id, input, opts) {
            return readCalendar(
                unwrap(
                    await $fetch.raw(`calendars/${segment(id)}`, {
                        ...opts,
                        method: 'PATCH',
                        body: input,
                    }),
                ),
            );
        },
        async deleteCalendar(id, opts) {
            return readDeleted(
                unwrap(await $fetch.raw(`calendars/${segment(id)}`, { ...opts, method: 'DELETE' })),
            );
        },
        async events(range, opts) {
            return readEventRange(unwrap(await $fetch.raw('events', { ...opts, query: range })));
        },
        async event(id, opts) {
            return readEvent(unwrap(await $fetch.raw(`events/${segment(id)}`, opts)));
        },
        async createEvent(input, opts) {
            return readEvent(unwrap(await $fetch.raw('events', { ...opts, method: 'POST', body: input })));
        },
        async updateEvent(id, input, { signal, scope, occurrenceId } = {}) {
            return readEvent(
                unwrap(
                    await $fetch.raw(`events/${segment(id)}`, {
                        signal,
                        method: 'PATCH',
                        body: input,
                        query: { scope, occurrenceId },
                    }),
                ),
            );
        },
        async deleteEvent(id, { signal, scope, occurrenceId } = {}) {
            return readDeleted(
                unwrap(
                    await $fetch.raw(`events/${segment(id)}`, {
                        signal,
                        method: 'DELETE',
                        query: { scope, occurrenceId },
                    }),
                ),
            );
        },
        async eventGroups(opts) {
            return readGroupList(unwrap(await $fetch.raw('event-groups', opts)));
        },
        async eventGroup(id, range, opts) {
            return readGroupDetail(
                unwrap(
                    await $fetch.raw(`event-groups/${segment(id)}`, {
                        ...opts,
                        query: range,
                    }),
                ),
            );
        },
        async createEventGroup(input, opts) {
            return readGroup(
                unwrap(await $fetch.raw('event-groups', { ...opts, method: 'POST', body: input })),
            );
        },
        async updateEventGroup(id, input, opts) {
            return readGroup(
                unwrap(
                    await $fetch.raw(`event-groups/${segment(id)}`, {
                        ...opts,
                        method: 'PATCH',
                        body: input,
                    }),
                ),
            );
        },
        async deleteEventGroup(id, opts) {
            return readDeleted(
                unwrap(await $fetch.raw(`event-groups/${segment(id)}`, { ...opts, method: 'DELETE' })),
            );
        },
        async addEventGroupMember(groupId, eventId, opts) {
            return readMembership(
                unwrap(
                    await $fetch.raw(`event-groups/${segment(groupId)}/members`, {
                        ...opts,
                        method: 'POST',
                        body: { eventId },
                    }),
                ),
            );
        },
        async removeEventGroupMember(groupId, eventId, opts) {
            return readMembership(
                unwrap(
                    await $fetch.raw(`event-groups/${segment(groupId)}/members/${segment(eventId)}`, {
                        ...opts,
                        method: 'DELETE',
                    }),
                ),
            );
        },
    };
}
