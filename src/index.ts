import { createCalendarClient } from './calendar.js';
import type { CalendarClient, ClientOptions } from './calendar.js';
import { createApiFetch } from './transport.js';
import { createScheduleClient } from './schedule.js';
import type { ScheduleClient } from './schedule-contracts.js';

export type * from './schedule-contracts.js';

export { ApiRequestError } from './calendar.js';
export type { CalendarConnection, ExternalCalendar, ClientOptions } from './calendar.js';

/**
 * Represents the operational state of the Tavyno API and its database.
 */
export type HealthCheckResult =
    { status: 200; data: { status: 'ok'; db: 'ok' } } | { status: 503; data: { status: 'error'; db: 'error' } };

/**
 * Provides session, identity, health, and calendar operations for the Tavyno API.
 *
 * Request methods accept an optional abort signal and propagate cancellation and
 * transport failures from the configured fetch implementation.
 */
export interface ApiClient extends CalendarClient, ScheduleClient {
    /**
     * Establishes a Tavyno session for the current access token.
     *
     * @param options - Request options, including an optional cancellation signal.
     * @returns The Tavyno identifier of the authenticated user.
     */
    establishSession(options?: { signal?: AbortSignal }): Promise<{ id: string }>;

    /**
     * Retrieves the identity associated with the current access token.
     *
     * @param options - Request options, including an optional cancellation signal.
     * @returns The Tavyno identifier of the authenticated user.
     */
    me(options?: { signal?: AbortSignal }): Promise<{ id: string }>;

    /**
     * Retrieves the operational state of the API and its database.
     *
     * A service-unavailable response is returned as a `503` result rather than
     * rejected as an error.
     *
     * @param options - Request options, including an optional cancellation signal.
     * @returns The reported service health.
     */
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

/**
 * Creates a client for the Tavyno REST API.
 *
 * The access-token callback is evaluated for every request, allowing credentials
 * to change as the host application's session changes. Returning `null`,
 * `undefined`, or an empty string sends the request without authorization.
 *
 * @param baseUrl - HTTP or HTTPS API base URL, optionally including a path prefix.
 * @param options - Transport and authentication configuration.
 * @returns A configured {@link ApiClient}.
 * @throws If `baseUrl` is invalid or contains credentials, a query, or a fragment.
 */
export function createApiClient(
    baseUrl: string,
    options: ClientOptions = {},
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

    const $fetch = createApiFetch(url.href, options);

    return {
        ...createCalendarClient(url.href, options),
        ...createScheduleClient(url.href, options),
        async establishSession({ signal } = {}) {
            const response = await $fetch.raw('session', { method: 'POST', signal });

            return readIdentity({ status: response.status, body: response._data });
        },
        async me({ signal } = {}) {
            const response = await $fetch.raw('me', { signal });

            return readIdentity({ status: response.status, body: response._data });
        },
        async healthCheck({ signal } = {}) {
            const response = await $fetch.raw('health', { signal });

            if (response.status !== 200 && response.status !== 503) {
                throw new Error(`Health request failed (${response.status})`);
            }

            const body = response._data;

            if (typeof body === 'object' && body !== null && 'status' in body && 'db' in body) {
                if (response.status === 200 && body.status === 'ok' && body.db === 'ok') {
                    return { status: 200, data: { status: 'ok', db: 'ok' } };
                }

                if (response.status === 503 && body.status === 'error' && body.db === 'error') {
                    return { status: 503, data: { status: 'error', db: 'error' } };
                }
            }

            throw new Error('Invalid health response');
        },
    };
}

export { createOAuthClient, readLoginTransaction, readOAuthTokens, OAuthError } from './oauth.js';
export type { OAuthConfig, OAuthTokens, LoginTransaction } from './oauth.js';
