import { randomBytes, createPublicKey, verify } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { writeFile, readFile, mkdir, chmod } from 'node:fs/promises';
import { isDeepStrictEqual } from 'node:util';
import { DatabaseSync } from 'node:sqlite';
import { chromium } from 'playwright';
import * as oidc from 'openid-client';
import { command, resources, postgres, smtp, service, freePort, until, sleep } from './resources.mjs';
import { relyingParty } from './relying-party.mjs';
import {
  snapshot, offlinePocketBase, clientManifest, importedId, importedEmail, importedPassword, resetPassword,
  signupEmail, signupPassword, googleId, githubId, boundaryPassword, legacyLongPassword, unicodeCredentials,
} from './fixtures.mjs';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const scope = await resources(packageRoot);
const results = [];
const limitations = [
  'These are generic synthetic relying parties, not deployed WTS or Open Event Platform integrations.',
  'Synthetic Google and GitHub identity ownership checks do not prove real provider callbacks.',
  'The rehearsal permits HTTP only on loopback. It does not prove production HTTPS, provider settings, or deployment.',
];
const expect = (condition, message) => { if (!condition) throw new Error(message); };
let env;
let browser;
let interrupted = false;

async function check(name, run) {
  const start = Date.now();
  try {
    expect(!interrupted, 'The run received a termination signal.');
    const evidence = await run();
    expect(!interrupted, 'The run received a termination signal.');
    results.push({ name, status: 'PASS', durationMs: Date.now() - start, evidence: evidence ?? {} });
    console.log(`PASS ${name}`);
    return evidence;
  } catch (error) {
    results.push({ name, status: 'FAIL', durationMs: Date.now() - start, error: redact(error.message) });
    console.error(`FAIL ${name}. ${redact(error.message)}`);
    throw error;
  }
}

function redact(message) {
  let value = String(message).replace(/https?:\/\/[^\s"']+/g, '[redacted URL]')
    .replace(/[\w.+-]+@[\w.-]+/g, '[redacted email]')
    .replace(/\b(?:postgres|postgresql):\/\/[^\s]+/g, '[redacted database URL]')
    .replace(/\b[A-Za-z0-9_-]{36,}\b/g, '[redacted value]');
  for (const secret of [importedPassword, resetPassword, signupPassword, env?.BETTER_AUTH_SECRET].filter(Boolean)) value = value.replaceAll(secret, '[redacted secret]');
  return value.slice(0, 500);
}

async function cli(args, allowFailure = false) {
  const result = await command(process.execPath, ['dist/cli.js', ...args], { cwd: packageRoot, env, allowFailure: true });
  if (!allowFailure && result.code !== 0) throw new Error(`Auth CLI ${args[0]} exited with code ${result.code}.`);
  return result;
}

async function api(context, path, { method = 'GET', body } = {}) {
  const response = await context.request.fetch(`${env.AUTH_PUBLIC_URL}${path}`, {
    method, headers: { Origin: env.AUTH_PUBLIC_URL, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { data: body } : {}),
  });
  let data;
  try { data = await response.json(); } catch { data = null; }
  return { status: response.status(), body: data, response };
}

async function newContext() {
  return browser.newContext({ serviceWorkers: 'block' });
}

async function completeAuthorization(page, rp, { credentials, target } = {}) {
  await page.goto(target ?? `${rp.origin}/login`);
  const deadline = Date.now() + 30_000;
  let credentialPrompts = 0;
  let submitted = false;
  let consentSubmitted = false;
  while (Date.now() < deadline) {
    const url = new URL(page.url());
    if (url.origin === rp.origin && ['/session', '/callback'].includes(url.pathname)) {
      const body = JSON.parse(await page.locator('pre').innerText());
      expect(url.pathname === '/callback' ? body.captured === true : typeof body.wtsUserId === 'string', 'The relying party did not accept the OIDC callback.');
      return { credentialPrompts, body };
    }
    const signIn = page.locator('form[data-account-action="sign-in"]');
    if (await signIn.isVisible()) {
      if (!credentials) throw new Error('SSO requested credentials for an existing central session.');
      if (!submitted) {
        credentialPrompts++;
        await signIn.locator('[name="email"]').fill(credentials.email);
        await signIn.locator('[name="password"]').fill(credentials.password);
        await signIn.getByRole('button', { name: 'Sign in', exact: true }).click();
        submitted = true;
      }
      const error = signIn.locator('[data-form-error]');
      if (await error.isVisible() && (await error.textContent())?.trim()) throw new Error('The account page rejected the synthetic credentials.');
    }
    const consent = page.locator('form[data-account-action="consent"]');
    if (await consent.isVisible() && !consentSubmitted) {
      await consent.getByRole('button', { name: 'Allow access', exact: true }).click();
      consentSubmitted = true;
    }
    if (url.pathname === '/error') throw new Error('The real account page reported an authorization error.');
    await sleep(100);
  }
  throw new Error('The real browser did not complete the authorization flow.');
}

async function ownProfile(context) {
  const response = await api(context, '/v1/me');
  expect(response.status === 200 && response.body?.profile, 'The central session could not read its own profile.');
  return response.body.profile;
}

function profileIs(profile, { id = importedId, name, language } = {}) {
  expect(profile.wtsUserId === id, 'The profile changed the literal WTS user ID.');
  if (name !== undefined) expect(profile.name === name, 'The profile did not preserve the expected name.');
  if (language !== undefined) expect(profile.preferredLanguage === language, 'The profile did not preserve the expected language.');
  expect(Number.isSafeInteger(profile.revision) && profile.revision >= 0, 'The profile revision is invalid.');
  expect(!('roles' in profile) && !('role' in profile) && !('permissions' in profile), 'The shared profile contains application permissions.');
}

async function assertFreshSignature(token, rp, issuer) {
  const parts = token.split('.');
  expect(parts.length === 3, 'The ID token is not a signed JWT.');
  const header = JSON.parse(Buffer.from(parts[0], 'base64url'));
  const claims = JSON.parse(Buffer.from(parts[1], 'base64url'));
  const response = await fetch(rp.metadata.jwks_uri);
  expect(response.status === 200, 'The public JWKS endpoint did not respond.');
  const jwks = await response.json();
  const jwk = jwks.keys.find((key) => key.kid === header.kid);
  expect(jwk, 'The current JWKS cannot verify a previously issued token.');
  const key = createPublicKey({ key: jwk, format: 'jwk' });
  const algorithm = { RS256: 'sha256', ES256: 'sha256', EdDSA: null }[header.alg];
  expect(['RS256', 'ES256', 'EdDSA'].includes(header.alg), 'The issuer used an unsupported token signature algorithm.');
  const options = header.alg === 'ES256' ? { key, dsaEncoding: 'ieee-p1363' } : key;
  const bytes = Buffer.from(`${parts[0]}.${parts[1]}`);
  expect(verify(algorithm, bytes, options, Buffer.from(parts[2], 'base64url')), 'The ID token signature did not verify against fresh public keys.');
  const invalid = Buffer.from(parts[2], 'base64url');
  invalid[0] ^= 1;
  expect(!verify(algorithm, bytes, options, invalid), 'The signature validator accepted an altered signature.');
  expect(claims.iss === issuer, 'The ID token has the wrong issuer.');
  expect(claims.aud === rp.clientId || Array.isArray(claims.aud) && claims.aud.includes(rp.clientId), 'The ID token has the wrong audience.');
  expect(claims.sub === importedId, 'The ID token changed the imported literal subject.');
}

async function rejectedAuthorization(context, rp, overrides, expectedError) {
  const { url } = await rp.begin(overrides);
  const response = await context.request.get(url.href, { maxRedirects: 0 });
  const location = response.headers().location;
  if (location) {
    const next = new URL(location, url);
    expect(!next.searchParams.has('code'), 'The issuer issued a code for an invalid authorization request.');
    expect(next.searchParams.get('error') === expectedError || next.origin === env.AUTH_PUBLIC_URL && ['/error', '/api/auth/error'].includes(next.pathname), `The issuer did not return an authorization error (status ${response.status()}, path ${next.pathname}, error ${next.searchParams.get('error') ?? 'absent'}).`);
    if (overrides.redirect_uri) expect(next.origin !== new URL(overrides.redirect_uri).origin, 'The issuer redirected to an unregistered origin.');
  } else {
    expect(response.status() >= 400 && response.status() < 500, 'The issuer did not reject the invalid authorization request.');
  }
}

async function waitForFormStatus(page, action) {
  const form = page.locator(`form[data-account-action="${action}"]`);
  await until(async () => {
    if (await form.getAttribute('aria-busy') === 'true') return false;
    const error = form.locator('[data-form-error]');
    if (await error.isVisible() && (await error.textContent())?.trim()) throw new Error('The account form reported an error.');
    const status = form.locator('[data-form-status]');
    return await status.isVisible() && Boolean((await status.textContent())?.trim());
  }, 'The account form must report its result.');
}

const onSignal = () => {
  interrupted = true;
  process.exitCode = 1;
};
process.once('SIGINT', onSignal);
process.once('SIGTERM', onSignal);

try {
  const pg = await postgres(scope);
  const mail = await smtp(scope);
  const port = await freePort();
  env = {
    PATH: process.env.PATH, HOME: process.env.HOME,
    NODE_ENV: 'test', HOST: '127.0.0.1', PORT: String(port),
    AUTH_PUBLIC_URL: `http://localhost:${port}`, DATABASE_URL: pg.databaseUrl,
    BETTER_AUTH_SECRET: randomBytes(48).toString('base64url'), AUTH_REGISTRATION: 'open',
    SMTP_HOST: '127.0.0.1', SMTP_PORT: String(mail.port), SMTP_SECURE: 'false', SMTP_FROM: 'Synthetic Auth <auth@acceptance.localhost>',
  };
  const initial = await snapshot();
  initial.users[0].avatar = 'photo.png';
  initial.users[0].avatarUrl = `https://assets.acceptance.localhost/files/${initial.source.collectionId}/${importedId}/photo.png`;
  initial.users[0].emailVisibility = true;
  initial.users[1].verified = false;
  await check('PocketBase 0.30.4 produces source Unicode bcrypt credentials', async () => {
    const binary = resolve(packageRoot, '../pocketbase/pocketbase');
    const version = await command(binary, ['--version']);
    expect(version.stdout.toString().includes('0.30.4'), 'The source credential producer is not the pinned PocketBase version.');
    const directory = join(scope.privateDir, 'pocketbase');
    for (const child of ['data', 'migrations', 'hooks']) await mkdir(join(directory, child), { recursive: true, mode: 0o700 });
    await writeFile(join(directory, 'migrations/1000000000_unicode.js'), `migrate((app) => {
      const collection = app.findCollectionByNameOrId("users");
      for (const fixture of ${JSON.stringify(unicodeCredentials)}) {
        const record = new Record(collection);
        record.set("id", fixture.id);
        record.set("email", fixture.email);
        record.set("password", fixture.password);
        record.set("verified", true);
        record.set("name", "Synthetic Unicode");
        app.save(record);
      }
    }, () => {});`, { mode: 0o600 });
    await command(binary, ['migrate', 'up', '--dir', join(directory, 'data'), '--migrationsDir', join(directory, 'migrations'), '--hooksDir', join(directory, 'hooks')]);
    const backup = join(directory, 'offline.db');
    const source = new DatabaseSync(join(directory, 'data/data.db'), { readOnly: true });
    try { source.exec(`VACUUM INTO '${backup.replaceAll("'", "''")}'`); } finally { source.close(); }
    await chmod(backup, 0o600);
    const output = join(directory, 'unicode.json');
    await cli(['export-pocketbase', '--database', backup, '--output', output, '--source-version', '0.30.4', '--offline-backup']);
    const exported = JSON.parse(await readFile(output, 'utf8'));
    expect(exported.source.collectionId === initial.source.collectionId, 'The pinned source uses a different user collection identity.');
    initial.users.push(...exported.users);
    return { source: 'PocketBase 0.30.4', unicodeBoundaryBytes: Buffer.byteLength(unicodeCredentials[0].password), whitespacePreserved: true };
  });
  const runtimePassword = randomBytes(36).toString('base64url');
  const serviceEnvironment = () => {
    const database = new URL(env.DATABASE_URL);
    database.username = 'wts_auth_runtime';
    database.password = runtimePassword;
    return { ...env, DATABASE_URL: database.href };
  };
  let snapshotPath;
  await check('Offline legacy and current PocketBase exports preserve credentials and profile', async () => {
    for (const legacy of [true, false]) {
      const data = structuredClone(initial);
      data.source.version = legacy ? '0.22.27' : '0.30.4';
      const database = await scope.privateFile(`source-${legacy}.db`, '');
      offlinePocketBase(database, data, legacy);
      const output = join(scope.privateDir, `export-${legacy}.json`);
      await cli(['export-pocketbase', '--database', database, '--output', output,
        '--source-version', data.source.version, '--offline-backup', '--avatar-base', 'https://assets.acceptance.localhost/files/']);
      const exported = JSON.parse(await readFile(output, 'utf8'));
      data.users[0].avatarUrl = `https://assets.acceptance.localhost/files/${data.source.collectionId}/${data.users[0].id}/photo.png`;
      for (const user of data.users) user.externalAuths.sort((a, b) => a.provider.localeCompare(b.provider));
      expect(isDeepStrictEqual(exported, data), 'The offline exporter changed credentials, provider ownership, verification, or profile fields.');
      const refused = await cli(['export-pocketbase', '--database', database, '--output', join(scope.privateDir, `refused-${legacy}.json`),
        '--source-version', data.source.version], true);
      expect(refused.code !== 0, 'Export accepted a database without an explicit offline declaration.');
      if (!legacy) snapshotPath = output;
      if (!legacy) {
        const orphan = new DatabaseSync(database);
        try { orphan.prepare('INSERT INTO _externalAuths VALUES (?, ?, ?, ?)').run('missinguser0001', data.source.collectionId, 'google', 'synthetic-orphan-subject'); } finally { orphan.close(); }
        const rejected = await cli(['export-pocketbase', '--database', database, '--output', join(scope.privateDir, 'orphan.json'),
          '--source-version', data.source.version, '--offline-backup', '--avatar-base', 'https://assets.acceptance.localhost/files/'], true);
        expect(rejected.code !== 0 && JSON.parse(rejected.stderr.toString()).error === 'missing_identity_link', 'The exporter did not report an orphaned provider identity safely.');
      }
    }
  });
  await check('Migrate and import synthetic PocketBase identities', async () => {
    await cli(['migrate']);
    await cli(['import', '--snapshot', snapshotPath, '--dry-run']);
    await cli(['import', '--snapshot', snapshotPath]);
    await cli(['import', '--snapshot', snapshotPath]);
    return { source: 'synthetic offline PocketBase 0.30.4', importedWtsUserId: importedId };
  });
  await check('Provision restricted runtime database role', async () => {
    await command(process.execPath, ['scripts/provision-runtime.mjs'], {
      cwd: packageRoot, env: { ...env, AUTH_DATABASE_RUNTIME_PASSWORD: runtimePassword },
    });
  });
  let authService = service(scope, packageRoot, serviceEnvironment());
  await check('Real auth process readiness', async () => {
    await authService.ready();
    expect((await fetch(`${env.AUTH_PUBLIC_URL}/healthz`)).status === 200, 'The liveness endpoint failed.');
  });
  const rp1 = await relyingParty({ scope, issuer: env.AUTH_PUBLIC_URL, host: '127.0.0.1', clientId: `${scope.runId}-rp1`, secret: randomBytes(36).toString('base64url'), cookieName: 'rp1_session' });
  const rp2 = await relyingParty({ scope, issuer: env.AUTH_PUBLIC_URL, host: '127.0.0.2', clientId: `${scope.runId}-rp2`, secret: randomBytes(36).toString('base64url'), cookieName: 'rp2_session' });
  await check('Provision confidential clients with exact callbacks', async () => {
    for (const rp of [rp1, rp2]) {
      const manifest = await scope.privateFile(`${rp.cookieName}-client.json`, JSON.stringify(clientManifest(rp)));
      const secret = await scope.privateFile(`${rp.cookieName}-secret`, `${rp.secret}\n`);
      await cli(['client', '--manifest', manifest, '--secret-file', secret]);
      await cli(['client', '--manifest', manifest, '--secret-file', secret]);
    }
    return { relyingPartyHosts: ['127.0.0.1', '127.0.0.2'], issuerHost: 'localhost' };
  });
  browser = await chromium.launch({ headless: true });
  scope.own(() => browser.close());
  const context = await newContext();
  const page = await context.newPage();
  const issuerRequests = [];
  page.on('requestfinished', async (request) => {
    if (new URL(request.url()).origin !== env.AUTH_PUBLIC_URL) return;
    const headers = await request.allHeaders();
    issuerRequests.push({ path: new URL(request.url()).pathname, cookieNames: (headers.cookie ?? '').split(';').map((part) => part.trim().split('=')[0]).filter(Boolean) });
  });
  await check('Public pages do not require identity', async () => {
    for (const rp of [rp1, rp2]) {
      const response = await context.request.get(rp.origin);
      expect(response.status() === 200 && (await response.json()).public === true, 'An application blocked its public page.');
      expect((await context.request.get(`${rp.origin}/permission`)).status() === 401, 'An application accepted an anonymous protected request.');
    }
    expect((await context.request.get(`${env.AUTH_PUBLIC_URL}/sign-in`)).status() === 200, 'The account sign-in page is not public.');
  });
  await check('Wrong password cannot create a central session', async () => {
    const response = await api(context, '/api/auth/sign-in/email', { method: 'POST', body: { email: importedEmail, password: 'Definitely wrong synthetic password!' } });
    expect([400, 401, 403].includes(response.status), 'The issuer accepted a wrong password.');
    expect((await api(context, '/v1/me')).status === 401, 'A wrong password created a central session.');
  });
  await check('Long wrong passwords do not reveal account existence', async () => {
    const existing = await api(context, '/api/auth/sign-in/email', { method: 'POST', body: { email: importedEmail, password: 'x'.repeat(73) } });
    const absent = await api(context, '/api/auth/sign-in/email', { method: 'POST', body: { email: 'absent@acceptance.localhost', password: 'x'.repeat(73) } });
    expect(existing.status === 401 && absent.status === existing.status && isDeepStrictEqual(absent.body, existing.body), 'Login reveals whether an email has a credential account.');
  });
  await check('Browser imported-password sign-in and first real callback', async () => {
    const result = await completeAuthorization(page, rp1, { credentials: { email: importedEmail, password: importedPassword } });
    expect(result.credentialPrompts === 1, 'The first browser flow did not exercise a credential prompt.');
    expect(result.body.wtsUserId === importedId && result.body.subject === importedId, 'The first callback changed the literal imported WTS ID.');
    const profile = await ownProfile(context);
    profileIs(profile);
    expect(profile.username === importedId && profile.emailVisibility === true && profile.avatarUrl === initial.users[0].avatarUrl, 'Import lost preserved username, email visibility, or avatar.');
    const unverified = await newContext();
    expect((await api(unverified, '/api/auth/sign-in/email', { method: 'POST', body: { email: initial.users[1].email, password: 'Synthetic second password 04!' } })).status === 403, 'Import lost the unverified source state.');
    await unverified.close();
    return { wtsUserId: importedId, credentialPrompts: 1 };
  });
  await check('Second-client SSO and identical literal WTS ID', async () => {
    const result = await completeAuthorization(page, rp2);
    expect(result.credentialPrompts === 0, 'The second client requested credentials.');
    expect(result.body.wtsUserId === importedId && result.body.subject === importedId, 'The second callback changed the literal imported WTS ID.');
    return { wtsUserId: importedId, credentialPrompts: 0 };
  });
  await check('Real token signature issuer audience nonce and state', async () => {
    for (const rp of [rp1, rp2]) {
      const session = rp.latestSession();
      const callback = rp.callbacks.at(-1);
      expect(session.claims.nonce === callback.transaction.nonce, 'The issuer did not return the requested nonce.');
      expect(callback.url.searchParams.get('state') === callback.transaction.state, 'The issuer did not return the requested state.');
      await assertFreshSignature(session.tokens.id_token, rp, env.AUTH_PUBLIC_URL);
    }
    return { verifier: 'openid-client 6.8.8 with non-repudiation checks and fresh JWKS verification' };
  });
  await check('Host-only cookies stay isolated at actual server requests', async () => {
    const cookies = await context.cookies();
    const central = cookies.filter((cookie) => cookie.domain === 'localhost');
    expect(central.some((cookie) => cookie.httpOnly && cookie.sameSite === 'Lax'), 'The browser has no host-only central HttpOnly Lax cookie.');
    for (const rp of [rp1, rp2]) {
      const cookie = cookies.find((candidate) => candidate.name === rp.cookieName);
      expect(cookie?.domain === new URL(rp.origin).hostname && cookie.httpOnly && cookie.sameSite === 'Lax', 'The relying party did not create its own host-only session.');
      await page.goto(`${rp.origin}/session`);
      const request = rp.requests.at(-1);
      expect(request.cookieNames.includes(rp.cookieName), 'The browser did not send the local relying-party session.');
      expect(!request.cookieNames.includes(rp === rp1 ? rp2.cookieName : rp1.cookieName), 'The browser sent another relying-party cookie.');
      expect(!central.some((candidate) => request.cookieNames.includes(candidate.name)), 'The browser disclosed a central cookie to a relying party.');
    }
    await page.goto(`${env.AUTH_PUBLIC_URL}/v1/me`);
    await until(() => issuerRequests.some((request) => request.path === '/v1/me'), 'Observe the actual central profile request.');
    const request = issuerRequests.filter((candidate) => candidate.path === '/v1/me').at(-1);
    expect(central.some((cookie) => request.cookieNames.includes(cookie.name)), 'The browser did not send the central session to its issuer.');
    expect(!request.cookieNames.includes(rp1.cookieName) && !request.cookieNames.includes(rp2.cookieName), 'The browser disclosed an RP cookie to the issuer.');
    return { issuerHost: 'localhost', relyingPartyHosts: ['127.0.0.1', '127.0.0.2'], observedCookieValues: 'redacted' };
  });
  await check('Shared identity does not grant app-local permission', async () => {
    for (const rp of [rp1, rp2]) expect((await context.request.get(`${rp.origin}/permission`)).status() === 403, 'The application granted permission from a shared identity alone.');
  });
  await check('Versioned UserInfo profile has no app roles', async () => {
    for (const rp of [rp1, rp2]) {
      const userinfo = await oidc.fetchUserInfo(rp.config, rp.latestSession().tokens.access_token, importedId);
      expect(userinfo['https://wts.sh/user_id'] === importedId, 'UserInfo changed the WTS ID.');
      const profile = userinfo['https://wts.sh/profile'];
      expect(profile?.version === 1, 'UserInfo did not return profile version 1.');
      profileIs(profile);
      expect(!('roles' in userinfo) && !('role' in userinfo) && !('permissions' in userinfo), 'UserInfo contains application permissions.');
      expect(!('roles' in rp.latestSession().claims), 'The ID token contains app roles.');
    }
  });
  await check('Own profile update stale revision and forbidden fields', async () => {
    const before = await ownProfile(context);
    const form = { name: 'Synthetic updated profile', avatarUrl: null, preferredLanguage: 'mk', expectedRevision: before.revision };
    const update = await api(context, '/v1/me', { method: 'PATCH', body: form });
    expect(update.status === 200, 'The owner could not update the shared profile.');
    const after = await ownProfile(context);
    profileIs(after, { name: 'Synthetic updated profile', language: 'mk' });
    expect(after.revision > before.revision, 'The accepted profile update did not advance its revision.');
    for (const rp of [rp1, rp2]) {
      const userinfo = await oidc.fetchUserInfo(rp.config, rp.latestSession().tokens.access_token, importedId);
      profileIs(userinfo['https://wts.sh/profile'], { name: 'Synthetic updated profile', language: 'mk' });
      expect(userinfo['https://wts.sh/profile'].revision === after.revision, 'UserInfo did not return the current shared profile revision.');
    }
    expect((await api(context, '/v1/me', { method: 'PATCH', body: form })).status === 409, 'The profile accepted a stale revision.');
    for (const field of ['wtsUserId', 'roles', 'username', 'emailVisibility', 'revision']) {
      const response = await api(context, '/v1/me', { method: 'PATCH', body: { ...form, expectedRevision: after.revision, [field]: field === 'roles' ? ['admin'] : 'syntheticuser02' } });
      expect(response.status === 400, 'The profile accepted a forbidden field.');
    }
    const hostile = await context.request.patch(`${env.AUTH_PUBLIC_URL}/v1/me`, { headers: { Origin: 'http://127.0.0.2' }, data: { ...form, expectedRevision: after.revision } });
    expect(hostile.status() === 403, 'The profile accepted a foreign-origin mutation.');
    const current = await ownProfile(context);
    profileIs(current, { name: 'Synthetic updated profile', language: 'mk' });
    expect(current.revision === after.revision && current.username === before.username && current.emailVisibility === before.emailVisibility, 'A rejected mutation changed profile metadata.');
    return { wtsUserId: importedId, name: 'Synthetic updated profile', preferredLanguage: 'mk' };
  });
  await check('PKCE missing plain and unregistered callback are rejected', async () => {
    await rejectedAuthorization(context, rp1, { code_challenge: undefined, code_challenge_method: undefined }, 'invalid_request');
    await rejectedAuthorization(context, rp1, { code_challenge_method: 'plain' }, 'invalid_request');
    await rejectedAuthorization(context, rp1, { redirect_uri: 'http://127.0.0.3:1/unregistered' }, 'invalid_redirect');
  });
  await check('Wrong PKCE verifier and reused authorization code fail', async () => {
    await completeAuthorization(page, rp1, { target: `${rp1.origin}/login?mode=capture` });
    const wrong = await rp1.token(rp1.callbacks.at(-1), oidc.randomPKCECodeVerifier());
    expect(wrong.status >= 400 && wrong.status < 500 && typeof wrong.body.error === 'string' && !wrong.body.access_token, 'The token endpoint accepted a wrong verifier.');
    await completeAuthorization(page, rp1, { target: `${rp1.origin}/login?mode=capture` });
    const callback = rp1.callbacks.at(-1);
    const first = await rp1.token(callback);
    expect(first.status === 200 && typeof first.body.access_token === 'string', 'The valid authorization code did not exchange.');
    const second = await rp1.token(callback);
    expect(second.status >= 400 && second.status < 500 && typeof second.body.error === 'string' && !second.body.access_token, 'The token endpoint accepted a reused authorization code.');
  });
  await check('OIDC client rejects wrong state and nonce', async () => {
    for (const mode of ['wrong-state', 'wrong-nonce']) {
      const before = rp1.failures.length;
      const localPage = await context.newPage();
      await localPage.goto(`${rp1.origin}/login?mode=${mode}`);
      const consent = localPage.locator('form[data-account-action="consent"]');
      if (await consent.isVisible()) await consent.getByRole('button', { name: 'Allow access', exact: true }).click();
      await until(() => rp1.failures.length > before, 'The real OIDC client must reject its invalid response expectation.');
      expect(new URL(localPage.url()).origin === rp1.origin, 'The invalid response did not reach the real relying party.');
      await localPage.close();
    }
  });
  await check('Local logout leaves central and other app sessions', async () => {
    await page.goto(`${rp1.origin}/logout`);
    expect((await context.request.get(`${rp1.origin}/session`)).status() === 401, 'Local logout left the first app session active.');
    expect((await context.request.get(`${rp2.origin}/session`)).status() === 200, 'Local logout ended the other app session.');
    profileIs(await ownProfile(context));
    await completeAuthorization(page, rp1);
  });
  await check('Central logout revokes UserInfo but not existing RP cookies', async () => {
    const accessToken = rp1.latestSession().tokens.access_token;
    const response = await api(context, '/api/auth/sign-out', { method: 'POST', body: {} });
    expect(response.status === 200, 'Central logout failed.');
    expect((await api(context, '/v1/me')).status === 401, 'Central logout left the central session active.');
    for (const rp of [rp1, rp2]) expect((await context.request.get(`${rp.origin}/session`)).status() === 200, 'Central logout falsely ended a local RP session.');
    const userinfo = await fetch(rp1.metadata.userinfo_endpoint, { headers: { Authorization: `Bearer ${accessToken}` } });
    expect(userinfo.status === 401, 'UserInfo accepted a token whose central session ended.');
    await completeAuthorization(page, rp1, { credentials: { email: importedEmail, password: importedPassword } });
  });
  await check('Signup verification email and verified browser OIDC sign-in', async () => {
    const signupContext = await newContext();
    const signupPage = await signupContext.newPage();
    const after = mail.count();
    await signupPage.goto(`${env.AUTH_PUBLIC_URL}/sign-up`);
    const form = signupPage.locator('form[data-account-action="sign-up"]');
    await form.locator('[name="name"]').fill('Synthetic signup');
    await form.locator('[name="email"]').fill(signupEmail);
    await form.locator('[name="password"]').fill(signupPassword);
    await form.getByRole('button', { name: 'Create account', exact: true }).click();
    const verification = await mail.link({ recipient: signupEmail, after, issuer: env.AUTH_PUBLIC_URL, pathname: 'verify-email' });
    const unverified = await api(signupContext, '/api/auth/sign-in/email', { method: 'POST', body: { email: signupEmail, password: signupPassword } });
    expect(unverified.status === 403, 'An unverified account could sign in for app identity.');
    expect((await api(signupContext, '/v1/me')).status === 401, 'An unverified account acquired a usable central profile session.');
    expect((await api(signupContext, '/api/auth/sign-up/email', { method: 'POST', body: { name: 'Oversized', email: 'oversized@acceptance.localhost', password: '雪'.repeat(25) } })).status === 400, 'Signup accepted a new password longer than 72 UTF-8 bytes.');
    await signupPage.goto(verification);
    const result = await completeAuthorization(signupPage, rp2, { credentials: { email: signupEmail, password: signupPassword } });
    const profile = await ownProfile(signupContext);
    expect(typeof profile.wtsUserId === 'string' && profile.wtsUserId !== importedId && result.body.wtsUserId === profile.wtsUserId, 'The verified signup did not receive its own consistent identity.');
    expect(profile.name === 'Synthetic signup', 'The verified signup lost its chosen name.');
    await signupContext.close();
    return { mailTransport: 'localhost SMTP catcher', verifiedOidcCallback: true };
  });
  let recoveredContext;
  let recoveredPage;
  await check('Recovery reset rejects old password and revokes central sessions', async () => {
    const secondContext = await newContext();
    expect((await api(secondContext, '/api/auth/sign-in/email', { method: 'POST', body: { email: importedEmail, password: importedPassword } })).status === 200, 'A second pre-reset central session could not sign in.');
    profileIs(await ownProfile(secondContext));
    const preResetToken = rp1.latestSession().tokens.access_token;
    recoveredContext = await newContext();
    recoveredPage = await recoveredContext.newPage();
    const after = mail.count();
    await recoveredPage.goto(`${env.AUTH_PUBLIC_URL}/recovery`);
    const recovery = recoveredPage.locator('form[data-account-action="recovery"]');
    await recovery.locator('[name="email"]').fill(importedEmail);
    await recovery.getByRole('button', { name: 'Send reset link', exact: true }).click();
    const reset = await mail.link({ recipient: importedEmail, after, issuer: env.AUTH_PUBLIC_URL, pathname: 'reset-password' });
    const oversized = await api(recoveredContext, '/api/auth/reset-password', { method: 'POST', body: { token: new URL(reset).searchParams.get('token'), newPassword: '雪'.repeat(25) } });
    expect(oversized.status === 400, 'The reset endpoint accepted a new password longer than 72 UTF-8 bytes.');
    await recoveredPage.goto(reset);
    const form = recoveredPage.locator('form[data-account-action="reset-password"]');
    await form.locator('[name="newPassword"]').fill(resetPassword);
    await form.getByRole('button', { name: 'Reset password', exact: true }).click();
    await waitForFormStatus(recoveredPage, 'reset-password');
    for (const session of [context, secondContext]) expect((await api(session, '/v1/me')).status === 401, 'Password reset did not revoke a previous central session.');
    const old = await api(recoveredContext, '/api/auth/sign-in/email', { method: 'POST', body: { email: importedEmail, password: importedPassword } });
    expect([400, 401, 403].includes(old.status), 'The old password still signs in after reset.');
    expect((await api(recoveredContext, '/v1/me')).status === 401, 'The old password created a central session after reset.');
    expect((await fetch(rp1.metadata.userinfo_endpoint, { headers: { Authorization: `Bearer ${preResetToken}` } })).status === 401, 'A pre-reset token still reads UserInfo.');
    await completeAuthorization(recoveredPage, rp1, { credentials: { email: importedEmail, password: resetPassword } });
    profileIs(await ownProfile(recoveredContext), { name: 'Synthetic updated profile', language: 'mk' });
    await secondContext.close();
    return { oldPasswordRejected: true, priorCentralSessionsRevoked: 2 };
  });
  await check('Legacy imported bcrypt boundary passwords remain usable', async () => {
    for (const fixture of [{ email: 'boundary@acceptance.localhost', password: boundaryPassword, id: 'syntheticuser03' }, { email: 'legacy@acceptance.localhost', password: legacyLongPassword, id: 'syntheticuser04' }]) {
      const legacy = await newContext();
      expect((await api(legacy, '/api/auth/sign-in/email', { method: 'POST', body: { email: fixture.email, password: fixture.password } })).status === 200, 'An imported legacy boundary password no longer signs in.');
      profileIs(await ownProfile(legacy), { id: fixture.id });
      await legacy.close();
    }
  });
  await check('Source Unicode boundary and whitespace passwords retain exact input', async () => {
    for (const fixture of unicodeCredentials) {
      const unicode = await newContext();
      expect((await api(unicode, '/api/auth/sign-in/email', { method: 'POST', body: { email: fixture.email, password: fixture.password } })).status === 200, 'A PocketBase-produced Unicode password no longer signs in.');
      profileIs(await ownProfile(unicode), { id: fixture.id });
      await api(unicode, '/api/auth/sign-out', { method: 'POST', body: {} });
      if (fixture.password !== fixture.password.trim()) {
        expect((await api(unicode, '/api/auth/sign-in/email', { method: 'POST', body: { email: fixture.email, password: fixture.password.trim() } })).status === 401, 'The password verifier trimmed source credentials.');
      }
      await unicode.close();
    }
  });
  await check('Import rerun preserves later password and profile changes', async () => {
    const before = await ownProfile(recoveredContext);
    await cli(['import', '--snapshot', snapshotPath]);
    const after = await ownProfile(recoveredContext);
    profileIs(after, { name: 'Synthetic updated profile', language: 'mk' });
    expect(after.revision === before.revision, 'An identical import rewrote the later profile revision.');
    const fresh = await newContext();
    expect((await api(fresh, '/api/auth/sign-in/email', { method: 'POST', body: { email: importedEmail, password: importedPassword } })).status !== 200, 'An import rerun restored the old password.');
    expect((await api(fresh, '/api/auth/sign-in/email', { method: 'POST', body: { email: importedEmail, password: resetPassword } })).status === 200, 'An import rerun lost the reset password.');
    profileIs(await ownProfile(fresh), { name: 'Synthetic updated profile', language: 'mk' });
    await fresh.close();
  });
  await check('A fresh synthetic source can import a new literal identity', async () => {
    const freshUser = { ...initial.users[1], id: 'syntheticuser07', email: 'fresh-source@acceptance.localhost', username: 'syntheticuser07', verified: true, externalAuths: [] };
    const path = await scope.privateFile('fresh-source.json', JSON.stringify({ ...initial, source: { ...initial.source, collectionId: 'synthetic-fresh' }, users: [freshUser] }));
    await cli(['import', '--snapshot', path]);
    const fresh = await newContext();
    expect((await api(fresh, '/api/auth/sign-in/email', { method: 'POST', body: { email: freshUser.email, password: 'Synthetic second password 04!' } })).status === 200, 'A valid fresh-source import did not preserve its password.');
    profileIs(await ownProfile(fresh), { id: 'syntheticuser07' });
    await fresh.close();
    return { importedWtsUserId: 'syntheticuser07' };
  });
  await check('Import conflicts abort all writes and preserve exact identity ownership', async () => {
    const before = await ownProfile(recoveredContext);
    const newcomer = { ...initial.users[1], id: 'syntheticuser08', email: 'atomic@acceptance.localhost', username: 'syntheticuser08', name: 'Synthetic atomic import', verified: true, externalAuths: [] };
    const conflictingOwner = { ...newcomer, id: 'syntheticuser09', email: 'ownership@acceptance.localhost', username: 'syntheticuser09' };
    const cases = [
      { label: 'changed source', error: 'source_snapshot_conflict', users: [{ ...initial.users[0], name: 'Conflicting source name' }] },
      { label: 'normalized duplicate email', error: 'duplicate_normalized_email', users: [newcomer, { ...initial.users[1], id: 'syntheticuser09', email: 'ATOMIC@acceptance.localhost', username: 'syntheticuser09' }] },
      { label: 'WTS ID ownership', users: [{ ...initial.users[0], email: 'different-owner@acceptance.localhost' }] },
      { label: 'email ownership', users: [{ ...newcomer, email: importedEmail }] },
      { label: 'Google subject ownership', users: [newcomer, { ...conflictingOwner, externalAuths: [{ provider: 'google', providerId: googleId }] }] },
      { label: 'GitHub subject ownership', users: [newcomer, { ...conflictingOwner, externalAuths: [{ provider: 'github', providerId: githubId }] }] },
      { label: 'missing email', error: 'missing_email', users: [{ ...newcomer, email: '' }] },
      { label: 'missing identity link', error: 'missing_identity_link', users: [{ ...newcomer, passwordHash: '', externalAuths: [] }] },
    ];
    for (const [index, conflict] of cases.entries()) {
      const source = { ...initial.source, collectionId: index === 0 ? initial.source.collectionId : `synthetic-conflict-${index}` };
      const path = await scope.privateFile(`conflict-${index}.json`, JSON.stringify({ ...initial, source, users: conflict.users }));
      const result = await cli(['import', '--snapshot', path], true);
      expect(result.code !== 0, `The importer accepted ${conflict.label}.`);
      expect(JSON.parse(result.stderr.toString()).error === (conflict.error ?? 'conflicting_ownership'), 'The importer did not report the required safe conflict category.');
      const fresh = await newContext();
      const attempt = await api(fresh, '/api/auth/sign-in/email', { method: 'POST', body: { email: 'atomic@acceptance.localhost', password: 'Synthetic second password 04!' } });
      expect(attempt.status !== 200, 'A failed import committed another user before its conflict.');
      expect((await api(fresh, '/v1/me')).status === 401, 'A failed import created a usable atomic-import account.');
      await fresh.close();
    }
    const after = await ownProfile(recoveredContext);
    profileIs(after, { name: 'Synthetic updated profile', language: 'mk' });
    expect(after.revision === before.revision, 'A rejected import changed the existing profile.');
    return { importedWtsUserId: importedId, exactGoogleSubject: googleId, exactGithubSubject: githubId, realSocialCallbacksTested: false };
  });
  await check('Persistence survives a real auth process restart', async () => {
    const token = rp1.latestSession().tokens.id_token;
    await authService.stop();
    authService = service(scope, packageRoot, serviceEnvironment());
    await authService.ready();
    profileIs(await ownProfile(recoveredContext), { name: 'Synthetic updated profile', language: 'mk' });
    await assertFreshSignature(token, rp1, env.AUTH_PUBLIC_URL);
    await completeAuthorization(recoveredPage, rp2);
  });
  await check('PostgreSQL dump restore preserves identity credentials sessions and signing keys', async () => {
    const token = rp1.latestSession().tokens.id_token;
    await authService.stop();
    env = { ...env, DATABASE_URL: await pg.restore() };
    authService = service(scope, packageRoot, serviceEnvironment());
    await authService.ready();
    profileIs(await ownProfile(recoveredContext), { name: 'Synthetic updated profile', language: 'mk' });
    await assertFreshSignature(token, rp1, env.AUTH_PUBLIC_URL);
    const fresh = await newContext();
    const response = await api(fresh, '/api/auth/sign-in/email', { method: 'POST', body: { email: importedEmail, password: resetPassword } });
    expect(response.status === 200, 'The restored database lost the changed password.');
    profileIs(await ownProfile(fresh), { name: 'Synthetic updated profile', language: 'mk' });
    const restoredPage = await fresh.newPage();
    const result = await completeAuthorization(restoredPage, rp1);
    expect(result.body.wtsUserId === importedId, 'The restored database changed the callback identity.');
    await cli(['import', '--snapshot', snapshotPath]);
    profileIs(await ownProfile(fresh), { name: 'Synthetic updated profile', language: 'mk' });
    await fresh.close();
    return { restoredDatabase: 'isolated auth_restored within the run-owned PostgreSQL container', wtsUserId: importedId };
  });
} catch (error) {
  process.exitCode = 1;
  if (!results.some((result) => result.status === 'FAIL')) {
    results.push({ name: 'Acceptance setup', status: 'FAIL', error: redact(error.message) });
    console.error(`FAIL Acceptance setup. ${redact(error.message)}`);
  }
} finally {
  const cleanupFailures = await scope.cleanup();
  if (cleanupFailures.length) {
    process.exitCode = 1;
    results.push({ name: 'Run-owned resource cleanup', status: 'FAIL', error: cleanupFailures.join(' ') });
    console.error('FAIL Run-owned resource cleanup.');
  } else {
    results.push({ name: 'Run-owned resource cleanup', status: 'PASS', evidence: { privateSnapshotsAndSecretsRemoved: true } });
    console.log('PASS Run-owned resource cleanup');
  }
  if (interrupted) results.push({ name: 'Run completion', status: 'FAIL', error: 'The run received a termination signal.' });
  const passed = results.filter((result) => result.status === 'PASS').length;
  const failed = results.filter((result) => result.status === 'FAIL').length;
  const report = { version: 1, runId: scope.runId, completedAt: new Date().toISOString(), status: failed ? 'FAIL' : 'PASS', passed, failed, results, limitations };
  const summary = [
    `WTS auth runtime acceptance ${report.status}`, `Run ${scope.runId}`, `${passed} passed. ${failed} failed.`, '',
    ...results.map((result) => `${result.status} ${result.name}${result.error ? `. ${result.error}` : ''}`), '',
    'Limitations', ...limitations.map((value) => `- ${value}`), '',
    'Secrets, tokens, cookie values, mail bodies, database dumps, and private snapshots are not retained.', '',
  ].join('\n');
  await writeFile(join(scope.artifactDir, 'results.json'), JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
  await writeFile(join(scope.artifactDir, 'summary.txt'), summary, { mode: 0o600 });
  console.log(`${passed} PASS. ${failed} FAIL.`);
  console.log(`Redacted artifacts ${scope.artifactDir}`);
  process.removeListener('SIGINT', onSignal);
  process.removeListener('SIGTERM', onSignal);
}
