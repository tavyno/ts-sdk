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

Until the first npm release, the web repository uses a checked-in tarball under
`vendor/`, making clean installs independent of sibling checkouts. Refresh it:

```sh
npm run check && npm run test:package
npm pack --pack-destination ../web/vendor
cd ../web
npm install ./vendor/tavyno-ts-sdk-0.1.0.tgz
npm test && npm run typecheck && npm run lint && npm run build
```

After publishing, replace the web file dependency with the released registry
version: `npm install @tavyno/ts-sdk@0.1.0`. No publishing has been performed
as part of this initial scaffold.

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
