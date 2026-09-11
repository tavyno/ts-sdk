import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createOAuthClient } from '../dist/index.js';

const metadata = {
    issuer: 'https://identity.example/',
    authorization_endpoint: 'https://identity.example/authorize',
    token_endpoint: 'https://identity.example/token',
    jwks_uri: 'https://identity.example/jwks',
    end_session_endpoint: 'https://identity.example/logout',
    response_types_supported: ['code'],
    subject_types_supported: ['public'],
    id_token_signing_alg_values_supported: ['RS256'],
};

test('creates provider-neutral PKCE transactions without browser navigation or client secrets', async () => {
    const client = createOAuthClient({
        issuer: metadata.issuer,
        clientId: 'public-client',
        audience: 'api',
        fetcher: async () => Response.json(metadata),
    });
    const first = await client.createLogin({ redirectUri: 'app.example:/callback' });
    assert.match(first.authorizationUrl, /^https:\/\/identity.example\/authorize/);
    const params = new globalThis.URL(first.authorizationUrl).searchParams;
    assert.equal(params.get('client_id'), 'public-client');
    assert.equal(params.get('code_challenge_method'), 'S256');
    assert.equal(params.get('response_type'), 'code');
    assert.equal(params.get('state'), first.transaction.state);
    assert.equal(params.get('nonce'), first.transaction.nonce);
    assert.ok(first.transaction.codeVerifier);
    assert.doesNotMatch(params.get('scope'), /calendar/);
    const second = await client.createLogin({ redirectUri: 'https://web.example/callback' });
    assert.notEqual(first.transaction.state, second.transaction.state);
});

test('exchanges public-client codes, validates ID-token signatures and refreshes tokens without runtime dependencies', async () => {
    const keys = await globalThis.crypto.subtle.generateKey(
        { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
        true,
        ['sign', 'verify'],
    );
    const { Buffer } = await import('node:buffer');
    const publicKey = await globalThis.crypto.subtle.exportKey('jwk', keys.publicKey);
    let transaction;
    let tokenRequests = 0;
    async function idToken(nonce) {
        const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
        const payload = `${encode({ alg: 'RS256', kid: 'key' })}.${encode({ iss: metadata.issuer, aud: 'client', sub: 'subject', nonce, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 300 })}`;
        const signature = await globalThis.crypto.subtle.sign(
            'RSASSA-PKCS1-v1_5',
            keys.privateKey,
            Buffer.from(payload),
        );

        return `${payload}.${Buffer.from(signature).toString('base64url')}`;
    }
    const client = createOAuthClient({
        issuer: metadata.issuer,
        clientId: 'client',
        fetcher: async (input, init) => {
            const url = String(input);
            if (url.includes('openid-configuration')) {
                return Response.json(metadata);
            }

            if (url.endsWith('/jwks')) {
                return Response.json({ keys: [{ ...publicKey, kid: 'key', alg: 'RS256', use: 'sig' }] });
            }

            tokenRequests++;
            assert.equal(url, metadata.token_endpoint);
            const body = new globalThis.URLSearchParams(init.body);
            assert.equal(body.get('client_id'), 'client');
            assert.equal(body.has('client_secret'), false);
            if (body.get('grant_type') === 'refresh_token') {
                assert.equal(body.get('refresh_token'), 'refresh');

                return Response.json({
                    access_token: 'renewed',
                    refresh_token: 'rotated',
                    token_type: 'Bearer',
                    expires_in: 300,
                });
            }

            assert.equal(body.get('code_verifier'), transaction.codeVerifier);

            return Response.json({
                access_token: 'jwt',
                refresh_token: 'refresh',
                token_type: 'Bearer',
                expires_in: 300,
                id_token: await idToken(transaction.nonce),
            });
        },
    });
    ({ transaction } = await client.createLogin({ redirectUri: 'https://web.example/callback' }));
    await assert.rejects(client.completeLogin('https://web.example/callback?code=code&state=wrong', transaction));
    assert.equal(tokenRequests, 0);
    const tokens = await client.completeLogin(
        `https://web.example/callback?code=code&state=${transaction.state}`,
        transaction,
    );
    assert.equal(tokens.accessToken, 'jwt');
    assert.equal(tokens.refreshToken, 'refresh');
    assert.equal((await client.refresh(tokens)).accessToken, 'renewed');
    await assert.rejects(
        client.completeLogin(`https://web.example/callback?code=code&state=${transaction.state}`, {
            ...transaction,
            expiresAt: 0,
        }),
    );
    const logout = new globalThis.URL(
        await client.createLogoutUrl({ returnTo: 'https://web.example/', idToken: tokens.idToken }),
    );
    assert.equal(logout.origin, 'https://identity.example');
    assert.equal(logout.searchParams.get('post_logout_redirect_uri'), 'https://web.example/');
});
