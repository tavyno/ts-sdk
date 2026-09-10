import { treaty } from '@elysia/eden';
import type { Elysia } from 'elysia';

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
  completeCalendarAuthorization(input: { state: string; code?: string; denied?: boolean }, options?: RequestOptions): Promise<{ id: string }>;
  connectionCalendars(id: string, options?: RequestOptions): Promise<ExternalCalendar[]>;
  refreshConnectionCalendars(id: string, options?: RequestOptions): Promise<ExternalCalendar[]>;
  selectExternalCalendar(id: string, selected: boolean, options?: RequestOptions): Promise<{ id: string; selected: boolean }>;
  syncExternalCalendar(id: string, options?: RequestOptions): Promise<{ status: 'syncing' | 'synced' }>;
  disconnectCalendar(id: string, options?: RequestOptions): Promise<{ disconnected: true }>;
}
type RequestOptions = { signal?: AbortSignal };
type Route<Body = unknown, Data = unknown, Query = unknown> = {
  body: Body; headers: unknown; query: Query; params: Record<string, string>;
  response: { 200: Data; 400: { error: string }; 401: { error: string }; 404: { error: string }; 409: { error: string }; 502: { error: string }; 503: { error: string } };
};
type CalendarApp = Elysia & { '~Routes': {
  'calendar-connections': {
    get: Route;
    google: { authorize: { post: Route }; complete: { post: Route<{ state: string; code?: string; denied?: boolean }> } };
    ':id': { calendars: { get: Route }; refresh: { post: Route }; delete: Route<unknown, unknown, { retention: 'delete' }> };
  };
  'external-calendars': { ':id': { patch: Route<{ selected: boolean }>; sync: { post: Route } } };
} };

export class ApiRequestError extends Error {
  constructor(public status: number, public code: string) {
    super(`API request failed (${status}: ${code})`);
  }
}
function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
const errorCodes = ['INVALID_AUTHORIZATION', 'NOT_FOUND', 'NOT_CONFIGURED', 'PROVIDER_UNAVAILABLE', 'RECONNECT_REQUIRED', 'SYNC_BUSY', 'INVALID_SELECTION', 'UNAUTHORIZED', 'INVALID_REQUEST'];
function unwrap(result: { status: number; data: unknown; error: unknown; response?: Response }) {
  if (!result.response && object(result.error)) { throw result.error.value; }
  if (result.status !== 200) {
    const error = object(result.error) ? result.error.value : undefined;
    const code = object(error) && typeof error.error === 'string' && errorCodes.includes(error.error) ? error.error : 'REQUEST_FAILED';
    throw new ApiRequestError(result.status, code);
  }
  return result.data;
}
function connections(value: unknown): CalendarConnection[] {
  if (!Array.isArray(value)) { throw new Error('Invalid connection response'); }
  return value.map((item: unknown) => {
    if (!object(item) || typeof item.id !== 'string' || typeof item.provider !== 'string' ||
      (item.status !== 'connected' && item.status !== 'reconnect_required')) { throw new Error('Invalid connection response'); }
    return { id: item.id, provider: item.provider, status: item.status };
  });
}
function calendars(value: unknown): ExternalCalendar[] {
  if (!Array.isArray(value)) { throw new Error('Invalid calendar response'); }
  return value.map((item: unknown) => {
    if (!object(item) || typeof item.id !== 'string' || typeof item.name !== 'string' || typeof item.selected !== 'boolean' ||
      (item.syncStatus !== 'idle' && item.syncStatus !== 'syncing' && item.syncStatus !== 'synced' && item.syncStatus !== 'failed') ||
      (item.lastSyncedAt !== null && typeof item.lastSyncedAt !== 'string')) { throw new Error('Invalid calendar response'); }
    return { id: item.id, name: item.name, selected: item.selected, syncStatus: item.syncStatus, lastSyncedAt: item.lastSyncedAt };
  });
}
function identity(value: unknown) {
  if (!object(value) || typeof value.id !== 'string') { throw new Error('Invalid identity response'); }
  return { id: value.id };
}

export function createCalendarClient(baseUrl: string, options: { jwt?: string; fetcher?: typeof fetch }): CalendarClient {
  const api = treaty<CalendarApp>(baseUrl.replace(/\/+$/, ''), {
    fetcher: options.fetcher, headers: options.jwt ? { Authorization: `Bearer ${options.jwt}` } : {}, parseDate: false,
  });
  const request = ({ signal }: RequestOptions = {}) => ({ fetch: { signal, cache: 'no-store' as const } });
  return {
    async calendarConnections(opts) { return connections(unwrap(await api['calendar-connections'].get(request(opts)))); },
    async authorizeCalendar(opts) {
      const value = unwrap(await api['calendar-connections'].google.authorize.post({}, request(opts)));
      if (!object(value) || typeof value.authorizationUrl !== 'string') { throw new Error('Invalid authorization response'); }
      const url = new URL(value.authorizationUrl);
      if (url.origin !== 'https://accounts.google.com' || url.pathname !== '/o/oauth2/v2/auth') { throw new Error('Invalid authorization response'); }
      return { authorizationUrl: url.href };
    },
    async completeCalendarAuthorization(input, opts) {
      return identity(unwrap(await api['calendar-connections'].google.complete.post(input, request(opts))));
    },
    async connectionCalendars(id, opts) { return calendars(unwrap(await api['calendar-connections']({ id }).calendars.get(request(opts)))); },
    async refreshConnectionCalendars(id, opts) { return calendars(unwrap(await api['calendar-connections']({ id }).refresh.post({}, request(opts)))); },
    async selectExternalCalendar(id, selected, opts) {
      const value = unwrap(await api['external-calendars']({ id }).patch({ selected }, request(opts)));
      if (!object(value) || typeof value.id !== 'string' || typeof value.selected !== 'boolean') { throw new Error('Invalid selection response'); }
      return { id: value.id, selected: value.selected };
    },
    async syncExternalCalendar(id, opts) {
      const value = unwrap(await api['external-calendars']({ id }).sync.post({}, request(opts)));
      if (!object(value) || (value.status !== 'syncing' && value.status !== 'synced')) { throw new Error('Invalid sync response'); }
      return { status: value.status };
    },
    async disconnectCalendar(id, opts) {
      const value = unwrap(await api['calendar-connections']({ id }).delete({}, { ...request(opts), query: { retention: 'delete' } }));
      if (!object(value) || value.disconnected !== true) { throw new Error('Invalid disconnect response'); }
      return { disconnected: true };
    },
  };
}
