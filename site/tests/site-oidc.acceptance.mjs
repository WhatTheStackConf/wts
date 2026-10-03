import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHash, createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { createRequire } from 'node:module';
import { command, resources, postgres, smtp, service, freePort, until } from '../../auth/acceptance/resources.mjs';
import { snapshot, importedId, importedEmail, importedPassword } from '../../auth/acceptance/fixtures.mjs';
import { openSiteDatabase } from '../src/server/storage.ts';
import { requireAccount, requireEditionRole, readAccount } from '../src/server/site-sessions.ts';
import { GET as login } from '../src/routes/auth/login.ts';
import { GET as callback } from '../src/routes/auth/callback.ts';
import { POST as logout, GET as logoutGet } from '../src/routes/auth/logout.ts';
import { GET as legacyLogin } from '../src/routes/login.ts';
import { GET as register } from '../src/routes/register.ts';
import { GET as recovery } from '../src/routes/forgot-password.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const authRoot = join(root, 'auth');
const requireAuthPackage = createRequire(join(authRoot, 'package.json'));
const { chromium } = requireAuthPackage('playwright');
const { Pool } = requireAuthPackage('pg');
const scope = await resources(authRoot);
const savedEnvironment = { ...process.env };
const results = [];
const hash = (value) => createHash('sha256').update(value).digest('base64url');
let origin;
let env;
let browser;
let authService;
let currentCheck = 'Initialize the real local auth service and site database';

async function check(name, run) {
  currentCheck = name;
  await run();
  results.push(name);
  console.log(`PASS ${name}`);
}

async function authCli(args) {
  return command(process.execPath, ['dist/cli.js', ...args], { cwd: authRoot, env });
}

async function siteCli(args) {
  return command(process.execPath, ['--experimental-strip-types', 'site/scripts/site-data.ts', ...args], { cwd: root, env: process.env });
}

function withDatabase(run) {
  const db = openSiteDatabase();
  try { return run(db); } finally { db.close(); }
}

async function captureAuthorization(context, { modify, entry = '/auth/login?returnTo=/user/profile' } = {}) {
  const start = await context.request.get(`${origin}${entry}`, { maxRedirects: 0 });
  assert.equal(start.status(), 303);
  const authorization = new URL(start.headers().location);
  if (modify) modify(authorization);
  let captured;
  const page = await context.newPage();
  await page.route(`${origin}/auth/callback?*`, async (route) => {
    captured = route.request().url();
    await route.fulfill({ status: 200, contentType: 'text/plain', body: 'The real authorization callback reached the local consumer.' });
  });
  await page.route((url) => url.origin === authorization.origin && url.pathname === authorization.pathname, async (route) => {
    const result = await route.fetch({ maxRedirects: 0 });
    const location = result.headers().location;
    const target = location ? new URL(location, authorization) : null;
    if (target?.origin === origin && target.pathname === "/auth/callback") {
      captured = target.href;
      await route.fulfill({ status: 200, contentType: "text/plain", body: "The real SSO response supplied an authorization callback." });
    } else {
      await route.fulfill({ response: result });
    }
  });
  try {
    await page.goto(authorization.href);
    let submitted = false;
    let consentSubmitted = false;
    await until(async () => {
      if (captured) return true;
      const signIn = page.locator('form[data-account-action="sign-in"]');
      if (!submitted && await signIn.isVisible()) {
        await signIn.locator('[name="email"]').fill(importedEmail);
        await signIn.locator('[name="password"]').fill(importedPassword);
        await signIn.getByRole('button', { name: 'Sign in', exact: true }).click();
        submitted = true;
      }
      const consent = page.locator('form[data-account-action="consent"]');
      if (!consentSubmitted && await consent.isVisible()) {
        await consent.getByRole('button', { name: 'Allow access', exact: true }).click();
        consentSubmitted = true;
      }
      return false;
    }, 'The real auth browser must return an authorization code.', 45_000);
    return { callback: captured, authorization };
  } finally { await page.close(); }
}

async function signIn(context) {
  const captured = await captureAuthorization(context);
  const accepted = await context.request.get(captured.callback, { maxRedirects: 0 });
  assert.equal(accepted.status(), 303);
  assert.equal(accepted.headers().location, '/user/profile');
  return captured;
}

function alterFlow(state, change) {
  withDatabase((db) => {
    const row = db.prepare('SELECT * FROM oidc_flows WHERE state_hash = ?').get(hash(state));
    const [version, iv, tag, ciphertext] = row.encrypted_flow.split('.');
    assert.equal(version, '1');
    const aad = `flow:${row.state_hash}:${row.browser_binding_hash}`;
    const decipher = createDecipheriv('aes-256-gcm', Buffer.from(process.env.SITE_SESSION_KEY, 'base64url'), Buffer.from(iv, 'base64url'));
    decipher.setAAD(Buffer.from(aad));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    const flow = JSON.parse(Buffer.concat([decipher.update(Buffer.from(ciphertext, 'base64url')), decipher.final()]).toString('utf8'));
    change(flow);
    const nextIv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', Buffer.from(process.env.SITE_SESSION_KEY, 'base64url'), nextIv);
    cipher.setAAD(Buffer.from(aad));
    const bytes = Buffer.concat([cipher.update(JSON.stringify(flow)), cipher.final()]);
    const encrypted = ['1', nextIv.toString('base64url'), cipher.getAuthTag().toString('base64url'), bytes.toString('base64url')].join('.');
    db.prepare('UPDATE oidc_flows SET encrypted_flow = ? WHERE state_hash = ?').run(encrypted, row.state_hash);
  });
}

try {
  const pg = await postgres(scope);
  const mail = await smtp(scope);
  const authPort = await freePort();
  const sitePort = await freePort('127.0.0.2');
  origin = `http://127.0.0.2:${sitePort}`;
  env = {
    PATH: process.env.PATH, HOME: process.env.HOME,
    NODE_ENV: 'test', HOST: '127.0.0.1', PORT: String(authPort),
    AUTH_PUBLIC_URL: `http://localhost:${authPort}`, DATABASE_URL: pg.databaseUrl,
    BETTER_AUTH_SECRET: randomBytes(48).toString('base64url'), AUTH_REGISTRATION: 'closed',
    SMTP_HOST: '127.0.0.1', SMTP_PORT: String(mail.port), SMTP_SECURE: 'false',
    SMTP_FROM: 'Synthetic Auth <auth@acceptance.localhost>',
  };
  const imported = await scope.privateFile('synthetic-identities.json', JSON.stringify(await snapshot()));
  await authCli(['migrate']);
  await authCli(['import', '--snapshot', imported]);
  const centralPool = new Pool({ connectionString: pg.databaseUrl, max: 1 });
  scope.own(() => centralPool.end());
  const runtimePassword = randomBytes(36).toString('base64url');
  await command(process.execPath, ['scripts/provision-runtime.mjs'], {
    cwd: authRoot, env: { ...env, AUTH_DATABASE_RUNTIME_PASSWORD: runtimePassword },
  });
  const clientId = `${scope.runId}-site`;
  const clientSecret = randomBytes(36).toString('base64url');
  const manifest = await scope.privateFile('site-client.json', JSON.stringify({
    version: 1, clientId, name: 'Synthetic WTS 2027 consumer',
    redirectUris: [`${origin}/auth/callback`], scopes: ['openid', 'profile', 'email', 'wts.profile'],
  }));
  const secretFile = await scope.privateFile('site-client-secret', `${clientSecret}\n`);
  await authCli(['client', '--manifest', manifest, '--secret-file', secretFile]);
  const database = new URL(env.DATABASE_URL);
  database.username = 'wts_auth_runtime';
  database.password = runtimePassword;
  authService = service(scope, authRoot, { ...env, DATABASE_URL: database.href });
  await authService.ready();
  Object.assign(process.env, {
    NODE_ENV: 'test', SITE_DATA_DIR: join(scope.privateDir, 'site'), SITE_ORIGIN: origin,
    OIDC_ISSUER: env.AUTH_PUBLIC_URL, OIDC_CLIENT_ID: clientId, OIDC_CLIENT_SECRET: clientSecret,
    SITE_SESSION_KEY: randomBytes(32).toString('base64url'), SITE_EDITION_ID: '2027',
  });
  await siteCli(['init', '2027', 'synthetic-site-acceptance']);
  const server = createServer(async (incoming, outgoing) => {
    try {
      const headers = new Headers();
      for (const [key, value] of Object.entries(incoming.headers)) {
        if (Array.isArray(value)) for (const item of value) headers.append(key, item);
        else if (value !== undefined) headers.set(key, value);
      }
      const request = new Request(new URL(incoming.url, origin), { method: incoming.method, headers });
      const pathname = new URL(request.url).pathname;
      let result;
      if (pathname === '/') result = Response.json({ public: true });
      else if (pathname === '/auth/login') result = await login({ request });
      else if (pathname === '/auth/callback') result = await callback({ request });
      else if (pathname === '/auth/logout') result = await (request.method === 'GET' ? logoutGet : logout)({ request });
      else if (pathname === '/login') result = await legacyLogin({ request });
      else if (pathname === '/register') result = register({ request });
      else if (pathname === '/forgot-password') result = recovery({ request });
      else if (pathname === '/user' || pathname === '/user/profile') result = Response.json(await requireAccount(request));
      else if (pathname === '/permission-proof') result = Response.json(await requireEditionRole(request, '2027', 'admin'));
      else if (pathname === '/other-permission-proof') result = Response.json(await requireEditionRole(request, '2028', 'admin'));
      else result = new Response('The local proof route does not exist.', { status: 404 });
      const cookies = result.headers.getSetCookie();
      if (cookies.length) outgoing.setHeader('Set-Cookie', cookies);
      outgoing.writeHead(result.status, Object.fromEntries([...result.headers].filter(([key]) => key !== 'set-cookie')));
      outgoing.end(Buffer.from(await result.arrayBuffer()));
    } catch (error) {
      if (error instanceof Response) {
        outgoing.writeHead(error.status, Object.fromEntries(error.headers));
        outgoing.end(await error.text());
      } else {
        outgoing.writeHead(500, { 'Content-Type': 'text/plain' });
        outgoing.end('The local consumer could not complete the request.');
      }
    }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(sitePort, '127.0.0.2', resolve);
  });
  scope.own(() => new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
    server.closeAllConnections();
  }));
  browser = await chromium.launch({ headless: true });
  scope.own(() => browser.close());
  const context = await browser.newContext({ serviceWorkers: 'block' });

  await check('HTTPS cookies use host-only security attributes and unsafe configuration is rejected', async () => {
    const originalOrigin = process.env.SITE_ORIGIN;
    const originalMode = process.env.NODE_ENV;
    const originalKey = process.env.SITE_SESSION_KEY;
    try {
      process.env.SITE_ORIGIN = 'https://site.acceptance.localhost';
      const secureLogin = await login({ request: new Request('https://site.acceptance.localhost/auth/login') });
      assert.equal(secureLogin.status, 303);
      const setCookie = secureLogin.headers.get('set-cookie');
      assert.match(setCookie, /^__Host-wts-site-flow=/);
      assert.match(setCookie, /; Secure$/);
      assert.match(setCookie, /; HttpOnly;/);
      assert.match(setCookie, /; SameSite=Lax;/);
      assert.equal(setCookie.includes('; Path=/;'), true);
      assert.equal(setCookie.includes('Domain='), false);
      process.env.SITE_ORIGIN = 'http://site.acceptance.localhost';
      await assert.rejects(() => login({ request: new Request('http://site.acceptance.localhost/auth/login') }), /requires HTTPS/);
      process.env.SITE_ORIGIN = origin;
      process.env.NODE_ENV = 'production';
      await assert.rejects(() => login({ request: new Request(`${origin}/auth/login`) }), /requires HTTPS/);
      process.env.NODE_ENV = originalMode;
      process.env.SITE_SESSION_KEY = 'short';
      await assert.rejects(() => login({ request: new Request(`${origin}/auth/login`) }), /SITE_SESSION_KEY/);
    } finally {
      process.env.SITE_ORIGIN = originalOrigin;
      process.env.NODE_ENV = originalMode;
      process.env.SITE_SESSION_KEY = originalKey;
    }
  });
  const stranger = await browser.newContext({ serviceWorkers: 'block' });

  await check('Anonymous content and account access have separate requirements', async () => {
    assert.deepEqual(await (await context.request.get(origin)).json(), { public: true });
    assert.equal((await context.request.get(`${origin}/user`)).status(), 401);
    assert.equal(await readAccount(new Request(`${origin}/user`)), null);
    assert.equal((await context.request.get(`${origin}/register?token=legacy-reset` , { maxRedirects: 0 })).headers().location, `${env.AUTH_PUBLIC_URL}/sign-up`);
    assert.equal((await context.request.get(`${origin}/forgot-password?token=legacy-reset`, { maxRedirects: 0 })).headers().location, `${env.AUTH_PUBLIC_URL}/recovery`);
  });

  let captured;
  await check('The real browser receives a browser-bound, single-use local account session', async () => {
    captured = await captureAuthorization(context);
    const state = captured.authorization.searchParams.get('state');
    const pending = withDatabase((db) => db.prepare('SELECT * FROM oidc_flows WHERE state_hash = ?').get(hash(state)));
    assert.equal(pending.state_hash, hash(state));
    assert.equal(pending.encrypted_flow.includes(captured.authorization.searchParams.get('nonce')), false);
    assert.equal((await stranger.request.get(captured.callback, { maxRedirects: 0 })).status(), 400);
    const flowCookie = (await context.cookies(origin)).find((cookie) => cookie.name === 'wts-site-flow');
    await stranger.addCookies([{ name: flowCookie.name, value: randomBytes(32).toString('base64url'), url: origin }]);
    assert.equal((await stranger.request.get(captured.callback, { maxRedirects: 0 })).status(), 400);
    const wrongCallback = new Request(captured.callback.replace('/auth/callback?', '/wrong-callback?'), {
      headers: { Cookie: `${flowCookie.name}=${flowCookie.value}` },
    });
    assert.equal((await callback({ request: wrongCallback })).status, 400);
    assert.equal((await context.request.get(captured.callback.replace('/auth/callback?', '/wrong-callback?'), { maxRedirects: 0 })).status(), 404);
    const alteredState = new URL(captured.callback);
    alteredState.searchParams.set('state', randomBytes(32).toString('base64url'));
    assert.equal((await context.request.get(alteredState.href, { maxRedirects: 0 })).status(), 400);
    const accepted = await context.request.get(captured.callback, { maxRedirects: 0 });
    assert.equal(accepted.status(), 303);
    assert.equal(accepted.headers().location, '/user/profile');
    const localCookie = (await context.cookies(origin)).find((cookie) => cookie.name === 'wts-site-session');
    assert.equal(localCookie.httpOnly, true);
    assert.equal(localCookie.sameSite, 'Lax');
    assert.equal(localCookie.path, '/');
    const session = withDatabase((db) => db.prepare('SELECT * FROM site_sessions WHERE session_hash = ?').get(hash(localCookie.value)));
    assert.equal(session.session_hash, hash(localCookie.value));
    assert.notEqual(session.encrypted_access_token, localCookie.value);
    assert.equal(session.expires_at <= session.created_at + 300_000, true);
    assert.equal(localCookie.expires * 1000 <= session.expires_at, true);
    assert.equal((await context.request.get(captured.callback, { maxRedirects: 0 })).status(), 400);
    const account = await (await context.request.get(`${origin}/user`)).json();
    assert.deepEqual(account, {
      wtsUserId: importedId, profile: { version: 1, wtsUserId: importedId, name: `Synthetic ${importedId}`, avatarUrl: null,
        preferredLanguage: 'en', username: importedId, emailVisibility: false, revision: 1 },
      editionId: '2027', isAdmin: false, accountUrl: `${env.AUTH_PUBLIC_URL}/account`,
    });
    assert.equal((await context.request.get(`${origin}/permission-proof`)).status(), 403);
    assert.equal((await context.request.get(`${origin}/user`, {
      headers: { Cookie: `wts-site-session=${localCookie.value}; wts-site-session=${randomBytes(32).toString('base64url')}` },
    })).status(), 401);
    const current = withDatabase((db) => db.prepare('SELECT expires_at FROM site_sessions WHERE session_hash = ?').get(hash(localCookie.value)));
    assert.equal(current.expires_at, session.expires_at);
  });

  await check('A trusted HTTPS proxy preserves the secure session and exact account origin', async () => {
    const localCookie = (await context.cookies(origin)).find((cookie) => cookie.name === 'wts-site-session');
    const previousOrigin = process.env.SITE_ORIGIN;
    const previousTrust = process.env.SITE_TRUST_PROXY;
    process.env.SITE_ORIGIN = origin.replace('http:', 'https:');
    process.env.SITE_TRUST_PROXY = 'true';
    try {
      const headers = { Cookie: `__Host-wts-site-session=${localCookie.value}`, 'X-Forwarded-Proto': 'https' };
      const account = await readAccount(new Request(`${origin}/user`, { headers }));
      assert.equal(account.wtsUserId, importedId);
      assert.equal(account.profile.name, `Synthetic ${importedId}`);
      await assert.rejects(() => readAccount(new Request('http://wrong.acceptance.localhost/user', { headers })),
        (error) => error instanceof Response && error.status === 403);
      process.env.SITE_TRUST_PROXY = 'false';
      await assert.rejects(() => readAccount(new Request(`${origin}/user`, { headers })),
        (error) => error instanceof Response && error.status === 403);
    } finally {
      process.env.SITE_ORIGIN = previousOrigin;
      if (previousTrust === undefined) delete process.env.SITE_TRUST_PROXY;
      else process.env.SITE_TRUST_PROXY = previousTrust;
    }
  });

  await check('Role grants, role removal, and edition scope affect the next request', async () => {
    await siteCli(['role', '2027', importedId, 'enable']);
    const permitted = await context.request.get(`${origin}/permission-proof`);
    assert.equal(permitted.status(), 200);
    assert.equal((await permitted.json()).isAdmin, true);
    assert.equal((await context.request.get(`${origin}/other-permission-proof`)).status(), 403);
    await siteCli(['role', '2027', importedId, 'disable']);
    assert.equal((await context.request.get(`${origin}/permission-proof`)).status(), 403);
    const ordinary = await context.request.get(`${origin}/user`);
    assert.equal(ordinary.status(), 200);
    assert.equal((await ordinary.json()).isAdmin, false);
  });

  await check('Account reads use live central profile claims', async () => {
    const changed = await context.request.patch(`${env.AUTH_PUBLIC_URL}/v1/me`, {
      headers: { Origin: env.AUTH_PUBLIC_URL },
      data: { name: 'Synthetic current profile', avatarUrl: null, preferredLanguage: 'mk', expectedRevision: 1 },
    });
    assert.equal(changed.status(), 200);
    const account = await (await context.request.get(`${origin}/user`)).json();
    assert.equal(account.profile.name, 'Synthetic current profile');
    assert.equal(account.profile.preferredLanguage, 'mk');
    assert.equal(account.profile.revision, 2);
    assert.equal(account.wtsUserId, importedId);
  });

  await check('Malformed live central profiles deny protected access without replacing the local identity', async () => {
    await centralPool.query('UPDATE \"user\" SET \"preferredLanguage\" = $1 WHERE id = $2', ['not_a_language', importedId]);
    try {
      assert.equal((await context.request.get(`${origin}/user`)).status(), 503);
      assert.deepEqual(await (await context.request.get(origin)).json(), { public: true });
    } finally {
      await centralPool.query('UPDATE \"user\" SET \"preferredLanguage\" = $1 WHERE id = $2', ['mk', importedId]);
    }
    const account = await (await context.request.get(`${origin}/user`)).json();
    assert.equal(account.wtsUserId, importedId);
    assert.equal(account.profile.preferredLanguage, 'mk');
  });

  await check('Local logout rejects cross-origin and GET requests but preserves central SSO', async () => {
    assert.equal((await context.request.get(`${origin}/auth/logout`, { maxRedirects: 0 })).status(), 405);
    assert.equal((await context.request.post(`${origin}/auth/logout`, { headers: { Origin: env.AUTH_PUBLIC_URL }, maxRedirects: 0 })).status(), 403);
    assert.equal((await context.request.post(`${origin}/auth/logout`, { maxRedirects: 0 })).status(), 403);
    assert.equal((await context.request.get(`${origin}/user`)).status(), 200);
    assert.equal((await context.request.post(`${origin}/auth/logout`, { headers: { Origin: origin }, maxRedirects: 0 })).status(), 303);
    assert.equal((await context.request.get(`${origin}/user`)).status(), 401);
    assert.equal((await context.request.get(`${env.AUTH_PUBLIC_URL}/v1/me`)).status(), 200);
    await signIn(context);
  });

  await check('Nonce, PKCE, expired state, and authenticated flow bytes fail closed', async () => {
    for (const kind of ['nonce', 'pkce', 'expired', 'ciphertext']) {
      const attempt = await captureAuthorization(context, kind === 'nonce' ? { modify: (url) => url.searchParams.set('nonce', 'wrong-nonce') } : {});
      const state = attempt.authorization.searchParams.get('state');
      if (kind === 'pkce') alterFlow(state, (flow) => { flow.verifier = randomBytes(32).toString('base64url'); });
      if (kind === 'expired') withDatabase((db) => db.prepare('UPDATE oidc_flows SET expires_at = ? WHERE state_hash = ?').run(Date.now() - 1, hash(state)));
      if (kind === 'ciphertext') withDatabase((db) => db.prepare("UPDATE oidc_flows SET encrypted_flow = encrypted_flow || 'x' WHERE state_hash = ?").run(hash(state)));
      assert.equal((await context.request.get(attempt.callback, { maxRedirects: 0 })).status(), 400);
      assert.equal((await context.request.get(`${origin}/user`)).status(), 200);
    }
  });

  await check('An immutable identity binding cannot change during a later login', async () => {
    withDatabase((db) => {
      db.prepare('INSERT INTO site_accounts(wts_user_id,created_at) VALUES (?,?)').run('synthetic-other-local', Date.now());
      db.prepare('UPDATE oidc_bindings SET wts_user_id = ? WHERE issuer = ? AND subject = ?').run('synthetic-other-local', env.AUTH_PUBLIC_URL, importedId);
    });
    const attempt = await captureAuthorization(context);
    assert.equal((await context.request.get(attempt.callback, { maxRedirects: 0 })).status(), 400);
    assert.equal((await context.request.get(`${origin}/user`)).status(), 503);
    withDatabase((db) => db.prepare('UPDATE oidc_bindings SET wts_user_id = ? WHERE issuer = ? AND subject = ?').run(importedId, env.AUTH_PUBLIC_URL, importedId));
    assert.equal((await context.request.get(`${origin}/user`)).status(), 200);
  });

  await check('A fixed local expiry and altered encrypted access token deny protected access', async () => {
    const localCookie = (await context.cookies(origin)).find((cookie) => cookie.name === 'wts-site-session');
    const sessionHash = hash(localCookie.value);
    const encrypted = withDatabase((db) => db.prepare('SELECT encrypted_access_token FROM site_sessions WHERE session_hash = ?').get(sessionHash).encrypted_access_token);
    withDatabase((db) => db.prepare('UPDATE site_sessions SET encrypted_access_token = ? WHERE session_hash = ?').run(`${encrypted}x`, sessionHash));
    assert.equal((await context.request.get(`${origin}/user`)).status(), 503);
    withDatabase((db) => db.prepare('UPDATE site_sessions SET encrypted_access_token = ?, expires_at = ? WHERE session_hash = ?').run(encrypted, Date.now() - 1, sessionHash));
    assert.equal((await context.request.get(`${origin}/user`)).status(), 401);
    await signIn(context);
  });

  await check('Central session revocation denies a still-present local cookie', async () => {
    const ended = await context.request.post(`${env.AUTH_PUBLIC_URL}/api/auth/sign-out`, { headers: { Origin: env.AUTH_PUBLIC_URL }, data: {} });
    assert.equal(ended.status(), 200);
    assert.equal((await context.cookies(origin)).some((cookie) => cookie.name === 'wts-site-session'), true);
    assert.equal((await context.request.get(`${origin}/user`)).status(), 503);
    assert.deepEqual(await (await context.request.get(origin)).json(), { public: true });
    await signIn(context);
  });

  await check('Provider outage denies protected access without blocking anonymous content', async () => {
    assert.equal((await context.request.get(`${origin}/user`)).status(), 200);
    await authService.stop();
    assert.equal((await context.request.get(`${origin}/user`)).status(), 503);
    assert.deepEqual(await (await context.request.get(origin)).json(), { public: true });
    assert.equal(await readAccount(new Request(`${origin}/user`)), null);
  });
  console.log(JSON.stringify({ status: 'PASS', checks: results, limitations: ['Local loopback HTTP only. No production callback, TLS, external provider, or deployment proof.'] }));
} catch (error) {
  process.exitCode = 1;
  console.error(JSON.stringify({ status: 'FAIL', check: currentCheck, completed: results, error: error instanceof assert.AssertionError ? 'A local consumer security assertion failed.' : 'The real local auth acceptance could not complete.' }));
} finally {
  for (const key of Object.keys(process.env)) if (!(key in savedEnvironment)) delete process.env[key];
  Object.assign(process.env, savedEnvironment);
  const failures = await scope.cleanup();
  if (failures.length) {
    process.exitCode = 1;
    console.error('A run-owned acceptance resource did not close.');
  }
}
