import { createCalendarClient } from './calendar.js';
import type { CalendarClient } from './calendar.js';

export { ApiRequestError } from './calendar.js';
export type { CalendarConnection, ExternalCalendar } from './calendar.js';

import { treaty } from '@elysia/eden';
import type { Elysia } from 'elysia';

export type HealthCheckResult =
    { status: 200; data: { status: 'ok'; db: 'ok' } } | { status: 503; data: { status: 'error'; db: 'error' } };

export interface ApiClient extends CalendarClient {
    establishSession(options?: { signal?: AbortSignal }): Promise<{ id: string }>;
    me(options?: { signal?: AbortSignal }): Promise<{ id: string }>;
    healthCheck(options?: { signal?: AbortSignal }): Promise<HealthCheckResult>;
}

type IdentityRoute = {
    body: unknown;
    headers: unknown;
    query: unknown;
    params: Record<never, never>;
    response: { 200: { id: string }; 401: { error: string }; 404: { error: string } };
};

function readIdentity(result: { status: number; data: unknown; error: unknown; response?: Response }) {
    if (!result.response && result.error && typeof result.error === 'object' && 'value' in result.error) {
        throw result.error.value;
    }

    if (result.status !== 200) {
        throw new Error(`Identity request failed (${result.status})`);
    }

    if (
        typeof result.data !== 'object' ||
        result.data === null ||
        !('id' in result.data) ||
        typeof result.data.id !== 'string'
    ) {
        throw new Error('Invalid identity response');
    }

    return { id: result.data.id };
}

// Public wire contract of rest-api GET /health; no Worker or database types.
type HealthApp = Elysia & {
    '~Routes': {
        session: { post: IdentityRoute };
        me: { get: IdentityRoute };
        health: {
            get: {
                body: unknown;
                headers: unknown;
                query: unknown;
                params: Record<never, never>;
                response: {
                    200: { status: 'ok'; db: 'ok' };
                    503: { status: 'error'; db: 'error' };
                };
            };
        };
    };
};

export function createApiClient(baseUrl: string, options: { fetcher?: typeof fetch; jwt?: string } = {}): ApiClient {
    let url: URL;
    try {
        url = new URL(baseUrl);
    } catch {
        throw new Error('Invalid API base URL');
    }

    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
        throw new Error('Invalid API base URL');
    }

    const api = treaty<HealthApp>(url.href.replace(/\/+$/, ''), {
        fetcher: options.fetcher,
        headers: options.jwt ? { Authorization: `Bearer ${options.jwt}` } : {},
        parseDate: false,
    });

    return {
        ...createCalendarClient(url.href, options),
        async establishSession({ signal } = {}) {
            return readIdentity(await api.session.post({}, { fetch: { signal, cache: 'no-store' } }));
        },
        async me({ signal } = {}) {
            return readIdentity(await api.me.get({ fetch: { signal, cache: 'no-store' } }));
        },
        async healthCheck({ signal } = {}) {
            const result = await api.health.get({ fetch: { signal, cache: 'no-store' } });

            if (!result.response && result.error) {
                throw result.error.value;
            }

            if (result.status !== 200 && result.status !== 503) {
                throw new Error(`Health request failed (${result.status})`);
            }

            const body: unknown = result.error ? result.error.value : result.data;

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
