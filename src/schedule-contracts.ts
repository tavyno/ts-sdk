/** Canonical schedule origin. Provider identifiers remain in integration bindings. */
export type ScheduleOrigin = 'native' | 'provider';

/** JSON metadata documents; Field installation and editing are separate API capabilities. */
export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

/** Generic projection supplied by the Field platform for an Event or Event Group. */
export interface FieldContext {
    bindingId: string;
    installationId: string;
    fieldDefinitionId: string;
    version: string;
    target: { type: 'EVENT' | 'EVENT_GROUP'; id: string };
    value: JsonValue;
}

/** Tavyno-owned calendar, independent of external provider identity. */
export interface TavynoCalendar {
    id: string;
    name: string;
    timeZone: string;
    origin: ScheduleOrigin;
    capabilities: { canEditSchedule: boolean };
    isDefault: boolean;
    source: { status: string; lastSyncedAt: string | null } | null;
}

/** Membership belongs to the canonical Event/series, never an individual occurrence. */
export interface EventGroup {
    id: string;
    name: string;
}

/** Canonical Event or recurring series. All-day end dates are exclusive. */
export interface TavynoEvent {
    id: string;
    calendarId: string;
    title: string;
    description: string | null;
    location: string | null;
    start: string;
    end: string;
    timeZone: string;
    allDay: boolean;
    recurrence: string[] | null;
    origin: ScheduleOrigin;
    capabilities: { canEditSchedule: boolean; canEditMetadata: boolean };
    groups: EventGroup[];
    fields: FieldContext[];
}

/** A stable concrete occurrence, including effective schedule overrides and inherited Groups. */
export interface EventOccurrence {
    id: string;
    eventId: string;
    title: string;
    description: string | null;
    location: string | null;
    start: string;
    end: string;
    originalStart: string;
    allDay: boolean;
    timeZone: string;
    status: 'confirmed' | 'cancelled';
    groups: EventGroup[];
}

/** A bounded, half-open schedule window: start is inclusive and end is exclusive. */
export interface ScheduleRange {
    start: string;
    end: string;
    calendarId?: string;
    groupId?: string;
}

export interface EventRangeResult {
    events: TavynoEvent[];
    occurrences: EventOccurrence[];
}

export interface EventGroupDetail extends EventRangeResult {
    group: EventGroup;
    fields: FieldContext[];
}

/** Native calendar creation input. */
export interface CalendarInput {
    name: string;
    timeZone: string;
}

/** Native schedule input. Timed values use ISO timestamps and an IANA time zone. */
export interface CreateEventInput {
    calendarId: string;
    title: string;
    description?: string | null;
    location?: string | null;
    start: string;
    end: string;
    timeZone: string;
    allDay: boolean;
    recurrence?: string[] | null;
}

export type UpdateEventInput = Partial<CreateEventInput>;
export type RequestOptions = { signal?: AbortSignal };

/** Single-occurrence changes require its canonical ID; the default scope is the entire series. */
export type EventMutationOptions = RequestOptions &
    ({ scope?: 'series'; occurrenceId?: never } | { scope: 'occurrence'; occurrenceId: string });

export interface EventMembership {
    groupId: string;
    eventId: string;
}

/** Persisted canonical calendar/Event/Group operations. Normal reads never invoke providers. */
export interface ScheduleClient {
    calendars(options?: RequestOptions): Promise<{ calendars: TavynoCalendar[] }>;
    createCalendar(input: CalendarInput, options?: RequestOptions): Promise<TavynoCalendar>;
    updateCalendar(
        id: string,
        input: Partial<CalendarInput>,
        options?: RequestOptions,
    ): Promise<TavynoCalendar>;
    deleteCalendar(id: string, options?: RequestOptions): Promise<{ deleted: true }>;
    events(range: ScheduleRange, options?: RequestOptions): Promise<EventRangeResult>;
    event(id: string, options?: RequestOptions): Promise<TavynoEvent>;
    createEvent(input: CreateEventInput, options?: RequestOptions): Promise<TavynoEvent>;
    /** Occurrence scope permits schedule fields only, excluding calendarId and recurrence. */
    updateEvent(id: string, input: UpdateEventInput, options?: EventMutationOptions): Promise<TavynoEvent>;
    deleteEvent(id: string, options?: EventMutationOptions): Promise<{ deleted: true }>;
    eventGroups(options?: RequestOptions): Promise<{ groups: EventGroup[] }>;
    eventGroup(
        id: string,
        range: Pick<ScheduleRange, 'start' | 'end'>,
        options?: RequestOptions,
    ): Promise<EventGroupDetail>;
    createEventGroup(input: { name: string }, options?: RequestOptions): Promise<EventGroup>;
    updateEventGroup(id: string, input: { name: string }, options?: RequestOptions): Promise<EventGroup>;
    /** Deletes the Group and its memberships; member Events remain in their calendars. */
    deleteEventGroup(id: string, options?: RequestOptions): Promise<{ deleted: true }>;
    addEventGroupMember(groupId: string, eventId: string, options?: RequestOptions): Promise<EventMembership>;
    removeEventGroupMember(
        groupId: string,
        eventId: string,
        options?: RequestOptions,
    ): Promise<EventMembership>;
}
