import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import * as oidc from 'openid-client';

const cookieNames = (header = '') => header.split(';').map((part) => part.trim().split('=')[0]).filter(Boolean);

export async function relyingParty({ scope, issuer, host, clientId, secret, cookieName, allowedUserIds = [] }) {
  if (!['localhost', '127.0.0.1', '127.0.0.2'].includes(new URL(issuer).hostname)) {
    throw new Error('Insecure OIDC is restricted to the loopback rehearsal.');
  }
  const config = await oidc.discovery(new URL(issuer), clientId,
    { token_endpoint_auth_method: 'client_secret_basic' }, oidc.ClientSecretBasic(secret),
    { execute: [oidc.allowInsecureRequests, oidc.enableNonRepudiationChecks] });
  const metadata = config.serverMetadata();
  if (metadata.issuer !== issuer) throw new Error('Discovery returned the wrong issuer.');
  for (const key of ['authorization_endpoint', 'token_endpoint', 'userinfo_endpoint', 'jwks_uri']) {
    if (new URL(metadata[key]).origin !== issuer) throw new Error('Discovery returned a nonlocal endpoint.');
  }
  const transactions = new Map();
  const sessions = new Map();
  const allowed = new Set(allowedUserIds);
  const requests = [];
  const callbacks = [];
  const failures = [];
  let origin;
  function json(response, status, body) {
    response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    response.end(JSON.stringify(body));
  }
  function redirect(response, path, cookie) {
    response.writeHead(302, { Location: path, ...(cookie ? { 'Set-Cookie': cookie } : {}) });
    response.end();
  }
  async function begin(overrides = {}, mode = 'exchange') {
    const verifier = oidc.randomPKCECodeVerifier();
    const state = oidc.randomState();
    const nonce = oidc.randomNonce();
    const transaction = { verifier, state, nonce, mode, createdAt: Date.now() };
    transactions.set(state, transaction);
    const parameters = {
      redirect_uri: `${origin}/callback`, scope: 'openid profile email wts.profile',
      state, nonce, code_challenge: await oidc.calculatePKCECodeChallenge(verifier), code_challenge_method: 'S256',
      ...overrides,
    };
    for (const [key, value] of Object.entries(parameters)) if (value === undefined) delete parameters[key];
    return { url: oidc.buildAuthorizationUrl(config, parameters), transaction };
  }
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url, origin);
      const names = cookieNames(request.headers.cookie);
      requests.push({ path: url.pathname, host: request.headers.host, cookieNames: names });
      const sessionId = request.headers.cookie?.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1);
      const candidate = sessions.get(sessionId);
      const session = candidate?.expiresAt > Date.now() ? candidate : undefined;
      if (url.pathname === '/') return json(response, 200, { public: true, application: clientId });
      if (url.pathname === '/login') {
        const { url: authorization } = await begin({}, url.searchParams.get('mode') ?? 'exchange');
        return redirect(response, authorization.href);
      }
      if (url.pathname === '/callback') {
        const transaction = transactions.get(url.searchParams.get('state'));
        if (!transaction || Date.now() - transaction.createdAt > 300_000) return json(response, 400, { error: 'Invalid authorization state.' });
        transactions.delete(transaction.state);
        callbacks.push({ url, transaction });
        if (transaction.mode === 'capture') return json(response, 200, { captured: true });
        const checks = {
          pkceCodeVerifier: transaction.verifier,
          expectedState: transaction.mode === 'wrong-state' ? oidc.randomState() : transaction.state,
          expectedNonce: transaction.mode === 'wrong-nonce' ? oidc.randomNonce() : transaction.nonce,
          idTokenExpected: true,
        };
        const tokens = await oidc.authorizationCodeGrant(config, url, checks);
        const claims = tokens.claims();
        const userinfo = await oidc.fetchUserInfo(config, tokens.access_token, claims.sub);
        const id = randomBytes(32).toString('base64url');
        sessions.set(id, { claims, userinfo, tokens, expiresAt: Date.now() + 900_000 });
        return redirect(response, '/session', `${cookieName}=${id}; Path=/; HttpOnly; SameSite=Lax; Max-Age=900`);
      }
      if (url.pathname === '/session') {
        if (!session) return json(response, 401, { error: 'Sign in to this application.' });
        return json(response, 200, { subject: session.claims.sub, wtsUserId: session.userinfo['https://wts.sh/user_id'], profile: session.userinfo['https://wts.sh/profile'], issuer: session.claims.iss, audience: session.claims.aud, nonceVerified: true, signatureVerified: true, stateVerified: true });
      }
      if (url.pathname === '/permission') {
        if (!session) return json(response, 401, { error: 'Sign in to this application.' });
        if (!allowed.has(session.userinfo['https://wts.sh/user_id'])) return json(response, 403, { error: 'This application did not grant permission.' });
        return json(response, 200, { permission: 'allowed' });
      }
      if (url.pathname === '/logout') {
        sessions.delete(sessionId);
        return redirect(response, '/', `${cookieName}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
      }
      return json(response, 404, { error: 'The application page does not exist.' });
    } catch (error) {
      failures.push({ code: typeof error.code === 'string' ? error.code : 'OIDC_REJECTED', name: error.name });
      json(response, 400, { error: 'The application rejected the identity response.' });
    }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, host, resolve);
  });
  origin = `http://${host}:${server.address().port}`;
  scope.own(() => new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
    server.closeAllConnections();
  }));
  return {
    origin, config, metadata, clientId, secret, cookieName, requests, callbacks, failures, begin,
    latestSession: () => [...sessions.values()].at(-1),
    async token(callback, verifier = callback.transaction.verifier) {
      const response = await fetch(metadata.token_endpoint, {
        method: 'POST', headers: {
          Authorization: `Basic ${Buffer.from(`${encodeURIComponent(clientId)}:${encodeURIComponent(secret)}`).toString('base64')}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({ grant_type: 'authorization_code', code: callback.url.searchParams.get('code'), redirect_uri: `${origin}/callback`, code_verifier: verifier }),
      });
      return { status: response.status, body: await response.json() };
    },
  };
}
