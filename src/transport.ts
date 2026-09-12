import { createFetch } from 'ofetch';

/**
 * Transport and authentication configuration for Tavyno clients.
 */
export type ClientOptions = {
    /** Fetch implementation used for API requests. */
    fetcher?: typeof fetch;

    /**
     * Provides the access token for each request.
     *
     * The callback may return a different token on each invocation. Returning
     * `null`, `undefined`, or an empty string sends the request anonymously.
     */
    getAccessToken?: () => string | null | undefined | Promise<string | null | undefined>;
};

/**
 * Represents a rejected Tavyno API request.
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
    'READ_ONLY',
    'RANGE_TOO_LARGE',
];

export function unwrap(result: { status: number; _data?: unknown }) {
    if (result.status !== 200) {
        const code =
            object(result._data) &&
            typeof result._data.error === 'string' &&
            errorCodes.includes(result._data.error)
                ? result._data.error
                : 'REQUEST_FAILED';

        throw new ApiRequestError(result.status, code);
    }

    return result._data;
}

type ApiFetch = {
    raw(
        path: string,
        options?: {
            method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
            signal?: AbortSignal;
            body?: object;
            query?: object;
        },
    ): Promise<{ status: number; _data?: unknown }>;
};

export function createApiFetch(baseUrl: string, options: ClientOptions): ApiFetch {
    const rootUrl = baseUrl.replace(/\/+$/, '');
    const $fetch = createFetch({
        fetch: options.fetcher ?? globalThis.fetch,
        defaults: {
            baseURL: rootUrl,
            method: 'GET',
            retry: 0,
            cache: 'no-store',
            ignoreResponseError: true,
            async onRequest({ options: requestOptions }) {
                const accessToken = await options.getAccessToken?.();

                if (accessToken != null && typeof accessToken !== 'string') {
                    throw new Error('Invalid access token');
                }

                if (accessToken) {
                    requestOptions.headers = new Headers(requestOptions.headers);
                    requestOptions.headers.set('Authorization', `Bearer ${accessToken}`);
                }
            },
            onRequestError(context) {
                throw context.error;
            },
            parseResponse(text) {
                try {
                    return JSON.parse(text);
                } catch {
                    return undefined;
                }
            },
        },
    });

    return $fetch;
}
