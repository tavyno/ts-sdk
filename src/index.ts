import { createCalendarClient } from './calendar.js';
import type { CalendarClient } from './calendar.js';
import { createApiRequest } from './http.js';

export { ApiRequestError } from './calendar.js';
export type { CalendarConnection, ExternalCalendar } from './calendar.js';

export type HealthCheckResult =
    { status: 200; data: { status: 'ok'; db: 'ok' } } | { status: 503; data: { status: 'error'; db: 'error' } };

export interface ApiClient extends CalendarClient {
    establishSession(options?: { signal?: AbortSignal }): Promise<{ id: string }>;
    me(options?: { signal?: AbortSignal }): Promise<{ id: string }>;
    healthCheck(options?: { signal?: AbortSignal }): Promise<HealthCheckResult>;
}

function readIdentity(result: { status: number; body: unknown }) {
    if (result.status !== 200) {
        throw new Error(`Identity request failed (${result.status})`);
    }

    if (
        typeof result.body !== 'object' ||
        result.body === null ||
        !('id' in result.body) ||
        typeof result.body.id !== 'string'
    ) {
        throw new Error('Invalid identity response');
    }

    return { id: result.body.id };
}

export function createApiClient(
    baseUrl: string,
    options: {
        fetcher?: typeof fetch;
        getAccessToken?: () => string | null | undefined | Promise<string | null | undefined>;
    } = {},
): ApiClient {
    let url: URL;
    try {
        url = new URL(baseUrl);
    } catch {
        throw new Error('Invalid API base URL');
    }

    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
        throw new Error('Invalid API base URL');
    }

    const request = createApiRequest(url, options);

    return {
        ...createCalendarClient(url.href, options),
        async establishSession({ signal } = {}) {
            return readIdentity(await request('session', { method: 'POST', signal }));
        },
        async me({ signal } = {}) {
            return readIdentity(await request('me', { signal }));
        },
        async healthCheck({ signal } = {}) {
            const result = await request('health', { signal });

            if (result.status !== 200 && result.status !== 503) {
                throw new Error(`Health request failed (${result.status})`);
            }

            const body = result.body;

            if (typeof body === 'object' && body !== null && 'status' in body && 'db' in body) {
                if (result.status === 200 && body.status === 'ok' && body.db === 'ok') {
                    return { status: 200, data: { status: 'ok', db: 'ok' } };
                }

                if (result.status === 503 && body.status === 'error' && body.db === 'error') {
                    return { status: 503, data: { status: 'error', db: 'error' } };
                }
            }

            throw new Error('Invalid health response');
        },
    };
}

export { createOAuthClient, readLoginTransaction, readOAuthTokens, OAuthError } from './oauth.js';
export type { OAuthConfig, OAuthTokens, LoginTransaction } from './oauth.js';
