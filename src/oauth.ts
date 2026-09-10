import * as oauth from 'oauth4webapi';

/**
 * Configures the runtime-neutral OAuth/OIDC client.
 */
export interface OAuthConfig {
    /** HTTPS issuer URL used for authorization-server discovery. */
    issuer: string;

    /** Public OAuth client identifier. */
    clientId: string;

    /** Optional audience included in authorization requests. */
    audience?: string;

    /** Requested scopes, or the client's default OpenID scopes when omitted. */
    scope?: string;

    /** Fetch implementation used for discovery, token, and signature-validation requests. */
    fetcher?: typeof fetch;
}

/**
 * Represents the transient PKCE state required to complete a login.
 *
 * Hosts must persist this value securely between starting authorization and
 * processing the callback.
 */
export interface LoginTransaction {
    state: string;
    nonce: string;
    codeVerifier: string;
    redirectUri: string;
    issuer: string;
    clientId: string;
    /** Absolute expiration time expressed as Unix time in milliseconds. */
    expiresAt: number;
}

/**
 * Represents OAuth tokens obtained for an authenticated session.
 */
export interface OAuthTokens {
    accessToken: string;
    refreshToken?: string;
    idToken?: string;
    /** Absolute access-token expiration time expressed as Unix time in milliseconds. */
    expiresAt: number;
}

/**
 * Represents a failure during an OAuth login, transaction validation, or token refresh.
 */
export class OAuthError extends Error {
    /**
     * Creates an OAuth error with a caller-actionable failure category.
     *
     * @param code - Stage and category of the OAuth failure.
     */
    constructor(public code: 'LOGIN_FAILED' | 'INVALID_TRANSACTION' | 'REFRESH_FAILED') {
        super(code);
    }
}

function object(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

/**
 * Validates and normalizes a persisted login transaction.
 *
 * Unknown properties are discarded.
 *
 * @param value - Untrusted persisted value to validate.
 * @returns A validated {@link LoginTransaction}.
 * @throws {@link OAuthError} With `INVALID_TRANSACTION` when the value is malformed.
 */
export function readLoginTransaction(value: unknown): LoginTransaction {
    if (
        !object(value) ||
        typeof value.state !== 'string' ||
        typeof value.nonce !== 'string' ||
        typeof value.codeVerifier !== 'string' ||
        typeof value.redirectUri !== 'string' ||
        typeof value.issuer !== 'string' ||
        typeof value.clientId !== 'string' ||
        typeof value.expiresAt !== 'number'
    ) {
        throw new OAuthError('INVALID_TRANSACTION');
    }

    return {
        state: value.state,
        nonce: value.nonce,
        codeVerifier: value.codeVerifier,
        redirectUri: value.redirectUri,
        issuer: value.issuer,
        clientId: value.clientId,
        expiresAt: value.expiresAt,
    };
}

/**
 * Validates and normalizes persisted OAuth tokens.
 *
 * Unknown properties and empty optional tokens are discarded.
 *
 * @param value - Untrusted persisted value to validate.
 * @returns Validated {@link OAuthTokens}.
 * @throws {@link OAuthError} With `LOGIN_FAILED` when the value is malformed.
 */
export function readOAuthTokens(value: unknown): OAuthTokens {
    if (
        !object(value) ||
        typeof value.accessToken !== 'string' ||
        !value.accessToken ||
        typeof value.expiresAt !== 'number' ||
        !Number.isFinite(value.expiresAt) ||
        (value.refreshToken !== undefined && typeof value.refreshToken !== 'string') ||
        (value.idToken !== undefined && typeof value.idToken !== 'string')
    ) {
        throw new OAuthError('LOGIN_FAILED');
    }

    return {
        accessToken: value.accessToken,
        expiresAt: value.expiresAt,
        ...(value.refreshToken ? { refreshToken: value.refreshToken } : {}),
        ...(value.idToken ? { idToken: value.idToken } : {}),
    };
}

function tokens(result: oauth.TokenEndpointResponse, previous?: OAuthTokens): OAuthTokens {
    if (typeof result.expires_in !== 'number' || result.expires_in <= 0) {
        throw new OAuthError('LOGIN_FAILED');
    }

    return {
        accessToken: result.access_token,
        expiresAt: Date.now() + result.expires_in * 1000,
        refreshToken: result.refresh_token ?? previous?.refreshToken,
        idToken: result.id_token ?? previous?.idToken,
    };
}

function redirectUrl(value: string) {
    const url = new URL(value);

    if (['javascript:', 'data:', 'file:'].includes(url.protocol) || url.username || url.password || url.hash) {
        throw new OAuthError('INVALID_TRANSACTION');
    }

    return url;
}

/**
 * Creates a runtime-neutral OAuth/OIDC client for a public client using PKCE.
 *
 * Hosts own navigation and secure persistence. The runtime must provide Web
 * Crypto, Fetch, URL, and AbortSignal APIs. Authorization-server metadata is
 * discovered on demand and reused by subsequent operations.
 *
 * @param config - OAuth issuer, client, scope, and transport configuration.
 * @returns Operations for login, token refresh, and logout URL creation.
 */
export function createOAuthClient(config: OAuthConfig) {
    const issuer = new URL(config.issuer);

    if (
        issuer.protocol !== 'https:' ||
        issuer.username ||
        issuer.password ||
        issuer.search ||
        issuer.hash ||
        !config.clientId
    ) {
        throw new OAuthError('LOGIN_FAILED');
    }

    const client: oauth.Client = { client_id: config.clientId, id_token_signed_response_alg: 'RS256' };
    const requestOptions = () => ({ [oauth.customFetch]: config.fetcher, signal: AbortSignal.timeout(10000) });
    let metadata: oauth.AuthorizationServer | undefined;
    async function discover() {
        metadata ??= await oauth.processDiscoveryResponse(
            issuer,
            await oauth.discoveryRequest(issuer, requestOptions()),
        );

        return metadata;
    }

    return {
        /**
         * Creates an authorization URL and the PKCE transaction needed to complete login.
         *
         * Each call creates new state, nonce, and verifier values. The host must persist
         * the transaction and navigate the user to the authorization URL.
         *
         * @param input - Redirect URI and optional additional authorization parameters.
         * @throws {@link OAuthError} With `LOGIN_FAILED` if login cannot be started.
         */
        async createLogin(input: { redirectUri: string; parameters?: Record<string, string> }) {
            try {
                const authorizationServer = await discover();

                if (!authorizationServer.authorization_endpoint) {
                    throw new OAuthError('LOGIN_FAILED');
                }

                const transaction: LoginTransaction = {
                    state: oauth.generateRandomState(),
                    nonce: oauth.generateRandomNonce(),
                    codeVerifier: oauth.generateRandomCodeVerifier(),
                    redirectUri: redirectUrl(input.redirectUri).href,
                    issuer: issuer.href,
                    clientId: config.clientId,
                    expiresAt: Date.now() + 600000,
                };
                const authorizationUrl = new URL(authorizationServer.authorization_endpoint);

                if (authorizationUrl.protocol !== 'https:') {
                    throw new OAuthError('LOGIN_FAILED');
                }

                authorizationUrl.search = new URLSearchParams({
                    ...input.parameters,
                    ...(config.audience ? { audience: config.audience } : {}),
                    client_id: config.clientId,
                    redirect_uri: transaction.redirectUri,
                    response_type: 'code',
                    scope: config.scope ?? 'openid profile email offline_access',
                    state: transaction.state,
                    nonce: transaction.nonce,
                    code_challenge: await oauth.calculatePKCECodeChallenge(transaction.codeVerifier),
                    code_challenge_method: 'S256',
                }).toString();

                return { authorizationUrl: authorizationUrl.href, transaction };
            } catch {
                throw new OAuthError('LOGIN_FAILED');
            }
        },
        /**
         * Validates an authorization callback and exchanges its code for tokens.
         *
         * The saved transaction must be unexpired and match the configured issuer,
         * client, redirect location, state, and nonce.
         *
         * @param callbackUrl - Full URL received from the authorization redirect.
         * @param savedTransaction - Transaction returned by `createLogin` for this attempt.
         * @returns Tokens for the authenticated session.
         * @throws {@link OAuthError} With `INVALID_TRANSACTION` if validation or exchange fails.
         */
        async completeLogin(callbackUrl: string, savedTransaction: LoginTransaction): Promise<OAuthTokens> {
            try {
                const transaction = readLoginTransaction(savedTransaction);
                const callback = new URL(callbackUrl);
                const expected = redirectUrl(transaction.redirectUri);

                if (
                    transaction.expiresAt <= Date.now() ||
                    transaction.issuer !== issuer.href ||
                    transaction.clientId !== config.clientId ||
                    callback.protocol !== expected.protocol ||
                    callback.host !== expected.host ||
                    callback.pathname !== expected.pathname
                ) {
                    throw new OAuthError('INVALID_TRANSACTION');
                }

                const authorizationServer = await discover();
                const authorizationParameters = oauth.validateAuthResponse(
                    authorizationServer,
                    client,
                    callback,
                    transaction.state,
                );
                const response = await oauth.authorizationCodeGrantRequest(
                    authorizationServer,
                    client,
                    oauth.None(),
                    authorizationParameters,
                    transaction.redirectUri,
                    transaction.codeVerifier,
                    requestOptions(),
                );
                const result = await oauth.processAuthorizationCodeResponse(authorizationServer, client, response, {
                    expectedNonce: transaction.nonce,
                    requireIdToken: true,
                });
                await oauth.validateApplicationLevelSignature(authorizationServer, response, requestOptions());

                return tokens(result);
            } catch {
                throw new OAuthError('INVALID_TRANSACTION');
            }
        },
        /**
         * Refreshes an authenticated session using its refresh token.
         *
         * Existing refresh and ID tokens are retained when the provider does not rotate them.
         *
         * @param previous - Current tokens, including a refresh token.
         * @returns Refreshed tokens with a newly calculated expiration time.
         * @throws {@link OAuthError} With `REFRESH_FAILED` if refresh cannot be completed.
         */
        async refresh(previous: OAuthTokens): Promise<OAuthTokens> {
            try {
                if (!previous.refreshToken) {
                    throw new OAuthError('REFRESH_FAILED');
                }

                const authorizationServer = await discover();
                const response = await oauth.refreshTokenGrantRequest(
                    authorizationServer,
                    client,
                    oauth.None(),
                    previous.refreshToken,
                    requestOptions(),
                );
                const result = await oauth.processRefreshTokenResponse(authorizationServer, client, response);

                if (result.id_token) {
                    await oauth.validateApplicationLevelSignature(authorizationServer, response, requestOptions());
                }

                return tokens(result, previous);
            } catch {
                throw new OAuthError('REFRESH_FAILED');
            }
        },
        /**
         * Creates a provider logout URL for an authenticated session.
         *
         * Returns the normalized `returnTo` URL when the provider does not advertise
         * a logout endpoint. The host is responsible for navigation.
         *
         * @param input - Post-logout destination and optional ID-token hint.
         * @returns The provider logout URL or the normalized post-logout destination.
         */
        async createLogoutUrl(input: { returnTo: string; idToken?: string }) {
            const returnTo = redirectUrl(input.returnTo).href;

            try {
                const authorizationServer = await discover();

                if (typeof authorizationServer.end_session_endpoint !== 'string') {
                    return returnTo;
                }

                const logoutUrl = new URL(authorizationServer.end_session_endpoint);

                if (logoutUrl.protocol !== 'https:') {
                    throw new OAuthError('LOGIN_FAILED');
                }

                logoutUrl.search = new URLSearchParams({
                    client_id: config.clientId,
                    post_logout_redirect_uri: returnTo,
                    ...(input.idToken ? { id_token_hint: input.idToken } : {}),
                }).toString();

                return logoutUrl.href;
            } catch {
                throw new OAuthError('LOGIN_FAILED');
            }
        },
    };
}
