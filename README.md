# @tavyno/ts-sdk

Public TypeScript OAuth and API client for the Tavyno REST API. ESM with
self-contained declarations and a Web Fetch API transport; no runtime dependencies or backend
repository access required. Web and React Native/Expo consumers supply a runtime
with fetch, URL, and AbortController (or compatible polyfills).

```ts
import { createApiClient } from '@tavyno/ts-sdk';

const api = createApiClient('https://your-api.example.com');
const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), 10_000);
try {
    const result = await api.healthCheck({ signal: controller.signal });
    // 200: { status: 'ok', db: 'ok' }
    // 503: { status: 'error', db: 'error' }
    console.log(result.status, result.data);
} finally {
    clearTimeout(timeout);
}
```

`healthCheck()` sends uncached `GET /health`. A base path is preserved and trailing
slashes are removed. Supply an absolute HTTP(S) URL without credentials, query,
or fragment. There is no environment lookup, implicit retry, or default
timeout; callers own cancellation and deadlines. Network errors reject; unexpected
HTTP statuses and malformed health responses reject with a sanitized message.
Documented 503 responses resolve as a typed unhealthy result.

For tests or a custom fetch implementation, pass `{ fetcher }` as the factory's
second argument. `ApiClient` and `HealthCheckResult` are public types. The client is
independent of the server framework. Its wire model follows `rest-api`'s `/health`
route and tests; update them together when that server contract changes. The
backend never imports this package.

## Local development

Use Node 24 and npm (the SDK itself uses Web Standard APIs).

```sh
npm ci
npm run check
npm run test:package
npm pack
```

`check` runs lint, typecheck, build and unit tests. Package verification installs
the tarball in a temporary project without sibling repositories, verifies its
file allowlist, runs ESM, and checks strict Next-style, Expo-style and NodeNext
TypeScript consumers. Browser/react-native-condition bundle checks catch runtime
imports; these are compatibility smoke tests, not an Expo device test.

Released consumers use the published npm version. For a coordinated review of an
unreleased SDK change, create a package with `npm pack --pack-destination /tmp` after
checks pass. A consumer may commit that tarball only with an explicit, reviewed
source-commit/integrity manifest and matching dependency verification; its normal
published-package check must not be silently bypassed. Replace the review artifact
with the registry version after the approved release. No publishing is needed to
review or verify the package locally.

## Versioning and release

Use semantic versions. Breaking public contract changes require the appropriate
major version (during 0.x, communicate breaking changes with a minor version).

1. Merge a validated version/lockfile update, e.g. `npm version patch --no-git-tag-version`.
2. Configure a GitHub environment named `npm` with required reviewers and restrict
   deployments to the `main` branch. Protect main in repository settings.
3. Configure npm Trusted Publishing for `@tavyno/ts-sdk`: GitHub organization
   `Tavyno`, repository `sdk`, workflow `release.yml`, environment `npm`,
   with publishing allowed. This requires npm organization/package permissions.
   For a new package, an owner may need to bootstrap its first publication before
   its trusted-publisher settings are available. Never commit a token.
4. Merge the version/lockfile update to `main` (for example, version `0.1.0`).
5. `release.yml` checks that the version is new and greater than every published
   version, runs checks and isolated package tests, then waits for environment
   approval. The publish job repeats validation before `npm publish --access
   public --provenance` using OIDC.
6. Verify `npm view @tavyno/ts-sdk@0.1.0` and install it in a clean consumer.

CI uses Node 24 with npm >=11.5.1 for Trusted Publishing. Failed checks prevent
publication. Workflow files do not themselves configure npm trust, repository
protection, or environment reviewers; maintainers must configure those settings.
See [npm Trusted Publishing](https://docs.npmjs.com/trusted-publishers/).

Pass a function that returns the current access token from your authentication layer:

```ts
const client = createApiClient(apiUrl, { getAccessToken: () => accessToken });
await client.healthCheck(); // Includes Authorization: Bearer <JWT>, even on public routes.
```

The callback is evaluated before every request and may return a token synchronously or
asynchronously, so refreshed tokens are used without recreating the client. Return `null` or
`undefined` (or omit `getAccessToken`) for anonymous requests. The separate provider-neutral
OAuth client acquires and refreshes tokens; neither client owns runtime storage or depends on Auth0.

## Portable OAuth / PKCE

`createOAuthClient({ issuer, clientId, audience })` uses standards-based OIDC discovery,
PKCE S256, state/nonce validation, RS256 ID-token verification, public-client code
exchange, refresh-token rotation, and RP-initiated logout. It has no Auth0 dependency.

```ts
const oauth = createOAuthClient({ issuer, clientId, audience });
const { authorizationUrl, transaction } = await oauth.createLogin({ redirectUri });
// Host: persist transaction securely and open authorizationUrl.
const tokens = await oauth.completeLogin(callbackUrl, transaction);
const user = await createApiClient(apiUrl, { getAccessToken: () => tokens.accessToken }).establishSession();
const renewed = await oauth.refresh(tokens);
```

The host must consume the saved transaction once, persist the latest rotated tokens,
and serialize refresh calls. Browser code owns navigation/storage; mobile code owns
its browser session and OS secure storage. The SDK only uses standard Fetch, URL,
AbortController/AbortSignal, TextEncoder, and Web Crypto APIs. React Native hosts
must supply compatible Web API/Web Crypto polyfills where their runtime lacks them;
no Node or DOM module is imported. Package checks cover Next/Expo typings and browser/mobile
bundling; real-device OAuth still requires testing with the chosen mobile host.

## Calendar integration methods

Use `calendarConnections`, `authorizeCalendar`, `completeCalendarAuthorization`,
`connectionCalendars`, `refreshConnectionCalendars`, `selectExternalCalendar`,
`syncExternalCalendar`, and `disconnectCalendar` for the optional integration.
Every method uses the configured JWT. Sync processes one provider page per request;
continue while the returned status is `syncing`, and pass an AbortSignal to pause.
Disconnect deletes the integration's cached imports (`retention=delete`).
Provider credentials are never included in client contracts.


## Canonical calendar, Events and Event Groups

These methods implement the provider-neutral boundaries from
[SRS MVP v0.4](https://github.com/tavyno/project/blob/main/docs/requirements/srs-mvp-v0.4.md)
and [project issue #4](https://github.com/tavyno/project/issues/4). All ownership
comes from the authenticated Tavyno user; no method accepts a user or provider ID.

```ts
const { calendars } = await client.calendars();
const calendar = calendars.find((item) => item.isDefault);
if (!calendar) throw new Error('Default calendar unavailable');

const event = await client.createEvent({
    calendarId: calendar.id,
    title: 'Weekly lecture',
    start: '2026-09-12T09:00:00-04:00',
    end: '2026-09-12T10:00:00-04:00',
    timeZone: 'America/New_York',
    allDay: false,
    recurrence: ['RRULE:FREQ=WEEKLY;COUNT=10'],
});
const group = await client.createEventGroup({ name: 'Course' });
await client.addEventGroupMember(group.id, event.id);
const schedule = await client.events({
    start: '2026-09-01T00:00:00Z',
    end: '2026-10-01T00:00:00Z',
    groupId: group.id,
});
```

| Resource | Methods |
| --- | --- |
| Calendars | `calendars`, `createCalendar`, `updateCalendar`, `deleteCalendar` |
| Events | `events`, `event`, `createEvent`, `updateEvent`, `deleteEvent` |
| Groups | `eventGroups`, `eventGroup`, `createEventGroup`, `updateEventGroup`, `deleteEventGroup` |
| Membership | `addEventGroupMember`, `removeEventGroupMember` |

`calendars()` and `eventGroups()` return `{ calendars }` and `{ groups }`.
`events(range)` returns canonical `{ events, occurrences }`, with optional
`calendarId` and `groupId` filters. `eventGroup(id, { start, end })` includes the
Group, member Events, derived occurrences in that window and generic Field
projections. Reads use persisted Tavyno state; they do not contact providers.

All-day schedule values are `YYYY-MM-DD` dates with exclusive end dates. Timed
values are ISO timestamps with an IANA `timeZone`. The host owns date presentation,
calendar navigation, loading/error state and choice of range. Recurrence uses the
REST API's supported recurrence rules; the SDK does not expand occurrences.

Event `groups` are series memberships inherited by every occurrence, including
future ones. An Event may have several Groups. Deleting a Group leaves member
Events intact. Schedule mutations default to the entire Event/series. Pass
`{ scope: 'occurrence', occurrenceId }` as the request options to edit or cancel a
single occurrence; its canonical ID stays stable when the instance moves.
Occurrence edits support title, description, location, start, end, timeZone and
allDay, excluding calendarId and recurrence. Provider-backed schedule fields remain
read-only; use `origin` and `capabilities` to present the correct host controls.

Event and Group details expose generic `FieldContext` projections; installation,
schema rendering, binding/value writes and the Marketplace belong to their separate
feature contracts. This release does not implement those APIs. Values are copied as
JSON documents with a defensive maximum nesting depth of 32. Unknown wire fields
are discarded, including any accidental provider payload or credential fields.

Every operation accepts an optional `signal`, obtains the latest access token and
uses uncached requests without retries. Documented errors reject with
`ApiRequestError`, including `INVALID_REQUEST`, `RANGE_TOO_LARGE`, `UNAUTHORIZED`,
`NOT_FOUND` and `READ_ONLY`; unknown HTTP errors use `REQUEST_FAILED`. Malformed
successful responses reject separately with `Invalid schedule response`, and
transport/cancellation failures preserve their original reason. No private response
body is included in these errors.
