import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { createServer as httpsServer } from 'node:https';
import { request as httpRequest } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { command, resources, postgres, smtp, service, freePort, until } from '../../auth/acceptance/resources.mjs';
import { importedEmail, snapshot } from '../../auth/acceptance/fixtures.mjs';
import { openCfpDatabase } from '../src/server/storage.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const authRoot = join(root, 'auth');
const cfpRoot = join(root, 'cfp');

if (!process.env.WTS_CFP_PROOF_TLS_DIRECTORY) {
  const directory = await mkdtemp(join(tmpdir(), 'wts-cfp-proof-tls-'));
  try {
    await command('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
      '-keyout', join(directory, 'key.pem'), '-out', join(directory, 'cert.pem'),
      '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1,IP:127.0.0.2']);
    const child = spawn(process.execPath, ['--experimental-strip-types', fileURLToPath(import.meta.url)], {
      cwd: root,
      env: { ...process.env, NODE_EXTRA_CA_CERTS: join(directory, 'cert.pem'), WTS_CFP_PROOF_TLS_DIRECTORY: directory },
      stdio: 'inherit',
    });
    const stop = () => child.kill('SIGTERM');
    process.on('SIGTERM', stop);
    process.on('SIGINT', stop);
    const code = await new Promise((accept, reject) => {
      child.once('error', reject);
      child.once('exit', (value) => accept(value ?? 1));
    });
    process.off('SIGTERM', stop);
    process.off('SIGINT', stop);
    process.exitCode = code;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
} else {
  await fixture();
}

async function fixture() {
  const scope = await resources(cfpRoot);
  let currentAction = 'Initialize the isolated browser fixture';
  let cfpService;
  let dataDir = join(scope.privateDir, 'cfp');
  let backupPath;
  let env;
  let central;
  let commands;
  const report = (value) => console.log(JSON.stringify(value));

  async function authCli(args) {
    return command(process.execPath, ['dist/cli.js', ...args], { cwd: authRoot, env });
  }

  async function cfpCli(args) {
    return command(process.execPath, ['--experimental-strip-types', 'scripts/cfp-data.ts', ...args], {
      cwd: cfpRoot, env: { ...env, CFP_DATA_DIR: dataDir },
    });
  }

  function database(run) {
    const db = openCfpDatabase(dataDir);
    try { return run(db); } finally { db.close(); }
  }

  async function proxy(host, port, targetPort, tls) {
    const server = httpsServer(tls, (incoming, outgoing) => {
      const headers = { ...incoming.headers, 'x-forwarded-proto': 'https', 'x-forwarded-host': incoming.headers.host };
      const upstream = httpRequest({ hostname: '127.0.0.1', port: targetPort, path: incoming.url, method: incoming.method, headers }, (response) => {
        outgoing.writeHead(response.statusCode ?? 502, response.headers);
        response.pipe(outgoing);
      });
      upstream.on('error', () => {
        if (!outgoing.headersSent) outgoing.writeHead(502, { 'content-type': 'text/plain', 'cache-control': 'no-store' });
        outgoing.end('The local proof service is unavailable.');
      });
      incoming.pipe(upstream);
    });
    await new Promise((accept, reject) => {
      server.once('error', reject);
      server.listen(port, host, accept);
    });
    scope.own(async () => {
      server.closeAllConnections();
      await new Promise((accept, reject) => server.close((error) => error ? reject(error) : accept()));
    });
  }

  async function startCfp(origin, port) {
    const output = [];
    const child = spawn(process.execPath, ['.output/server/index.mjs'], {
      cwd: cfpRoot,
      env: { ...env, NODE_ENV: 'production', HOST: '127.0.0.1', PORT: String(port),
        CFP_DATA_DIR: dataDir, CFP_EDITION_ID: '2027', CFP_ORIGIN: origin, CFP_TRUST_PROXY: 'true' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let exited = false;
    let stopped = false;
    child.stdout.resume();
    child.stderr.on('data', (bytes) => { output.push(bytes); if (output.length > 20) output.shift(); });
    const closed = new Promise((accept) => child.once('close', () => { exited = true; accept(); }));
    const stop = async () => {
      if (stopped) return;
      stopped = true;
      if (!exited) {
        child.kill('SIGTERM');
        const timer = setTimeout(() => child.kill('SIGKILL'), 5_000);
        await closed;
        clearTimeout(timer);
      }
    };
    scope.own(stop);
    await until(async () => {
      if (exited) throw new Error('The built CFP process exited before readiness.');
      try { return (await fetch(`${origin}/readyz`)).status === 200; } catch { return false; }
    }, 'The built CFP process must become ready.');
    return { stop };
  }

  try {
    const pg = await postgres(scope);
    const mail = await smtp(scope);
    const authPort = await freePort();
    const authTlsPort = await freePort();
    const cfpPort = await freePort();
    const cfpTlsPort = await freePort('127.0.0.2');
    const issuer = `https://localhost:${authTlsPort}`;
    const origin = `https://127.0.0.2:${cfpTlsPort}`;
    const tlsDirectory = process.env.WTS_CFP_PROOF_TLS_DIRECTORY;
    const tls = { key: await readFile(join(tlsDirectory, 'key.pem')), cert: await readFile(join(tlsDirectory, 'cert.pem')) };
    env = {
      PATH: process.env.PATH, HOME: process.env.HOME, NODE_EXTRA_CA_CERTS: process.env.NODE_EXTRA_CA_CERTS,
      NODE_ENV: 'test', HOST: '127.0.0.1', PORT: String(authPort), AUTH_PUBLIC_URL: issuer,
      DATABASE_URL: pg.databaseUrl, BETTER_AUTH_SECRET: randomBytes(48).toString('base64url'),
      AUTH_REGISTRATION: 'closed', SMTP_HOST: '127.0.0.1', SMTP_PORT: String(mail.port), SMTP_SECURE: 'false',
      SMTP_FROM: 'Synthetic Auth <auth@acceptance.localhost>', CFP_SESSION_KEY: randomBytes(32).toString('base64url'),
    };
    Object.assign(env, {
      CFP_MAIL_MODE: 'smtp', CFP_SMTP_HOST: '127.0.0.1', CFP_SMTP_PORT: String(mail.port),
      CFP_SMTP_SECURE: 'false', CFP_SMTP_FROM: 'cfp@acceptance.localhost',
      CFP_DAILY_REPORT_RECIPIENTS: JSON.stringify([{ wtsUserId: 'syntheticuser04', email: 'legacy@acceptance.localhost' }]),
    });
    const identities = await snapshot();
    for (const [id, email, name] of [
      ['syntheticuser05', 'second-admin@acceptance.localhost', 'Synthetic second admin'],
      ['syntheticuser06', 'unassigned@acceptance.localhost', 'Synthetic unassigned reviewer'],
    ]) identities.users.push({ ...identities.users[0], id, email, name, username: id, externalAuths: [] });
    const imported = await scope.privateFile('synthetic-identities.json', JSON.stringify(identities));
    await authCli(['migrate']);
    await authCli(['import', '--snapshot', imported]);
    const runtimePassword = randomBytes(36).toString('base64url');
    await command(process.execPath, ['scripts/provision-runtime.mjs'], {
      cwd: authRoot, env: { ...env, AUTH_DATABASE_RUNTIME_PASSWORD: runtimePassword },
    });
    const clientId = `${scope.runId}-cfp`;
    const clientSecret = randomBytes(36).toString('base64url');
    const manifest = await scope.privateFile('cfp-client.json', JSON.stringify({
      version: 1, clientId, name: 'Synthetic CFP browser consumer',
      redirectUris: [`${origin}/auth/callback`], scopes: ['openid', 'profile', 'email', 'wts.profile'],
    }));
    const secret = await scope.privateFile('cfp-client-secret', `${clientSecret}\n`);
    await authCli(['client', '--manifest', manifest, '--secret-file', secret]);
    const databaseUrl = new URL(pg.databaseUrl);
    databaseUrl.username = 'wts_auth_runtime';
    databaseUrl.password = runtimePassword;
    await proxy('127.0.0.1', authTlsPort, authPort, tls);
    central = service(scope, authRoot, { ...env, DATABASE_URL: databaseUrl.href });
    await central.ready();
    Object.assign(env, { OIDC_ISSUER: issuer, OIDC_CLIENT_ID: clientId, OIDC_CLIENT_SECRET: clientSecret });
    await cfpCli(['init', '2027']);
    await cfpCli(['open', '2027']);
    await proxy('127.0.0.2', cfpTlsPort, cfpPort, tls);
    cfpService = await startCfp(origin, cfpPort);
    const fixtureAccount = (wtsUserId, email) => ({
      wtsUserId, email, emailVerified: true, accountUrl: `${issuer}/account`,
      profile: { version: 1, wtsUserId, name: `Synthetic ${wtsUserId}`, avatarUrl: null,
        preferredLanguage: 'en', username: wtsUserId, emailVisibility: false, revision: 1 },
    });
    const withCfpData = async (work) => {
      const previous = Object.fromEntries(['CFP_DATA_DIR', 'CFP_EDITION_ID', 'CFP_ORIGIN'].map((key) => [key, process.env[key]]));
      Object.assign(process.env, { CFP_DATA_DIR: dataDir, CFP_EDITION_ID: '2027', CFP_ORIGIN: origin });
      try { return await work(); } finally {
        for (const [key, value] of Object.entries(previous)) {
          if (value === undefined) delete process.env[key];
          else process.env[key] = value;
        }
      }
    };
    report({ ready: true, origin, issuer, runId: scope.runId });
    commands = createInterface({ input: process.stdin, crlfDelay: Infinity });
    for await (const line of commands) {
      if (!line.trim()) continue;
      const input = JSON.parse(line);
      currentAction = input.command;
      if (input.command === 'cleanup') break;
      switch (input.command) {
        case 'restart':
          await cfpService.stop();
          cfpService = await startCfp(origin, cfpPort);
          report({ restarted: true });
          break;
        case 'open':
        case 'close':
          await cfpCli([input.command, '2027']);
          report({ cfpOpen: input.command === 'open' });
          break;
        case 'bootstrap-admin': {
          assert.match(input.wtsUserId, /^syntheticuser0[1-6]$/);
          const result = await cfpCli(['bootstrap-admin', '2027', input.wtsUserId]);
          report({ bootstrapped: JSON.parse(result.stdout.toString('utf8')) });
          break;
        }
        case 'historical-reviewer': {
          await cfpCli(['init', '2026']);
          await cfpCli(['bootstrap-admin', '2026', 'syntheticuser04']);
          const previous = { data: process.env.CFP_DATA_DIR, edition: process.env.CFP_EDITION_ID };
          try {
            process.env.CFP_DATA_DIR = dataDir;
            process.env.CFP_EDITION_ID = '2026';
            const staff = await import('../src/server/staff.ts');
            const actor = {
              wtsUserId: 'syntheticuser04', email: 'legacy@acceptance.localhost', emailVerified: true, accountUrl: `${issuer}/account`,
              profile: { version: 1, wtsUserId: 'syntheticuser04', name: 'Synthetic syntheticuser04',
                avatarUrl: null, preferredLanguage: 'en', username: 'syntheticuser04', emailVisibility: false, revision: 1 },
            };
            const member = staff.getStaffDirectory(actor).members.find((value) => value.wtsUserId === 'syntheticuser06');
            assert.ok(member);
            staff.executeStaffCommand(actor, {
              kind: 'set-grant', requestId: randomUUID(), wtsUserId: 'syntheticuser06', role: 'reviewer',
              expectedRevision: member.reviewerGrant?.revision ?? 0, active: true,
            });
            report({ historicalReviewer: true });
          } finally {
            for (const [key, value] of [['CFP_DATA_DIR', previous.data], ['CFP_EDITION_ID', previous.edition]]) {
              if (value === undefined) delete process.env[key];
              else process.env[key] = value;
            }
          }
          break;
        }
        case 'mail-tick': {
          const result = await cfpCli(['mail-tick']);
          report({ mailTick: JSON.parse(result.stdout.toString('utf8')), capturedMessages: mail.count() });
          break;
        }
        case 'staff-inspect':
          report(database((db) => ({
            staff: true,
            grants: db.prepare('SELECT edition_id, wts_user_id, role, revision, state FROM edition_staff_grants ORDER BY wts_user_id, role').all(),
            assignments: db.prepare('SELECT edition_id, application_id, reviewer_id, revision, state FROM proposal_assignments ORDER BY application_id, reviewer_id').all(),
            reviews: db.prepare('SELECT edition_id, application_id, reviewer_id, revision, presentation_revision FROM proposal_reviews ORDER BY application_id, reviewer_id').all(),
            policy: db.prepare('SELECT * FROM edition_review_policy ORDER BY edition_id').all(),
            mailJobs: db.prepare('SELECT kind, state, attempts FROM cfp_mail_jobs ORDER BY job_id').all(),
          })));
          break;
        case 'seed-bulk':
          await withCfpData(async () => {
            const domain = await import('../src/server/applicants.ts');
            const account = fixtureAccount('syntheticuser01', importedEmail);
            const ids = [];
            for (let index = 1; index <= 51; index++) {
              const started = domain.startDraft(account, { requestId: randomUUID(), intent: { kind: 'new' } });
              const saved = domain.saveDraft(account, { draftId: started.draft.id, expectedDraftRevision: started.draft.revision,
                presentation: { title: `Synthetic pagination proposal ${String(index).padStart(2, '0')}`,
                  abstract: 'Synthetic batch selection abstract.', keyTakeaways: 'Preserve revision-bound targets across pages.' } });
              ids.push(domain.submitDraft(account, { draftId: saved.draft.id,
                expected: { draft: saved.draft.revision, speaker: saved.speaker.revision, settings: saved.settings.revision } }).applicationId);
            }
            report({ seededBulk: true, ids });
          });
          break;
        case 'finalize':
          assert.match(input.applicationId, /^[0-9a-f-]{36}$/);
          await withCfpData(async () => {
            const staff = await import('../src/server/staff.ts');
            const actor = fixtureAccount('syntheticuser04', 'legacy@acceptance.localhost');
            const proposal = staff.getAdminProposal(actor, input.applicationId);
            staff.executeStaffCommand(actor, { kind: 'decide-proposals', requestId: randomUUID(),
              expectedWeightingRevision: proposal.weighting.revision, status: 'accepted',
              targets: [{ applicationId: proposal.application.id, expectedApplicationRevision: proposal.application.revision,
                expectedPresentationRevision: proposal.presentationRevision, expectedAssessmentRevision: proposal.assessmentRevision }] });
            report({ finalized: input.applicationId });
          });
          break;
        case 'inspect':
          report(database((db) => ({
            applications: db.prepare('SELECT application_id, wts_user_id, status, revision, presentation_json FROM applications ORDER BY submitted_at').all(),
            profiles: db.prepare('SELECT wts_user_id, revision, value_json FROM speaker_profiles').all(),
            sessions: db.prepare('SELECT COUNT(*) AS count FROM cfp_sessions').get().count,
          })));
          break;
        case 'backup':
          backupPath = join(scope.privateDir, `backup-${randomUUID()}`);
          await cfpCli(['backup', backupPath]);
          report({ backupPath });
          break;
        case 'restore':
          assert.ok(backupPath);
          await cfpService.stop();
          const destination = join(scope.privateDir, `restore-${randomUUID()}`);
          await cfpCli(['restore', backupPath, destination]);
          dataDir = destination;
          cfpService = await startCfp(origin, cfpPort);
          report({ restored: true, cfpOpen: false });
          break;
        case 'stop-provider':
          await central.stop();
          report({ providerStopped: true });
          break;
        default:
          throw new Error('Use a supported browser-fixture command.');
      }
    }
  } catch (error) {
    report({ failedAction: currentAction, error: error instanceof Error ? error.message : 'The local browser fixture failed.' });
    process.exitCode = 1;
  } finally {
    commands?.close();
    const cleanupFailures = await scope.cleanup();
    report({ cleanupFailures: cleanupFailures.length });
    if (cleanupFailures.length) process.exitCode = 1;
  }
}
