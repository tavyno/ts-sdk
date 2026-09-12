import type {
    EventGroup,
    EventGroupDetail,
    EventMembership,
    EventOccurrence,
    EventRangeResult,
    FieldContext,
    JsonValue,
    TavynoCalendar,
    TavynoEvent,
} from './schedule-contracts.js';

function invalid(): never {
    throw new Error('Invalid schedule response');
}

function isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function object(value: unknown): Record<string, unknown> {
    if (!isObject(value)) {
        return invalid();
    }

    return value;
}

function text(value: unknown): string {
    if (typeof value !== 'string') {
        return invalid();
    }

    return value;
}

function identifier(value: unknown): string {
    const result = text(value);

    if (result.length === 0) {
        return invalid();
    }

    return result;
}

function nullableText(value: unknown): string | null {
    return value === null ? null : text(value);
}

function boolean(value: unknown): boolean {
    if (typeof value !== 'boolean') {
        return invalid();
    }

    return value;
}

function list<T>(value: unknown, read: (item: unknown) => T): T[] {
    if (!Array.isArray(value)) {
        return invalid();
    }

    return value.map(read);
}

function origin(value: unknown): 'native' | 'provider' {
    if (value !== 'native' && value !== 'provider') {
        return invalid();
    }

    return value;
}

function json(value: unknown, depth = 0): JsonValue {
    if (depth > 32) {
        return invalid();
    }

    if (value === null || typeof value === 'string' || typeof value === 'boolean') {
        return value;
    }

    if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
    }

    if (Array.isArray(value)) {
        return value.map((item: unknown) => json(item, depth + 1));
    }

    const entries = Object.entries(object(value)).map(([key, item]) => [key, json(item, depth + 1)]);

    return Object.fromEntries(entries);
}

function fields(value: unknown): FieldContext[] {
    return list(value, (item) => {
        const field = object(item);
        const target = object(field.target);

        if (target.type !== 'EVENT' && target.type !== 'EVENT_GROUP') {
            return invalid();
        }

        return {
            bindingId: identifier(field.bindingId),
            installationId: identifier(field.installationId),
            fieldDefinitionId: identifier(field.fieldDefinitionId),
            version: identifier(field.version),
            target: { type: target.type, id: identifier(target.id) },
            value: json(field.value),
        };
    });
}

export function readGroup(value: unknown): EventGroup {
    const group = object(value);

    return { id: identifier(group.id), name: text(group.name) };
}

export function readCalendar(value: unknown): TavynoCalendar {
    const calendar = object(value);
    const capabilities = object(calendar.capabilities);
    const source = calendar.source === null ? null : object(calendar.source);

    return {
        id: identifier(calendar.id),
        name: text(calendar.name),
        timeZone: identifier(calendar.timeZone),
        origin: origin(calendar.origin),
        capabilities: { canEditSchedule: boolean(capabilities.canEditSchedule) },
        isDefault: boolean(calendar.isDefault),
        source:
            source === null
                ? null
                : {
                      status: identifier(source.status),
                      lastSyncedAt: nullableText(source.lastSyncedAt),
                  },
    };
}

export function readEvent(value: unknown): TavynoEvent {
    const event = object(value);
    const capabilities = object(event.capabilities);

    return {
        id: identifier(event.id),
        calendarId: identifier(event.calendarId),
        title: text(event.title),
        description: nullableText(event.description),
        location: nullableText(event.location),
        start: identifier(event.start),
        end: identifier(event.end),
        timeZone: identifier(event.timeZone),
        allDay: boolean(event.allDay),
        recurrence: event.recurrence === null ? null : list(event.recurrence, identifier),
        origin: origin(event.origin),
        capabilities: {
            canEditSchedule: boolean(capabilities.canEditSchedule),
            canEditMetadata: boolean(capabilities.canEditMetadata),
        },
        groups: list(event.groups, readGroup),
        fields: fields(event.fields),
    };
}

function readOccurrence(value: unknown): EventOccurrence {
    const occurrence = object(value);

    if (occurrence.status !== 'confirmed' && occurrence.status !== 'cancelled') {
        return invalid();
    }

    return {
        id: identifier(occurrence.id),
        eventId: identifier(occurrence.eventId),
        title: text(occurrence.title),
        description: nullableText(occurrence.description),
        location: nullableText(occurrence.location),
        start: identifier(occurrence.start),
        end: identifier(occurrence.end),
        originalStart: identifier(occurrence.originalStart),
        timeZone: identifier(occurrence.timeZone),
        allDay: boolean(occurrence.allDay),
        status: occurrence.status,
        groups: list(occurrence.groups, readGroup),
    };
}

export function readEventRange(value: unknown): EventRangeResult {
    const range = object(value);

    return {
        events: list(range.events, readEvent),
        occurrences: list(range.occurrences, readOccurrence),
    };
}

export function readGroupDetail(value: unknown): EventGroupDetail {
    const detail = object(value);

    return {
        group: readGroup(detail.group),
        ...readEventRange(detail),
        fields: fields(detail.fields),
    };
}

export function readCalendarList(value: unknown): { calendars: TavynoCalendar[] } {
    return { calendars: list(object(value).calendars, readCalendar) };
}

export function readGroupList(value: unknown): { groups: EventGroup[] } {
    return { groups: list(object(value).groups, readGroup) };
}

export function readDeleted(value: unknown): { deleted: true } {
    if (object(value).deleted !== true) {
        return invalid();
    }

    return { deleted: true };
}

export function readMembership(value: unknown): EventMembership {
    const membership = object(value);

    return { groupId: identifier(membership.groupId), eventId: identifier(membership.eventId) };
}
