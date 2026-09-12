import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { copyFileSync, mkdtempSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import PocketBase from 'pocketbase';

/** Synthetic loopback-only DB. Relevant real migrations/hooks are copied unchanged.
 * Never reads .env or existing pb_data; excludes mail, cron and outbound hooks. */
export async function startLiveQaPocketBase() {
  const root = mkdtempSync(join(tmpdir(), 'wts-live-qa-test-'));
  const migrationsDir = join(root, 'pb_migrations');
  const hooksDir = join(root, 'pb_hooks');
  const dataDir = join(root, 'pb_data');
  for (const path of [migrationsDir, hooksDir, dataDir]) mkdirSync(path);
  const source = fileURLToPath(new URL('../../pocketbase/', import.meta.url));
  const migrations = [
    '1735401500_create_cfp_applicants.js', '1735401600_create_cfp_submissions.js',
    '1768850000_roles_and_reviews.js', '1768850001_fix_user_role.js',
    '1768850002_create_cfp_weight_votes.js', '1768850003_restrict_admin_writes.js',
    '1776000000_create_speakers_and_sessions.js', '1776000001_speakers_sessions_public_rules.js',
    '1776000002_add_cfp_submissions_status.js', '1777000000_harden_auth_and_reviewer_rules.js',
    '1777000001_fix_users_role_update_rule.js', '1781000000_fix_registration_role_escalation.js',
    '1784000000_add_programme_provenance.js', '1785000000_create_programme_agenda.js',
    '1785000001_enable_batch_requests.js', '1787000007_harden_reviewer_ownership.js',
    '1787000009_backfill_empty_user_roles.js', '1788000003_create_appearance_events.js',
    '1788000004_create_event_programmes.js', '1790000000_add_checkin_operator_role.js',
    ...readdirSync(join(source, 'pb_migrations')).filter(name => name.endsWith('_create_live_qa.js')),
  ];
  const hooks = readdirSync(join(source, 'pb_hooks')).filter(name => name.startsWith('live-qa') || [
    'users_role_guard.pb.js', 'agenda_constraints.pb.js', 'appearance_event_constraints.pb.js', 'programme_public_fields.pb.js',
  ].includes(name));
  for (const name of migrations) copyFileSync(join(source, 'pb_migrations', name), join(migrationsDir, name));
  for (const name of hooks) copyFileSync(join(source, 'pb_hooks', name), join(hooksDir, name));
  const hookHashes = Object.fromEntries(hooks.map(name => [name, createHash('sha256').update(readFileSync(join(hooksDir, name))).digest('hex')]));
  const binary = join(source, 'pocketbase');
  const args = [`--dir=${dataDir}`, `--migrationsDir=${migrationsDir}`, `--hooksDir=${hooksDir}`];
  function run(command: string[]) {
    const result = spawnSync(binary, [...command, ...args], { encoding: 'utf8' });
    if (result.status !== 0) throw new Error(`Disposable PB failed: ${result.error?.message || ''}\n${result.stdout}\n${result.stderr}`);
    return result.stdout.trim();
  }
  const password = 'Disposable-live-qa-only-2026!';
  const superuserEmail = 'root-live-qa@example.test';
  let server: ChildProcess | undefined;
  let logs = '';
  async function stop() {
    if (!server || server.exitCode !== null) return;
    const process = server;
    await new Promise<void>(resolve => {
      const timer = setTimeout(() => process.kill('SIGKILL'), 1000);
      process.once('exit', () => { clearTimeout(timer); resolve(); });
      process.kill('SIGTERM');
    });
  }
  try {
    const version = run(['--version']);
    run(['migrate', 'up']);
    run(['superuser', 'create', superuserEmail, password, '--automigrate=false']);
    const port = await new Promise<number>((resolve, reject) => {
      const listener = createServer();
      listener.once('error', reject);
      listener.listen(0, '127.0.0.1', () => {
        const address = listener.address();
        if (!address || typeof address === 'string') return reject(new Error('Missing test port'));
        listener.close(error => error ? reject(error) : resolve(address.port));
      });
    });
    const baseUrl = `http://127.0.0.1:${port}`;
    async function start() {
      server = spawn(binary, ['serve', `--http=127.0.0.1:${port}`, ...args, '--dev=true', '--automigrate=false', '--hooksWatch=false'], { stdio: ['ignore', 'pipe', 'pipe'] });
      server.stdout?.on('data', chunk => { logs += String(chunk); });
      server.stderr?.on('data', chunk => { logs += String(chunk); });
      for (let attempt = 0; attempt < 100; attempt++) {
        try { if ((await fetch(`${baseUrl}/api/health`, { signal: AbortSignal.timeout(300) })).ok) return; } catch { /* booting */ }
        if (server.exitCode !== null) break;
        await new Promise(resolve => setTimeout(resolve, 30));
      }
      throw new Error(`Disposable PB failed to start: ${logs}`);
    }
    await start();
    const pb = new PocketBase(baseUrl);
    pb.autoCancellation(false);
    await pb.collection('_superusers').authWithPassword(superuserEmail, password);
    return {
      pb, baseUrl, root, password, superuserEmail, migrations, hooks, hookHashes, version,
      logs: () => logs,
      restart: async () => { await stop(); await start(); },
      /** Seed legacy/inconsistent publication graphs while stopped; runtime hooks stay unchanged.
       * Only the disposable dataDir is ever opened, never a developer/production database. */
      async patchStoredRecords(patches: { collection: 'conference_days' | 'appearance_events' | 'agenda_slots' | 'agenda_tracks' | 'sessions'; id: string; fields: Record<string, string | number | boolean> }[]) {
        for (const patch of patches) {
          if (!['conference_days', 'appearance_events', 'agenda_slots', 'agenda_tracks', 'sessions'].includes(patch.collection) || !Object.keys(patch.fields).every(key => /^[a-z_]+$/.test(key))) throw new Error('Invalid fixture patch');
        }
        await stop();
        try {
          const result = spawnSync('python3', ['-c', [
            'import json, sqlite3, sys',
            'db = sqlite3.connect(sys.argv[1])',
            'for patch in json.loads(sys.argv[2]):',
            '    fields = patch["fields"]',
            '    assignments = ", ".join(chr(34) + key + chr(34) + " = ?" for key in fields)',
            '    cursor = db.execute("UPDATE " + patch["collection"] + " SET " + assignments + " WHERE id = ?", [*fields.values(), patch["id"]])',
            '    assert cursor.rowcount == 1, "Missing fixture target"',
            'db.commit()',
            'db.close()',
          ].join('\n'), join(dataDir, 'data.db'), JSON.stringify(patches)], { encoding: 'utf8' });
          if (result.status !== 0) throw new Error(`Fixture patch failed: ${result.error?.message || ''} ${result.stderr}`);
        } finally { await start(); }
        for (const patch of patches) {
          const record = await pb.collection(patch.collection).getOne(patch.id);
          for (const [key, value] of Object.entries(patch.fields)) {
            if (record[key] !== value) throw new Error(`Fixture patch did not persist ${patch.collection}.${key}`);
          }
        }
      },
      cleanup: async () => { await stop(); rmSync(root, { recursive: true, force: true }); },
      async user(role = 'user', name = 'Test Human') {
        const email = `${crypto.randomUUID()}@example.test`;
        const record = await pb.collection('users').create({ email, password, passwordConfirm: password, name, role, verified: true });
        const client = new PocketBase(baseUrl);
        client.autoCancellation(false);
        await client.collection('users').authWithPassword(email, password);
        return { record, client };
      },
      async session(options: {
        slug?: string; title?: string; startAt?: string; endAt?: string; published?: boolean;
        mainDay?: boolean; dayKey?: string; eventId?: string;
        stageKey?: string; stageName?: string; locationLabel?: string; displayOrder?: number;
        programmeId?: string; trackId?: string;
      } = {}) {
        const slug = options.slug ?? `session-${crypto.randomUUID()}`;
        const localDateOf = (value: string) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Skopje', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value));
        const now = new Date().toISOString();
        const minuteAgo = new Date(Date.now() - 60_000).toISOString();
        // At local midnight, keep default live slots on today's announced date.
        const startAt = options.startAt ?? (localDateOf(minuteAgo) === localDateOf(now) ? minuteAgo : now);
        const endAt = options.endAt ?? new Date(new Date(startAt).getTime() + 3_600_000).toISOString();
        const localDate = localDateOf(startAt);
        const dayKey = options.dayKey ?? (options.mainDay === false ? slug : 'main-day');
        const eventId = options.eventId ?? 'wts2026appevent';
        const appearanceEvent = await pb.collection('appearance_events').getOne(eventId);
        const days = await pb.collection('conference_days').getList(1, 1, { filter: pb.filter('key = {:key}', { key: dayKey }) });
        let day = days.items[0] ?? await pb.collection('conference_days').create({ key: dayKey, local_date: localDate, title: 'Synthetic Day', published: true });
        const programmes = await pb.collection('event_programmes').getList(1, 1, { filter: pb.filter('day = {:day} && appearance_event = {:event}', { day: day.id, event: eventId }) });
        const programme = options.programmeId ? await pb.collection('event_programmes').getOne(options.programmeId) : programmes.items[0] ?? await pb.collection('event_programmes').create({ day: day.id, appearance_event: eventId });
        day = await pb.collection('conference_days').getOne(programme.day);
        const track = options.trackId === '' ? null : options.trackId ? await pb.collection('agenda_tracks').getOne(options.trackId) : await pb.collection('agenda_tracks').create({
          programme: programme.id, key: options.stageKey ?? slug, name: options.stageName ?? 'Synthetic Stage',
          location_label: options.locationLabel ?? 'Synthetic Hall', display_order: options.displayOrder ?? 0,
        });
        const session = await pb.collection('sessions').create({ slug, title: options.title ?? `Session ${slug}`, abstract: '<p>Synthetic abstract</p>', published: false });
        const slot = await pb.collection('agenda_slots').create({ programme: programme.id, track: track?.id ?? '', session: session.id, kind: 'session', start_at: startAt, end_at: endAt, published: false });
        const publish = async (published: boolean) => {
          await pb.send(`/api/wts/programme/agenda-slots/${slot.id}/publication`, { method: 'POST', body: { published } });
          Object.assign(session, await pb.collection('sessions').getOne(session.id));
          Object.assign(slot, await pb.collection('agenda_slots').getOne(slot.id));
        };
        if (options.published !== false) await publish(true);
        return { session, slot, programme, day, appearanceEvent, track, slug, startAt, endAt, publish };
      },
    };
  } catch (error) {
    await stop();
    rmSync(root, { recursive: true, force: true });
    throw error;
  }
}
