import * as oauth from 'oauth4webapi';

export interface OAuthConfig {
  issuer: string;
  clientId: string;
  audience?: string;
  scope?: string;
  fetcher?: typeof fetch;
}
export interface LoginTransaction {
  state: string;
  nonce: string;
  codeVerifier: string;
  redirectUri: string;
  issuer: string;
  clientId: string;
  expiresAt: number;
}
export interface OAuthTokens {
  accessToken: string;
  refreshToken?: string;
  idToken?: string;
  expiresAt: number;
}
export class OAuthError extends Error {
  constructor(public code: 'LOGIN_FAILED' | 'INVALID_TRANSACTION' | 'REFRESH_FAILED') { super(code); }
}
function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
export function readLoginTransaction(value: unknown): LoginTransaction {
  if (!object(value) || typeof value.state !== 'string' || typeof value.nonce !== 'string' || typeof value.codeVerifier !== 'string' ||
    typeof value.redirectUri !== 'string' || typeof value.issuer !== 'string' || typeof value.clientId !== 'string' || typeof value.expiresAt !== 'number') {
    throw new OAuthError('INVALID_TRANSACTION');
  }
  return { state: value.state, nonce: value.nonce, codeVerifier: value.codeVerifier, redirectUri: value.redirectUri,
    issuer: value.issuer, clientId: value.clientId, expiresAt: value.expiresAt };
}
export function readOAuthTokens(value: unknown): OAuthTokens {
  if (!object(value) || typeof value.accessToken !== 'string' || !value.accessToken || typeof value.expiresAt !== 'number' ||
    !Number.isFinite(value.expiresAt) || (value.refreshToken !== undefined && typeof value.refreshToken !== 'string') ||
    (value.idToken !== undefined && typeof value.idToken !== 'string')) { throw new OAuthError('LOGIN_FAILED'); }
  return { accessToken: value.accessToken, expiresAt: value.expiresAt,
    ...(value.refreshToken ? { refreshToken: value.refreshToken } : {}), ...(value.idToken ? { idToken: value.idToken } : {}) };
}
function tokens(result: oauth.TokenEndpointResponse, previous?: OAuthTokens): OAuthTokens {
  if (typeof result.expires_in !== 'number' || result.expires_in <= 0) { throw new OAuthError('LOGIN_FAILED'); }
  return { accessToken: result.access_token, expiresAt: Date.now() + result.expires_in * 1000,
    refreshToken: result.refresh_token ?? previous?.refreshToken, idToken: result.id_token ?? previous?.idToken };
}
function redirectUrl(value: string) {
  const url = new URL(value);
  if (['javascript:', 'data:', 'file:'].includes(url.protocol) || url.username || url.password || url.hash) {
    throw new OAuthError('INVALID_TRANSACTION');
  }
  return url;
}

/** Runtime-neutral OAuth/OIDC. Hosts own navigation and secure persistence; Web Crypto is required. */
export function createOAuthClient(config: OAuthConfig) {
  const issuer = new URL(config.issuer);
  if (issuer.protocol !== 'https:' || issuer.username || issuer.password || issuer.search || issuer.hash || !config.clientId) {
    throw new OAuthError('LOGIN_FAILED');
  }
  const client: oauth.Client = { client_id: config.clientId, id_token_signed_response_alg: 'RS256' };
  const requestOptions = () => ({ [oauth.customFetch]: config.fetcher, signal: AbortSignal.timeout(10000) });
  let metadata: oauth.AuthorizationServer | undefined;
  async function discover() {
    metadata ??= await oauth.processDiscoveryResponse(issuer, await oauth.discoveryRequest(issuer, requestOptions()));
    return metadata;
  }
  return {
    async createLogin(input: { redirectUri: string; parameters?: Record<string, string> }) {
      try {
        const as = await discover();
        if (!as.authorization_endpoint) { throw new OAuthError('LOGIN_FAILED'); }
        const transaction: LoginTransaction = { state: oauth.generateRandomState(), nonce: oauth.generateRandomNonce(),
          codeVerifier: oauth.generateRandomCodeVerifier(), redirectUri: redirectUrl(input.redirectUri).href,
          issuer: issuer.href, clientId: config.clientId, expiresAt: Date.now() + 600000 };
        const url = new URL(as.authorization_endpoint);
        if (url.protocol !== 'https:') { throw new OAuthError('LOGIN_FAILED'); }
        url.search = new URLSearchParams({ ...input.parameters, ...(config.audience ? { audience: config.audience } : {}),
          client_id: config.clientId, redirect_uri: transaction.redirectUri, response_type: 'code',
          scope: config.scope ?? 'openid profile email offline_access', state: transaction.state, nonce: transaction.nonce,
          code_challenge: await oauth.calculatePKCECodeChallenge(transaction.codeVerifier), code_challenge_method: 'S256' }).toString();
        return { authorizationUrl: url.href, transaction };
      } catch { throw new OAuthError('LOGIN_FAILED'); }
    },
    async completeLogin(callbackUrl: string, savedTransaction: LoginTransaction): Promise<OAuthTokens> {
      try {
        const transaction = readLoginTransaction(savedTransaction);
        const callback = new URL(callbackUrl);
        const expected = redirectUrl(transaction.redirectUri);
        if (transaction.expiresAt <= Date.now() || transaction.issuer !== issuer.href || transaction.clientId !== config.clientId ||
          callback.protocol !== expected.protocol || callback.host !== expected.host || callback.pathname !== expected.pathname) {
          throw new OAuthError('INVALID_TRANSACTION');
        }
        const as = await discover();
        const params = oauth.validateAuthResponse(as, client, callback, transaction.state);
        const response = await oauth.authorizationCodeGrantRequest(as, client, oauth.None(), params, transaction.redirectUri, transaction.codeVerifier, requestOptions());
        const result = await oauth.processAuthorizationCodeResponse(as, client, response, { expectedNonce: transaction.nonce, requireIdToken: true });
        await oauth.validateApplicationLevelSignature(as, response, requestOptions());
        return tokens(result);
      } catch { throw new OAuthError('INVALID_TRANSACTION'); }
    },
    async refresh(previous: OAuthTokens): Promise<OAuthTokens> {
      try {
        if (!previous.refreshToken) { throw new OAuthError('REFRESH_FAILED'); }
        const as = await discover();
        const response = await oauth.refreshTokenGrantRequest(as, client, oauth.None(), previous.refreshToken, requestOptions());
        const result = await oauth.processRefreshTokenResponse(as, client, response);
        if (result.id_token) { await oauth.validateApplicationLevelSignature(as, response, requestOptions()); }
        return tokens(result, previous);
      } catch { throw new OAuthError('REFRESH_FAILED'); }
    },
    async createLogoutUrl(input: { returnTo: string; idToken?: string }) {
      const returnTo = redirectUrl(input.returnTo).href;
      try {
        const as = await discover();
        if (typeof as.end_session_endpoint !== 'string') { return returnTo; }
        const url = new URL(as.end_session_endpoint);
        if (url.protocol !== 'https:') { throw new OAuthError('LOGIN_FAILED'); }
        url.search = new URLSearchParams({ client_id: config.clientId, post_logout_redirect_uri: returnTo,
          ...(input.idToken ? { id_token_hint: input.idToken } : {}) }).toString();
        return url.href;
      } catch { throw new OAuthError('LOGIN_FAILED'); }
    },
  };
}
