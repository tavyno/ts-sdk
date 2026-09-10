import { createApiRequest } from './http.js';
import type { ClientOptions } from './http.js';

/**
 * Represents an external calendar provider connection owned by the current user.
 */
export interface CalendarConnection {
    id: string;

    /** Identifies the external calendar provider. */
    provider: string;

    /** Indicates whether the connection can be used or must be authorized again. */
    status: 'connected' | 'reconnect_required';
}

/**
 * Represents an external calendar available through a calendar connection.
 */
export interface ExternalCalendar {
    id: string;
    name: string;

    /** Determines whether the calendar participates in Tavyno synchronization. */
    selected: boolean;

    /** Describes the current synchronization state. */
    syncStatus: 'idle' | 'syncing' | 'synced' | 'failed';

    /** Timestamp reported for the most recent synchronization, or `null` if none is available. */
    lastSyncedAt: string | null;
}

/**
 * Provides operations for connecting and synchronizing external calendars.
 */
export interface CalendarClient {
    /**
     * Retrieves the current user's external calendar connections.
     *
     * @throws {@link ApiRequestError} If the API rejects the request.
     */
    calendarConnections(options?: RequestOptions): Promise<CalendarConnection[]>;

    /**
     * Starts authorization for a Google Calendar connection.
     *
     * The host application is responsible for navigating to the returned URL.
     *
     * @returns A validated Google authorization URL.
     * @throws {@link ApiRequestError} If the API rejects the request.
     */
    authorizeCalendar(options?: RequestOptions): Promise<{ authorizationUrl: string }>;

    /**
     * Completes authorization for a Google Calendar connection.
     *
     * @param input - Provider callback state and either an authorization code or denial indicator.
     * @returns The identifier of the resulting calendar connection.
     * @throws {@link ApiRequestError} If the API rejects the request.
     */
    completeCalendarAuthorization(
        input: { state: string; code?: string; denied?: boolean },
        options?: RequestOptions,
    ): Promise<{ id: string }>;

    /**
     * Retrieves the external calendars available through a connection.
     *
     * @param id - Calendar connection identifier.
     * @throws {@link ApiRequestError} If the API rejects the request.
     */
    connectionCalendars(id: string, options?: RequestOptions): Promise<ExternalCalendar[]>;

    /**
     * Refreshes and returns the external calendars available through a connection.
     *
     * @param id - Calendar connection identifier.
     * @throws {@link ApiRequestError} If the API rejects the request.
     */
    refreshConnectionCalendars(id: string, options?: RequestOptions): Promise<ExternalCalendar[]>;

    /**
     * Changes whether an external calendar participates in synchronization.
     *
     * @param id - External calendar identifier.
     * @param selected - Whether to include the calendar in synchronization.
     * @returns The external calendar identifier and its resulting selection state.
     * @throws {@link ApiRequestError} If the API rejects the request.
     */
    selectExternalCalendar(
        id: string,
        selected: boolean,
        options?: RequestOptions,
    ): Promise<{ id: string; selected: boolean }>;

    /**
     * Requests synchronization of an external calendar.
     *
     * @param id - External calendar identifier.
     * @returns Whether synchronization is in progress or already completed.
     * @throws {@link ApiRequestError} If the API rejects the request.
     */
    syncExternalCalendar(id: string, options?: RequestOptions): Promise<{ status: 'syncing' | 'synced' }>;

    /**
     * Disconnects an external calendar provider and deletes its retained connection data.
     *
     * @param id - Calendar connection identifier.
     * @throws {@link ApiRequestError} If the API rejects the request.
     */
    disconnectCalendar(id: string, options?: RequestOptions): Promise<{ disconnected: true }>;
}

type RequestOptions = { signal?: AbortSignal };

/**
 * Represents a rejected Tavyno calendar API request.
 *
 * Exposes the HTTP status and a stable API error code when recognized. Unknown
 * error responses use the `REQUEST_FAILED` code.
 */
export class ApiRequestError extends Error {
    constructor(
        /** HTTP status code returned for the rejected request. */
        public status: number,
        /** API error code, or `REQUEST_FAILED` when no recognized code is available. */
        public code: string,
    ) {
        super(`API request failed (${status}: ${code})`);
    }
}

function object(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const errorCodes = [
    'INVALID_AUTHORIZATION',
    'NOT_FOUND',
    'NOT_CONFIGURED',
    'PROVIDER_UNAVAILABLE',
    'RECONNECT_REQUIRED',
    'SYNC_BUSY',
    'INVALID_SELECTION',
    'UNAUTHORIZED',
    'INVALID_REQUEST',
];
function unwrap(result: { status: number; body: unknown }) {
    if (result.status !== 200) {
        const code =
            object(result.body) && typeof result.body.error === 'string' && errorCodes.includes(result.body.error)
                ? result.body.error
                : 'REQUEST_FAILED';
        throw new ApiRequestError(result.status, code);
    }

    return result.body;
}

function connections(value: unknown): CalendarConnection[] {
    if (!Array.isArray(value)) {
        throw new Error('Invalid connection response');
    }

    return value.map((item: unknown) => {
        if (
            !object(item) ||
            typeof item.id !== 'string' ||
            typeof item.provider !== 'string' ||
            (item.status !== 'connected' && item.status !== 'reconnect_required')
        ) {
            throw new Error('Invalid connection response');
        }

        return { id: item.id, provider: item.provider, status: item.status };
    });
}

function calendars(value: unknown): ExternalCalendar[] {
    if (!Array.isArray(value)) {
        throw new Error('Invalid calendar response');
    }

    return value.map((item: unknown) => {
        if (
            !object(item) ||
            typeof item.id !== 'string' ||
            typeof item.name !== 'string' ||
            typeof item.selected !== 'boolean' ||
            (item.syncStatus !== 'idle' &&
                item.syncStatus !== 'syncing' &&
                item.syncStatus !== 'synced' &&
                item.syncStatus !== 'failed') ||
            (item.lastSyncedAt !== null && typeof item.lastSyncedAt !== 'string')
        ) {
            throw new Error('Invalid calendar response');
        }

        return {
            id: item.id,
            name: item.name,
            selected: item.selected,
            syncStatus: item.syncStatus,
            lastSyncedAt: item.lastSyncedAt,
        };
    });
}

function identity(value: unknown) {
    if (!object(value) || typeof value.id !== 'string') {
        throw new Error('Invalid identity response');
    }

    return { id: value.id };
}

/**
 * Creates a client for Tavyno calendar operations.
 *
 * @param baseUrl - API base URL used for calendar requests.
 * @param options - Transport and authentication configuration.
 * @returns A configured {@link CalendarClient}.
 */
export function createCalendarClient(
    baseUrl: string,
    options: ClientOptions,
): CalendarClient {
    const request = createApiRequest(new URL(baseUrl), options);
    const segment = (value: string) => encodeURIComponent(value);

    return {
        async calendarConnections(opts) {
            return connections(unwrap(await request('calendar-connections', opts)));
        },
        async authorizeCalendar(opts) {
            const value = unwrap(
                await request('calendar-connections/google/authorize', { ...opts, method: 'POST' }),
            );
            if (!object(value) || typeof value.authorizationUrl !== 'string') {
                throw new Error('Invalid authorization response');
            }

            const url = new URL(value.authorizationUrl);

            if (url.origin !== 'https://accounts.google.com' || url.pathname !== '/o/oauth2/v2/auth') {
                throw new Error('Invalid authorization response');
            }

            return { authorizationUrl: url.href };
        },
        async completeCalendarAuthorization(input, opts) {
            return identity(
                unwrap(
                    await request('calendar-connections/google/complete', {
                        ...opts,
                        method: 'POST',
                        body: input,
                    }),
                ),
            );
        },
        async connectionCalendars(id, opts) {
            return calendars(unwrap(await request(`calendar-connections/${segment(id)}/calendars`, opts)));
        },
        async refreshConnectionCalendars(id, opts) {
            return calendars(
                unwrap(
                    await request(`calendar-connections/${segment(id)}/refresh`, {
                        ...opts,
                        method: 'POST',
                    }),
                ),
            );
        },
        async selectExternalCalendar(id, selected, opts) {
            const value = unwrap(
                await request(`external-calendars/${segment(id)}`, {
                    ...opts,
                    method: 'PATCH',
                    body: { selected },
                }),
            );
            if (!object(value) || typeof value.id !== 'string' || typeof value.selected !== 'boolean') {
                throw new Error('Invalid selection response');
            }

            return { id: value.id, selected: value.selected };
        },
        async syncExternalCalendar(id, opts) {
            const value = unwrap(
                await request(`external-calendars/${segment(id)}/sync`, { ...opts, method: 'POST' }),
            );
            if (!object(value) || (value.status !== 'syncing' && value.status !== 'synced')) {
                throw new Error('Invalid sync response');
            }

            return { status: value.status };
        },
        async disconnectCalendar(id, opts) {
            const value = unwrap(
                await request(`calendar-connections/${segment(id)}`, {
                    ...opts,
                    method: 'DELETE',
                    query: new URLSearchParams({ retention: 'delete' }),
                }),
            );
            if (!object(value) || value.disconnected !== true) {
                throw new Error('Invalid disconnect response');
            }

            return { disconnected: true };
        },
    };
}
