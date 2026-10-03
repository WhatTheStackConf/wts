import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { randomBytes } from 'node:crypto';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SMTPServer } from 'smtp-server';

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function until(read, description, timeout = 30_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await read();
    if (value) return value;
    await sleep(100);
  }
  throw new Error(`Timed out. ${description}`);
}

export async function freePort(host = '127.0.0.1') {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, host, resolve);
  });
  const port = server.address().port;
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

export function command(binary, args, { env, cwd, input, allowFailure = false, timeout = 60_000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { env, cwd, stdio: ['pipe', 'pipe', 'pipe'] });
    const stdout = [];
    const stderr = [];
    child.stdout.on('data', (data) => stdout.push(data));
    child.stderr.on('data', (data) => stderr.push(data));
    const timer = setTimeout(() => child.kill('SIGKILL'), timeout);
    child.once('error', (error) => { clearTimeout(timer); reject(error); });
    child.once('close', (code) => {
      clearTimeout(timer);
      const result = { code, stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr) };
      if (code === 0 || allowFailure) resolve(result);
      else reject(new Error(`${binary} exited with code ${code}.`));
    });
    child.stdin.on('error', () => {});
    child.stdin.end(input);
  });
}

export async function resources(packageRoot) {
  const runId = `wts-auth-${Date.now()}-${randomBytes(6).toString('hex')}`;
  const privateDir = await mkdtemp(join(tmpdir(), `${runId}-`));
  const artifactDir = join(packageRoot, 'acceptance', 'artifacts', runId);
  await mkdir(artifactDir, { recursive: true, mode: 0o700 });
  const disposers = [() => rm(privateDir, { recursive: true, force: true })];
  const own = (dispose) => { disposers.push(dispose); };
  let disposed = false;
  return {
    runId, privateDir, artifactDir, own,
    async privateFile(name, content) {
      const path = join(privateDir, name);
      await writeFile(path, content, { mode: 0o600 });
      return path;
    },
    async cleanup() {
      if (disposed) return [];
      disposed = true;
      const failures = [];
      for (const dispose of disposers.reverse()) {
        try { await dispose(); } catch { failures.push('A run-owned resource did not close.'); }
      }
      return failures;
    },
  };
}

export async function postgres(scope) {
  const name = scope.runId;
  const password = randomBytes(24).toString('hex');
  scope.own(async () => {
    const result = await command('podman', ['rm', '--force', '--volumes', name], { allowFailure: true });
    if (result.code !== 0 && !result.stderr.toString().includes('no container')) {
      throw new Error('The acceptance PostgreSQL container did not close.');
    }
  });
  await command('podman', ['run', '--detach', '--name', name, '--label', `wts.auth.acceptance=${name}`,
    '--env', 'POSTGRES_USER=wts_acceptance', '--env', `POSTGRES_PASSWORD=${password}`,
    '--env', 'POSTGRES_DB=auth_acceptance', '--publish', '127.0.0.1::5432',
    'docker.io/library/postgres:18.3-alpine@sha256:1b13c640ae11f2f165d1e89667e5862b0017baf4c80fec2fb7377d86319859ba'], { timeout: 180_000 });
  const published = await command('podman', ['port', name, '5432/tcp']);
  const match = /^127\.0\.0\.1:(\d+)\s*$/.exec(published.stdout.toString());
  if (!match) throw new Error('PostgreSQL must bind to loopback only.');
  await until(async () => {
    const result = await command('podman', ['exec', name, 'pg_isready', '-U', 'wts_acceptance', '-d', 'auth_acceptance'], { allowFailure: true });
    return result.code === 0;
  }, 'PostgreSQL must accept local connections.');
  const databaseUrl = `postgres://wts_acceptance:${password}@127.0.0.1:${match[1]}/auth_acceptance`;
  return {
    databaseUrl,
    async restore() {
      const dump = await command('podman', ['exec', name, 'pg_dump', '-U', 'wts_acceptance', '-d', 'auth_acceptance', '--format=custom']);
      await command('podman', ['exec', name, 'createdb', '-U', 'wts_acceptance', 'auth_restored']);
      await command('podman', ['exec', '-i', name, 'pg_restore', '-U', 'wts_acceptance', '-d', 'auth_restored', '--exit-on-error', '--no-owner'], { input: dump.stdout });
      return databaseUrl.replace('/auth_acceptance', '/auth_restored');
    },
  };
}

export async function smtp(scope) {
  const messages = [];
  const server = new SMTPServer({
    name: 'localhost', secure: false, authOptional: true, disabledCommands: ['AUTH', 'STARTTLS'],
    logger: false,
    onRcptTo(address, _session, callback) {
      if (!address.address.endsWith('@acceptance.localhost')) return callback(new Error('Use a synthetic acceptance.localhost recipient.'));
      callback();
    },
    onData(stream, session, callback) {
      const chunks = [];
      stream.on('data', (chunk) => chunks.push(chunk));
      stream.once('error', callback);
      stream.once('end', () => {
        messages.push({ recipients: session.envelope.rcptTo.map(({ address }) => address), raw: Buffer.concat(chunks).toString('utf8') });
        callback();
      });
    },
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  scope.own(() => new Promise((resolve) => server.close(resolve)));
  return {
    port: server.server.address().port,
    count: () => messages.length,
    async link({ recipient, after, issuer, pathname }) {
      return until(() => {
        for (const message of messages.slice(after)) {
          if (!message.recipients.includes(recipient)) continue;
          const decoded = message.raw.replace(/=\r?\n/g, '').replace(/=([\da-f]{2})/gi, (_, hex) => String.fromCharCode(Number.parseInt(hex, 16)));
          const candidates = decoded.match(/https?:\/\/[^\s<>"']+/g) ?? [];
          for (const candidate of candidates) {
            let url;
            try { url = new URL(candidate.replace(/&amp;/g, '&')); } catch { continue; }
            if (url.origin === issuer && url.pathname.includes(pathname)) return url.href;
          }
        }
        return false;
      }, 'The local catcher must receive the account email.');
    },
  };
}

export function service(scope, packageRoot, env) {
  const child = spawn(process.execPath, ['dist/server.js'], { cwd: packageRoot, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let exited = false;
  let failure;
  child.stdout.resume();
  child.stderr.resume();
  child.once('error', (error) => { failure = error; exited = true; });
  const closed = new Promise((resolve) => child.once('close', () => { exited = true; resolve(); }));
  let stopped = false;
  async function stop() {
    if (stopped) return;
    stopped = true;
    if (!exited) {
      child.kill('SIGTERM');
      const timer = setTimeout(() => child.kill('SIGKILL'), 5_000);
      await closed;
      clearTimeout(timer);
    }
  }
  scope.own(stop);
  return {
    stop,
    ready: () => until(async () => {
      if (exited) throw new Error(failure ? 'The real auth process did not start.' : 'The real auth process exited before readiness.');
      try { return (await fetch(`${env.AUTH_PUBLIC_URL}/readyz`)).status === 200; } catch { return false; }
    }, 'The real auth service must report readiness.'),
  };
}
