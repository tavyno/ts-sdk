import { createFetch, FetchError } from 'ofetch';

export type ClientOptions = {
    fetcher?: typeof fetch;
    getAccessToken?: () => string | null | undefined | Promise<string | null | undefined>;
};

export type RequestOptions = {
    signal?: AbortSignal;
};

export type ApiResponse = {
    status: number;
    body: unknown;
};

export type ApiRequest = (
    path: string,
    options?: RequestOptions & {
        method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
        body?: unknown;
        query?: URLSearchParams;
    },
) => Promise<ApiResponse>;

export function createApiRequest(baseUrl: URL, options: ClientOptions): ApiRequest {
    const $fetch = createFetch({
        fetch: options.fetcher ?? globalThis.fetch,
    });
    const rootUrl = baseUrl.href.replace(/\/+$/, '');

    return async (path, requestOptions = {}) => {
        const url = new URL(`${rootUrl}/${path.replace(/^\/+/, '')}`);

        if (requestOptions.query) {
            url.search = requestOptions.query.toString();
        }

        const accessToken = await options.getAccessToken?.();

        if (accessToken != null && typeof accessToken !== 'string') {
            throw new Error('Invalid access token');
        }

        const headers = new Headers();

        if (accessToken) {
            headers.set('Authorization', `Bearer ${accessToken}`);
        }

        if (requestOptions.body !== undefined) {
            headers.set('Content-Type', 'application/json');
        }

        try {
            const response = await $fetch.raw(url.href, {
                method: requestOptions.method ?? 'GET',
                headers,
                body: requestOptions.body === undefined ? undefined : JSON.stringify(requestOptions.body),
                signal: requestOptions.signal,
                cache: 'no-store',
                retry: 0,
                ignoreResponseError: true,
                parseResponse: (text) => {
                    try {
                        return JSON.parse(text);
                    } catch {
                        return undefined;
                    }
                },
            });

            return { status: response.status, body: response._data };
        } catch (error) {
            if (error instanceof FetchError && error.cause !== undefined) {
                throw error.cause;
            }

            throw error;
        }
    };
}

