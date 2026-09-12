export const group = { id: 'group-1', name: 'Course' };
export const otherGroup = { id: 'group-2', name: 'Project' };
export const calendar = {
    id: 'calendar-1',
    name: 'My calendar',
    timeZone: 'America/New_York',
    origin: 'native',
    capabilities: { canEditSchedule: true },
    isDefault: true,
    source: null,
};
export const event = {
    id: 'event-1',
    calendarId: calendar.id,
    title: 'Lecture',
    description: null,
    location: null,
    start: '2026-09-12T09:00:00-04:00',
    end: '2026-09-12T10:00:00-04:00',
    timeZone: calendar.timeZone,
    allDay: false,
    recurrence: ['RRULE:FREQ=WEEKLY;COUNT=10'],
    origin: 'native',
    capabilities: { canEditSchedule: true, canEditMetadata: true },
    groups: [group, otherGroup],
    fields: [],
};
export const occurrence = {
    id: 'occurrence-1',
    eventId: event.id,
    title: 'Moved lecture',
    description: 'One-instance note',
    location: null,
    start: '2026-09-12T14:00:00Z',
    end: '2026-09-12T15:00:00Z',
    originalStart: '2026-09-12T13:00:00Z',
    allDay: false,
    timeZone: calendar.timeZone,
    status: 'confirmed',
    groups: [group, otherGroup],
};
export const range = { start: '2026-09-01T00:00:00Z', end: '2026-10-01T00:00:00Z' };
export const eventInput = {
    calendarId: event.calendarId,
    title: event.title,
    start: event.start,
    end: event.end,
    timeZone: event.timeZone,
    allDay: false,
    recurrence: event.recurrence,
};
export const field = {
    bindingId: 'binding-1',
    installationId: 'installation-1',
    fieldDefinitionId: 'definition-1',
    version: '1.0.0',
    target: { type: 'EVENT', id: event.id },
    value: { title: 'A generic document', items: [{ completed: false, amount: 2 }], unset: null },
};
