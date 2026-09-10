import { createApiRequest } from './http.js';
import type { ClientOptions } from './http.js';

export interface CalendarConnection {
    id: string;
    provider: string;
    status: 'connected' | 'reconnect_required';
}

export interface ExternalCalendar {
    id: string;
    name: string;
    selected: boolean;
    syncStatus: 'idle' | 'syncing' | 'synced' | 'failed';
    lastSyncedAt: string | null;
}

export interface CalendarClient {
    calendarConnections(options?: RequestOptions): Promise<CalendarConnection[]>;
    authorizeCalendar(options?: RequestOptions): Promise<{ authorizationUrl: string }>;
    completeCalendarAuthorization(
        input: { state: string; code?: string; denied?: boolean },
        options?: RequestOptions,
    ): Promise<{ id: string }>;
    connectionCalendars(id: string, options?: RequestOptions): Promise<ExternalCalendar[]>;
    refreshConnectionCalendars(id: string, options?: RequestOptions): Promise<ExternalCalendar[]>;
    selectExternalCalendar(
        id: string,
        selected: boolean,
        options?: RequestOptions,
    ): Promise<{ id: string; selected: boolean }>;
    syncExternalCalendar(id: string, options?: RequestOptions): Promise<{ status: 'syncing' | 'synced' }>;
    disconnectCalendar(id: string, options?: RequestOptions): Promise<{ disconnected: true }>;
}

type RequestOptions = { signal?: AbortSignal };

export class ApiRequestError extends Error {
    constructor(
        public status: number,
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
