import { treaty } from "@elysia/eden";
import type { Elysia } from "elysia";

export type HealthCheckResult =
  | { status: 200; data: { status: "ok"; db: "ok" } }
  | { status: 503; data: { status: "error"; db: "error" } };

export interface ApiClient {
  healthCheck(options?: { signal?: AbortSignal }): Promise<HealthCheckResult>;
}

// Public wire contract of rest-api GET /health; no Worker or database types.
type HealthApp = Elysia & {
  "~Routes": {
    health: {
      get: {
        body: unknown;
        headers: unknown;
        query: unknown;
        params: Record<never, never>;
        response: {
          200: { status: "ok"; db: "ok" };
          503: { status: "error"; db: "error" };
        };
      };
    };
  };
};

export function createApiClient(
  baseUrl: string,
  options: { fetcher?: typeof fetch; jwt?: string } = {},
): ApiClient {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new Error("Invalid API base URL");
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error("Invalid API base URL");
  }
  const api = treaty<HealthApp>(url.href.replace(/\/+$/, ''), {
    fetcher: options.fetcher,
    headers: options.jwt ? { Authorization: `Bearer ${options.jwt}` } : {},
    parseDate: false,
  });
  return {
    async healthCheck({ signal } = {}) {
      const result = await api.health.get({ fetch: { signal, cache: "no-store" } });
      if (!result.response && result.error) throw result.error.value;
      if (result.status !== 200 && result.status !== 503) {
        throw new Error(`Health request failed (${result.status})`);
      }
      const body: unknown = result.error ? result.error.value : result.data;
      if (typeof body === "object" && body !== null && 'status' in body && 'db' in body) {
        if (result.status === 200 && body.status === 'ok' && body.db === 'ok') {
          return { status: 200, data: { status: 'ok', db: 'ok' } };
        }
        if (result.status === 503 && body.status === 'error' && body.db === 'error') {
          return { status: 503, data: { status: 'error', db: 'error' } };
        }
      }
      throw new Error("Invalid health response");
    },
  };
}
