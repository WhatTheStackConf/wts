#!/usr/bin/env node
/** Organizer-only operations. No dotenv, mail transport, or public results publisher. */
import { createHash, randomBytes, randomInt, createCipheriv, createDecipheriv } from 'node:crypto';
import { constants } from 'node:fs';
import { open, mkdir, lstat, rename, unlink } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

class OperationError extends Error {}
const fail = (condition, message) => { if (!condition) throw new OperationError(message); };
const digest = value => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
const text = value => typeof value === 'string' && value.length > 0 && value.length <= 500;
const id = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,120}$/.test(value);
const date = value => {
  fail(typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?(Z|[+-]\d\d:\d\d)$/.test(value) && Number.isFinite(Date.parse(value)), 'explicit ISO time with timezone required');
  const calendar = new Date(`${value.slice(0, 10)}T00:00:00Z`);
  fail(Number.isFinite(+calendar) && calendar.toISOString().slice(0, 10) === value.slice(0, 10) && Number(value.slice(11, 13)) < 24, 'valid calendar date/time required');
  return new Date(value);
};
const normalizedEmail = email => typeof email === 'string' ? email.trim().toLowerCase() : '';
function validEmail(email) {
  if (typeof email !== 'string' || email !== email.trim() || email.length > 254 || !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email)) return false;
  const [local, domain] = email.toLowerCase().split('@');
  if (local.length > 64 || local.startsWith('.') || local.endsWith('.') || local.includes('..') || !/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+$/.test(local)) return false;
  if (!domain.split('.').every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)) || !/\.[a-z]{2,63}$/.test(domain)) return false;
  return !/(^|\.)(invalid|example|localhost|test|local|lan)$/.test(domain) && !/(^|\.)example\.(com|org|net)$/.test(domain) && !/^(no-?reply|unknown|placeholder|missing|none|test)([+._-]|$)/.test(local);
}
function validateSuppressions(value) {
  fail(value && text(value.source) && Array.isArray(value.emails) && Array.isArray(value.attendeeIds), 'explicit suppression review required');
  date(value.reviewedAt);
  fail(value.emails.every(text) && value.attendeeIds.every(id), 'invalid suppression input');
  return value;
}

export function prepareAudience(snapshot) {
  const s = snapshot;
  fail(s?.version === 1 && id(s.source) && id(s.eventId) && id(s.listId) && /^\d{4}-\d\d-\d\d$/.test(s.mainDay), 'source/event/main-day/list provenance required');
  fail(Array.isArray(s.admissionProductIds) && s.admissionProductIds.length > 0 && s.admissionProductIds.every(id) && new Set(s.admissionProductIds).size === s.admissionProductIds.length, 'admission products required');
  const p = s.provenance;
  fail(p?.endpoint === `/events/${s.eventId}/check-in-lists/${s.listId}/attendees`, 'exact-list export required');
  date(p.exportedAt);
  fail(p.complete === true && p.sort === 'id:asc' && Array.isArray(s.records) && Number.isSafeInteger(p.total) && p.total === s.records.length && Array.isArray(p.pages) && p.pages.length > 0, 'complete validated export required');
  const pageIds = [];
  p.pages.forEach((page, index) => {
    fail(page.page === index + 1 && page.total === p.total && Array.isArray(page.ids) && (page.ids.length > 0 || p.total === 0 && p.pages.length === 1), 'complete page evidence required');
    pageIds.push(...page.ids);
  });
  const ids = s.records.map(r => r.id);
  fail(ids.every(id) && new Set(ids).size === ids.length && new Set(pageIds).size === pageIds.length, 'unique attendee IDs required');
  fail(JSON.stringify(pageIds) === JSON.stringify(ids), 'complete ordered page evidence required');
  fail(ids.every((value, i) => i === 0 || (/^\d+$/.test(value) && /^\d+$/.test(ids[i - 1]) ? BigInt(ids[i - 1]) < BigInt(value) : ids[i - 1] < value)), 'strictly ordered id:asc export required');
  const checkIds = s.records.flatMap(row => row.checkIn?.listId === s.listId && row.checkIn?.eventId === s.eventId && id(row.checkIn?.id) ? [row.checkIn.id] : []);
  fail(new Set(checkIds).size === checkIds.length, 'unique check-in evidence required');
  const suppressions = validateSuppressions(s.suppressions);
  const suppressedEmails = new Set(suppressions.emails.map(normalizedEmail));
  const suppressedIds = new Set(suppressions.attendeeIds);
  const names = new Map();
  for (const row of s.records) {
    const name = typeof row.name === 'string' ? row.name.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim() : '';
    if (name) names.set(name, [...(names.get(name) ?? []), row.id]);
  }
  const duplicateIds = new Set([...names.values()].filter(v => v.length > 1).flat());
  const counts = { source: ids.length, eligible: 0, held: 0, suppressed: 0, invalidEmail: 0, notCheckedIn: 0, unknownAttendance: 0, distinctEligibleEmails: 0, sharedEmailRecords: 0 };
  const records = s.records.map(row => {
    fail(row.eventId === s.eventId && id(row.productId), 'attendee source mismatch');
    const reasons = [];
    let category;
    const c = row.checkIn;
    if (c === null) category = 'notCheckedIn';
    else if (!c || !id(c.id) || c.eventId !== s.eventId || c.listId !== s.listId || c.attendeeId !== row.id || !s.admissionProductIds.includes(row.productId)) category = 'unknownAttendance';
    else {
      date(c.checkedInAt);
      if (suppressedEmails.has(normalizedEmail(row.email)) || suppressedIds.has(row.id)) category = 'suppressed';
      else if (!validEmail(row.email)) category = 'invalidEmail';
      else {
        if (duplicateIds.has(row.id)) reasons.push('possible_duplicate_person');
        if (row.ticketStatus !== 'ACTIVE' || row.orderStatus !== 'COMPLETED') reasons.push('changed_ticket_or_order_status');
        category = reasons.length ? 'held' : 'eligible';
      }
    }
    counts[category]++;
    const sourceKey = `${s.source}:${s.eventId}:${row.id}`;
    fail(sourceKey.length <= 300, 'source identity exceeds backend schema');
    return { id: row.id, sourceKey, email: row.email ?? null, category, reasons };
  });
  const eligibleEmails = new Map();
  for (const r of records.filter(r => r.category === 'eligible')) eligibleEmails.set(normalizedEmail(r.email), (eligibleEmails.get(normalizedEmail(r.email)) ?? 0) + 1);
  counts.distinctEligibleEmails = eligibleEmails.size;
  counts.sharedEmailRecords = [...eligibleEmails.values()].filter(n => n > 1).reduce((a, b) => a + b, 0);
  return { kind: 'feedback-audience-plan', snapshotDigest: digest(snapshot), counts, records };
}

const DAY = 86_400_000;
export function prepareSurvey(input) {
  fail(input?.approved === true && id(input.key) && text(input.title) && id(input.version) && text(input.source) && /^\d{4}-\d\d-\d\d$/.test(input.mainDay), 'explicit approved main-day session snapshot required');
  fail(Array.isArray(input.sessions) && input.sessions.length > 0 && input.sessions.every(s => id(s.id) && text(s.title) && s.mainDay === input.mainDay) && new Set(input.sessions.map(s => s.id)).size === input.sessions.length, 'unique approved main-day sessions required');
  const launch = date(input.launchAt);
  return {
    kind: 'feedback-survey-setup', input,
    survey: { key: input.key, title: input.title, version: input.version, open: false, opens_at: launch.toISOString(), closes_at: new Date(+launch + 10 * DAY).toISOString(), sessions: input.sessions.map(({ id, title }) => ({ id, title })) },
    reminderAt: new Date(+launch + 6 * DAY).toISOString(),
  };
}

// No production origin has been verified for this implementation. Add ONLY an
// independently approved exact HTTPS origin here after deployment review.
export const APPROVED_PRODUCTION_ORIGINS = Object.freeze([]);
export const PB_SCHEMA = Object.freeze({ surveys: 'feedback_surveys', invitations: 'feedback_invitations', responses: 'feedback_responses' });
const pbId = value => typeof value === 'string' && /^[a-z0-9]{15}$/.test(value);
function endpoint(pbUrl, productionApply) {
  let url; try { url = new URL(pbUrl); } catch { throw new OperationError('explicit --pb-url required'); }
  fail(!url.username && !url.password && !url.search && !url.hash && url.pathname === '/', 'PocketBase origin only required');
  const loopback = ['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname);
  fail(loopback && ['http:', 'https:'].includes(url.protocol) || url.protocol === 'https:' && APPROVED_PRODUCTION_ORIGINS.includes(url.origin), 'unapproved PocketBase origin');
  return { origin: url.origin, assertWrite() { fail(loopback || productionApply === true, 'production writes require --production-apply'); } };
}

/** All wire-schema assumptions live in this adapter. Never follow redirects. */
export function createPocketBaseAdapter({ pbUrl, authToken, productionApply = false }) {
  const target = endpoint(pbUrl, productionApply);
  fail(typeof authToken === 'string' && authToken.length > 0 && authToken.length < 16384 && !/[\r\n]/.test(authToken), 'FEEDBACK_PB_TOKEN required');
  async function request(collection, suffix = '', method = 'GET', body) {
    fail(Object.values(PB_SCHEMA).includes(collection), 'invalid collection');
    if (method !== 'GET') target.assertWrite();
    let response;
    try {
      response = await fetch(`${target.origin}/api/collections/${collection}/records${suffix}`, { method, redirect: 'error', signal: AbortSignal.timeout(15_000), headers: { Authorization: authToken, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    } catch { throw new OperationError('PocketBase request uncertain; reconcile saved manifest before retry'); }
    if (response.status === 404 && method === 'GET' && suffix.startsWith('/')) return null;
    fail(response.ok, `PocketBase HTTP ${response.status}; remote details redacted`);
    if (method === 'DELETE') return null;
    let payload; try { payload = await response.json(); } catch { throw new OperationError('invalid PocketBase response'); }
    const normalize = row => {
      const fields = collection === PB_SCHEMA.surveys ? ['opens_at', 'closes_at'] : collection === PB_SCHEMA.invitations ? ['expires_at'] : [];
      for (const field of fields) if (typeof row?.[field] === 'string') {
        // PocketBase serializes date fields with a space, unlike input ISO times.
        row[field] = date(row[field].replace(/^(\d{4}-\d\d-\d\d) /, '$1T')).toISOString();
      }
      return row;
    };
    if (Array.isArray(payload?.items)) payload.items = payload.items.map(normalize);
    else normalize(payload);
    return payload;
  }
  async function get(kind, rid) { fail(pbId(rid), 'invalid record ID'); return request(PB_SCHEMA[kind], `/${rid}`); }
  async function list(kind, surveyId) {
    fail(['invitations', 'responses'].includes(kind) && pbId(surveyId), 'exact survey scope required');
    const rows = [], seen = new Set(); let total;
    for (let page = 1; page <= 1000; page++) {
      const query = new URLSearchParams({ page: String(page), perPage: '100', sort: 'id', filter: `survey = "${surveyId}"` });
      const body = await request(PB_SCHEMA[kind], `?${query}`);
      fail(body && Array.isArray(body.items) && body.page === page && body.perPage === 100 && Number.isSafeInteger(body.totalItems) && body.totalItems >= 0 && body.totalPages === Math.ceil(body.totalItems / 100), 'complete PocketBase pagination required');
      fail(total === undefined || total === body.totalItems, 'PocketBase total changed during pagination'); total = body.totalItems;
      fail(body.items.length === Math.min(100, total - rows.length), 'complete PocketBase page required');
      for (const row of body.items) { fail(pbId(row.id) && row.survey === surveyId && !seen.has(row.id), 'unique exact-survey records required'); seen.add(row.id); rows.push(row); }
      if (page >= body.totalPages) { fail(rows.length === total, 'complete PocketBase records required'); return rows; }
    }
    throw new OperationError('PocketBase pagination limit exceeded');
  }
  return {
    origin: target.origin,
    survey: rid => get('surveys', rid),
    invitations: surveyId => list('invitations', surveyId),
    responses: surveyId => list('responses', surveyId),
    invitation: rid => get('invitations', rid),
    createInvitation: value => request(PB_SCHEMA.invitations, '', 'POST', value),
    async deleteRecord(kind, rid, surveyId) {
      fail(['invitations', 'responses'].includes(kind) && pbId(rid) && pbId(surveyId), 'invalid deletion target');
      const before = await get(kind, rid);
      if (before === null) return;
      fail(before.survey === surveyId, 'deletion scope changed');
      // Recovery from a lost DELETE response is a read, never a blind replay.
      try { await request(PB_SCHEMA[kind], `/${rid}`, 'DELETE'); }
      catch (error) { if (await get(kind, rid) !== null) throw error; }
      fail(await get(kind, rid) === null, 'delete readback failed');
    },
  };
}

async function privateDirectory(path) {
  const dir = dirname(resolve(path));
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const info = await lstat(dir);
  fail(info.isDirectory() && !info.isSymbolicLink() && (info.mode & 0o777) === 0o700 && info.uid === process.getuid(), 'private owned 0700 directory required');
  return dir;
}
async function syncDirectory(dir) { const fd = await open(dir, 'r'); try { await fd.sync(); } finally { await fd.close(); } }
export async function readPrivateJson(path) {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await handle.stat();
    fail(info.isFile() && (info.mode & 0o777) === 0o600 && info.uid === process.getuid(), 'private owned 0600 file required');
    return JSON.parse(await handle.readFile('utf8'));
  } finally { await handle.close(); }
}
export async function writePrivateJson(path, value, { replace = false } = {}) {
  const dir = await privateDirectory(path);
  if (!replace) {
    const fd = await open(path, 'wx', 0o600);
    try { await fd.writeFile(`${JSON.stringify(value, null, 2)}\n`); await fd.sync(); } finally { await fd.close(); }
  } else {
    await readPrivateJson(path); // Reject symlinks, public modes, and broken recovery files.
    const temporary = `${path}.${randomBytes(12).toString('hex')}.tmp`;
    const fd = await open(temporary, 'wx', 0o600);
    try { await fd.writeFile(`${JSON.stringify(value, null, 2)}\n`); await fd.sync(); } finally { await fd.close(); }
    await rename(temporary, path);
  }
  await syncDirectory(dir);
}
function manifestKey() {
  const key = process.env.FEEDBACK_MANIFEST_KEY;
  fail(typeof key === 'string' && /^[A-Za-z0-9+/]{43}=$/.test(key) && Buffer.from(key, 'base64').length === 32 && Buffer.from(key, 'base64').toString('base64') === key, 'FEEDBACK_MANIFEST_KEY must be a dedicated 32-byte base64 key');
  return Buffer.from(key, 'base64');
}
export async function readManifest(path) {
  const envelope = await readPrivateJson(path), key = manifestKey();
  fail(envelope.kind === 'feedback-encrypted-manifest' && envelope.version === 1, 'encrypted manifest required');
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.iv, 'base64'));
    decipher.setAAD(Buffer.from('wts-feedback-manifest-v1'));
    decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
    return JSON.parse(Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext, 'base64')), decipher.final()]).toString('utf8'));
  } catch { throw new OperationError('manifest authentication failed; check dedicated key and original file'); }
}
async function writeManifest(path, value, options) {
  const key = manifestKey(), iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from('wts-feedback-manifest-v1'));
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  await writePrivateJson(path, { kind: 'feedback-encrypted-manifest', version: 1, iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), ciphertext: ciphertext.toString('base64') }, options);
}
async function maybeManifest(path) { try { return await readManifest(path); } catch (e) { if (e.code === 'ENOENT') return null; throw e; } }
async function locked(path, action) {
  const dir = await privateDirectory(path), lock = `${path}.lock`;
  let handle; try { handle = await open(lock, 'wx', 0o600); } catch { throw new OperationError('operation lock exists; reconcile before manual unlock'); }
  try { await handle.writeFile(JSON.stringify({ pid: process.pid })); await handle.sync(); return await action(); }
  finally { await handle.close(); await unlink(lock); await syncDirectory(dir); }
}
function validateFrozen(frozen) {
  fail(frozen?.kind === 'feedback-frozen-audience' && digest(freezeAudience(frozen.snapshot, frozen.review)) === digest(frozen), 'frozen audience changed; repeat approval');
}
function validateSetup(setup) {
  fail(setup?.kind === 'feedback-survey-setup' && digest(prepareSurvey(setup.input)) === digest(setup), 'survey setup changed; repeat approval');
}
async function readSurvey(adapter, surveyId, setup) {
  validateSetup(setup);
  const survey = await adapter.survey(surveyId);
  fail(survey && survey.id === surveyId && ['key', 'title', 'version'].every(k => survey[k] === setup.survey[k]) && digest(survey.sessions) === digest(setup.survey.sessions) && +date(survey.opens_at) === +date(setup.survey.opens_at) && +date(survey.closes_at) === +date(setup.survey.closes_at), 'survey differs from approved setup');
  return survey;
}
function invitationPayload(entry, surveyId, expiresAt) {
  return { id: entry.recordId, survey: surveyId, source_key: entry.sourceKey, email: entry.email, token_hash: digest(entry.token), used: false, revoked: false, expires_at: expiresAt };
}
function verifyInvitation(row, entry, surveyId, expiresAt) {
  fail(row && row.id === entry.recordId && row.survey === surveyId && row.source_key === entry.sourceKey && row.email === entry.email && row.token_hash === digest(entry.token) && typeof row.used === 'boolean' && typeof row.revoked === 'boolean' && +date(row.expires_at) === +date(expiresAt), 'existing invitation mismatch; never overwrite or reissue');
}
function validateManifest(manifest, adapter, surveyId) {
  fail(manifest?.kind === 'feedback-issuance-manifest' && manifest.version === 1 && manifest.origin === adapter.origin && manifest.surveyId === surveyId && Array.isArray(manifest.entries), 'manifest scope mismatch');
  fail(new Set(manifest.entries.map(e => e.sourceKey)).size === manifest.entries.length && new Set(manifest.entries.map(e => e.recordId)).size === manifest.entries.length, 'manifest identities must be unique');
  fail(manifest.entries.every(e => pbId(e.recordId) && /^[A-Za-z0-9_-]{43}$/.test(e.token) && validEmail(e.email) && ['planned', 'attempted', 'verified'].includes(e.state)), 'invalid manifest entry');
}

export async function issueInvitations({ adapter, surveyId, setup, frozen, manifestPath, now = new Date().toISOString(), apply = false }) {
  validateFrozen(frozen); validateSetup(setup);
  fail(frozen.snapshot.mainDay === setup.input.mainDay, 'audience/session main-day mismatch');
  await readSurvey(adapter, surveyId, setup);
  fail(+date(now) < +date(setup.survey.closes_at), 'cannot issue after survey closes');
  async function run() {
    let manifest = await maybeManifest(manifestPath);
    const existing = await adapter.invitations(surveyId);
    fail(new Set(existing.map(r => r.source_key)).size === existing.length, 'duplicate remote invitation source identity');
    const frozenDigest = digest(frozen), setupDigest = digest(setup);
    if (manifest) {
      validateManifest(manifest, adapter, surveyId);
      fail(manifest.frozenDigest === frozenDigest && manifest.setupDigest === setupDigest && manifest.entries.length === frozen.audience.length, 'manifest audience/setup changed; no silent refresh');
      fail(manifest.entries.every((e, i) => e.sourceKey === frozen.audience[i].sourceKey && e.email === frozen.audience[i].email), 'manifest audience identity mismatch');
    } else {
      fail(existing.length === 0, 'existing invitation records require original secret manifest; no new run allowed');
      if (!apply) return { dryRun: true, planned: frozen.audience.length, verified: 0 };
      manifest = { kind: 'feedback-issuance-manifest', version: 1, origin: adapter.origin, surveyId, frozenDigest, setupDigest, setup, reminder: null, entries: frozen.audience.map(row => ({ sourceKey: row.sourceKey, attendeeId: row.id, email: row.email, recordId: digest(`${surveyId}:${row.sourceKey}`).slice(0, 15), token: randomBytes(32).toString('base64url'), state: 'planned' })) };
      await writeManifest(manifestPath, manifest); // fsync all secrets BEFORE any remote write.
    }
    const wanted = new Set(manifest.entries.map(e => e.sourceKey));
    fail(existing.every(r => wanted.has(r.source_key)), 'unexpected invitation outside frozen audience');
    let verified = 0;
    for (const entry of manifest.entries) {
      const row = existing.find(r => r.source_key === entry.sourceKey);
      if (row) { verifyInvitation(row, entry, surveyId, setup.survey.closes_at); verified++; if (apply) entry.state = 'verified'; continue; }
      fail(entry.state === 'planned', 'uncertain/missing invitation: manual reconciliation required; refusing another POST');
      if (!apply) continue;
      entry.state = 'attempted';
      await writeManifest(manifestPath, manifest, { replace: true });
      try { await adapter.createInvitation(invitationPayload(entry, surveyId, setup.survey.closes_at)); }
      catch (error) {
        const recovered = await adapter.invitation(entry.recordId);
        if (!recovered) throw error;
        verifyInvitation(recovered, entry, surveyId, setup.survey.closes_at);
      }
      verifyInvitation(await adapter.invitation(entry.recordId), entry, surveyId, setup.survey.closes_at);
      entry.state = 'verified'; verified++;
      await writeManifest(manifestPath, manifest, { replace: true });
    }
    if (apply) await writeManifest(manifestPath, manifest, { replace: true });
    return { dryRun: !apply, planned: manifest.entries.length, verified };
  }
  return apply ? locked(manifestPath, run) : run();
}

export async function prepareDelivery({ adapter, surveyId, manifestPath, suppressions, now, publicOrigin, outputPath, kind = 'initial', apply = false }) {
  fail(['initial', 'reminder'].includes(kind), 'invalid delivery kind');
  const clock = date(now), suppression = validateSuppressions(suppressions);
  const origin = new URL(publicOrigin);
  fail(origin.protocol === 'https:' && !origin.username && !origin.password && origin.pathname === '/' && !origin.search && !origin.hash, 'explicit HTTPS public origin required');
  fail(resolve(outputPath) !== resolve(manifestPath), 'separate private export path required');
  async function run() {
    const manifest = await readManifest(manifestPath);
    validateManifest(manifest, adapter, surveyId);
    const survey = await readSurvey(adapter, surveyId, manifest.setup);
    fail(survey.open === true && +clock >= +date(survey.opens_at) && +clock < +date(survey.closes_at), 'survey must be open for delivery preparation');
    if (kind === 'reminder') fail(+clock >= +date(manifest.setup.reminderAt) && +clock < +date(manifest.setup.reminderAt) + DAY, 'reminder is allowed only on day six');
    const excluded = { used: 0, revoked: 0, suppressed: 0, expired: 0 }, recipients = [];
    // Suppression refresh is additive, never an implicit unsuppression operation.
    const history = [suppression, ...['initial', 'reminder'].flatMap(key => manifest[key]?.suppressions ? [manifest[key].suppressions] : [])];
    const suppressedEmails = new Set(history.flatMap(s => s.emails.map(normalizedEmail)));
    const suppressedIds = new Set(history.flatMap(s => s.attendeeIds));
    const rows = await adapter.invitations(surveyId);
    fail(rows.length === manifest.entries.length, 'delivery requires complete issued cohort');
    for (const entry of manifest.entries) {
      fail(entry.state === 'verified', 'finish issuance reconciliation first');
      const row = rows.find(r => r.source_key === entry.sourceKey);
      verifyInvitation(row, entry, surveyId, manifest.setup.survey.closes_at);
      if (row.used) excluded.used++;
      else if (row.revoked) excluded.revoked++;
      else if (suppressedEmails.has(normalizedEmail(entry.email)) || suppressedIds.has(entry.attendeeId)) excluded.suppressed++;
      else if (+clock >= +date(row.expires_at)) excluded.expired++;
      else recipients.push({ email: entry.email, url: `${origin.origin}/feedback#token=${entry.token}` });
    }
    const previous = manifest[kind];
    if (previous) {
      fail(previous.outputPath === resolve(outputPath), 'delivery already prepared at a different path');
      // Never recreate an already-prepared plaintext export after deletion.
      if (previous.state === 'prepared') return { dryRun: !apply, planned: previous.count, alreadyPrepared: true, sent: false };
    }
    if (!apply) return { dryRun: true, planned: recipients.length, excluded, sent: false };
    const payload = { kind: 'feedback-private-delivery', surveyId, origin: adapter.origin, deliveryKind: kind, sent: false, recipients };
    if (!previous) {
      manifest[kind] = { outputPath: resolve(outputPath), state: 'planned', count: recipients.length, payloadDigest: digest(payload), suppressions: suppression };
      await writeManifest(manifestPath, manifest, { replace: true });
    } else fail(previous.payloadDigest === digest(payload) && digest(previous.suppressions) === digest(suppression), 'pending export changed; manual reconciliation required');
    let existing; try { existing = await readPrivateJson(outputPath); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (existing) fail(digest(existing) === digest(payload), 'existing private export differs');
    else await writePrivateJson(outputPath, payload);
    manifest[kind].state = 'prepared';
    await writeManifest(manifestPath, manifest, { replace: true });
    return { dryRun: false, planned: recipients.length, excluded, sent: false };
  }
  return apply ? locked(manifestPath, run) : run();
}

export function retentionDeadline(closesAt, target) {
  fail(['invitations', 'responses'].includes(target), 'explicit retention target required');
  const close = date(closesAt);
  if (target === 'invitations') return new Date(+close + 30 * DAY).toISOString();
  const end = new Date(close), month = end.getUTCMonth();
  end.setUTCFullYear(end.getUTCFullYear() + 1);
  if (end.getUTCMonth() !== month) end.setUTCDate(0); // Feb 29 -> Feb 28, not March 1.
  return end.toISOString();
}

export async function retainFeedback({ adapter, surveyId, setup, target, manifestPath, now, apply = false }) {
  const clock = date(now);
  const survey = await readSurvey(adapter, surveyId, setup);
  const dueAt = retentionDeadline(survey.closes_at, target);
  fail(!apply || +clock >= +date(dueAt), 'retention not due');
  fail(target !== 'invitations' || typeof manifestPath === 'string', 'invitation retention requires original secret manifest');
  async function run() {
    const manifest = target === 'invitations' ? await readManifest(manifestPath) : null;
    if (manifest) { validateManifest(manifest, adapter, surveyId); fail(manifest.setupDigest === digest(setup), 'retention setup mismatch'); }
    const rows = await adapter[target](surveyId);
    // No response/invitation join, even during deletion.
    const exports = manifest ? ['initial', 'reminder'].flatMap(kind => manifest[kind] ? [{ ...manifest[kind], kind }] : []) : [];
    for (const entry of exports) {
      let payload; try { payload = await readPrivateJson(entry.outputPath); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      if (payload) fail(payload.kind === 'feedback-private-delivery' && payload.surveyId === surveyId && payload.origin === adapter.origin && digest(payload) === entry.payloadDigest, 'cleanup export changed; review exact local target');
    }
    if (!apply) return { dryRun: true, dueAt, due: +clock >= +date(dueAt), planned: rows.length, secretFiles: manifest ? 1 + exports.length : 0 };
    for (const row of rows) await adapter.deleteRecord(target, row.id, surveyId);
    fail((await adapter[target](surveyId)).length === 0, 'retention verification failed; keep manifest for recovery');
    if (manifest) {
      for (const entry of exports) {
        try { await unlink(entry.outputPath); await syncDirectory(dirname(entry.outputPath)); }
        catch (error) { if (error.code !== 'ENOENT') throw error; }
      }
      await unlink(manifestPath); await syncDirectory(dirname(resolve(manifestPath)));
    }
    return { dryRun: false, dueAt, deleted: rows.length, secretsDeleted: manifest !== null };
  }
  return apply && target === 'invitations' ? locked(manifestPath, run) : run();
}

// Whitelisted export contract; intentionally no record IDs, dates, or joins.
// Keep these option IDs aligned with src/lib/feedback-contract.ts.
const PARTS = ['content', 'organisation', 'venue', 'connections'];
const MORE = ['technical', 'case_studies', 'demos', 'discussion', 'beginner', 'workshops', 'meeting', 'other'];
const rating = n => Number.isInteger(n) && n >= 1 && n <= 5;
function exportAnswers(value, sessions) {
  fail(value && rating(value.overall) && value.parts && typeof value.parts === 'object' && Array.isArray(value.more) && value.more.every(s => MORE.includes(s)) && new Set(value.more).size === value.more.length && Array.isArray(value.sessions), 'invalid response answers; export refused');
  fail(['keep', 'change', 'moreOther'].every(k => typeof value[k] === 'string') && Object.keys(value.parts).every(k => PARTS.includes(k)), 'invalid response fields; export refused');
  const parts = {};
  for (const key of PARTS) if (value.parts[key] !== undefined) { fail(rating(value.parts[key]) || value.parts[key] === 'na', 'invalid optional rating'); parts[key] = value.parts[key]; }
  fail(new Set(value.sessions.map(s => s.sessionId)).size === value.sessions.length, 'duplicate session feedback');
  return { overall: value.overall, parts, keep: value.keep, change: value.change, more: [...value.more], moreOther: value.moreOther, sessions: value.sessions.map(s => {
    fail(sessions.some(session => session.id === s.sessionId) && (s.usefulness === undefined || rating(s.usefulness)) && typeof s.comment === 'string', 'unknown or invalid session feedback');
    return { sessionId: s.sessionId, ...(s.usefulness === undefined ? {} : { usefulness: s.usefulness }), comment: s.comment };
  }) };
}
function ratingSummary(values) {
  const numeric = values.filter(rating);
  return { rated: numeric.length, notApplicable: values.filter(v => v === 'na').length, skipped: values.filter(v => v === undefined).length, mean: numeric.length ? numeric.reduce((a, b) => a + b, 0) / numeric.length : null };
}
export async function exportResults({ adapter, surveyId, setup, outputPath, includeRaw = false, apply = false }) {
  const survey = await readSurvey(adapter, surveyId, setup);
  const rows = await adapter.responses(surveyId); // Never reads invitations.
  fail(rows.every(r => r.version === survey.version), 'mixed response versions; export refused');
  const records = rows.map(r => exportAnswers(r.answers, survey.sessions));
  const aggregate = {
    responses: records.length,
    overall: ratingSummary(records.map(r => r.overall)),
    parts: Object.fromEntries(PARTS.map(key => [key, ratingSummary(records.map(r => r.parts[key]))])),
    textAnswered: Object.fromEntries(['keep', 'change', 'moreOther'].map(key => [key, { answered: records.filter(r => r[key].trim()).length, denominator: records.length }])),
    more: { answered: records.filter(r => r.more.length).length, denominator: records.length, counts: Object.fromEntries(MORE.map(key => [key, records.filter(r => r.more.includes(key)).length])) },
    sessions: survey.sessions.map(session => {
      const values = records.map(r => r.sessions.find(s => s.sessionId === session.id)?.usefulness);
      const summary = ratingSummary(values);
      return summary.rated < 5 ? { sessionId: session.id, withheld: true } : { sessionId: session.id, withheld: false, ...summary };
    }),
  };
  if (!apply) return { dryRun: true, responses: records.length, rawIncluded: includeRaw };
  // Fisher-Yates destroys database traversal order; export carries no source ID.
  for (let i = records.length - 1; i > 0; i--) { const j = randomInt(i + 1); [records[i], records[j]] = [records[j], records[i]]; }
  await writePrivateJson(outputPath, { kind: 'feedback-private-results', access: 'organizer-only-not-public', surveyVersion: survey.version, aggregate, ...(includeRaw ? { records } : {}) });
  return { dryRun: false, responses: records.length, rawIncluded: includeRaw };
}

const HELP = `Feedback organizer operations (dry-run by default). No mail sending or cron.
  prepare  --input SNAPSHOT --out PLAN
  freeze   --input SNAPSHOT --review REVIEW --out FROZEN
  setup    --input APPROVED_SESSIONS --out SETUP
  issue    --pb-url ORIGIN --survey ID --setup SETUP --audience FROZEN --manifest FILE
  delivery --pb-url ORIGIN --survey ID --manifest FILE --suppressions FILE --public-origin ORIGIN --out FILE
  reminder --pb-url ORIGIN --survey ID --manifest FILE --suppressions FILE --public-origin ORIGIN --out FILE
  retain   --pb-url ORIGIN --survey ID --setup SETUP --target invitations|responses [--manifest FILE]
  export   --pb-url ORIGIN --survey ID --setup SETUP --out FILE [--include-raw]
Every command defaults to dry-run; add --apply only after reviewing counts.
Private files: owned 0600, output directories: owned 0700.
Dedicated environment only: FEEDBACK_PB_TOKEN, FEEDBACK_MANIFEST_KEY (32-byte base64).
--now ISO is a loopback-only test clock; remote production clocks cannot be overridden.
Production remains blocked until an exact approved origin is pinned in this script.
See docs/wts-feedback-operations.md for input contracts and retention obligations.`;
const COMMAND_FLAGS = {
  prepare: ['input', 'out'], freeze: ['input', 'review', 'out'], setup: ['input', 'out'],
  issue: ['pb-url', 'survey', 'setup', 'audience', 'manifest', 'now', 'production-apply'],
  delivery: ['pb-url', 'survey', 'manifest', 'suppressions', 'public-origin', 'out', 'now', 'production-apply'],
  reminder: ['pb-url', 'survey', 'manifest', 'suppressions', 'public-origin', 'out', 'now', 'production-apply'],
  retain: ['pb-url', 'survey', 'setup', 'target', 'manifest', 'now', 'production-apply'],
  export: ['pb-url', 'survey', 'setup', 'out', 'include-raw', 'production-apply'],
};
export async function runCli(argv) {
  if (argv.length === 0 || argv.length === 1 && argv[0] === '--help') return HELP;
  const [command, ...args] = argv;
  fail(Object.hasOwn(COMMAND_FLAGS, command), 'unknown feedback command; use --help');
  const flags = {}, allowed = new Set([...COMMAND_FLAGS[command], 'apply', 'dry-run']);
  const booleans = new Set(['apply', 'dry-run', 'production-apply', 'include-raw']);
  for (let i = 0; i < args.length; i++) {
    const key = args[i].startsWith('--') ? args[i].slice(2) : '';
    fail(allowed.has(key) && !Object.hasOwn(flags, key), 'unknown or duplicate option; use --help');
    if (booleans.has(key)) flags[key] = true;
    else { fail(typeof args[i + 1] === 'string' && !args[i + 1].startsWith('--'), 'option value required'); flags[key] = args[++i]; }
  }
  fail(!(flags.apply && flags['dry-run']) && (!flags['production-apply'] || flags.apply), 'contradictory apply flags');
  const need = key => { fail(typeof flags[key] === 'string', 'required option missing; use --help'); return flags[key]; };
  const apply = flags.apply === true;
  if (['prepare', 'freeze', 'setup'].includes(command)) {
    const input = await readPrivateJson(need('input')), output = need('out');
    const value = command === 'prepare' ? prepareAudience(input) : command === 'freeze' ? freezeAudience(input, await readPrivateJson(need('review'))) : prepareSurvey(input);
    if (apply) await writePrivateJson(output, value);
    return { dryRun: !apply, ...(command === 'setup' ? { sessions: value.survey.sessions.length, closesAt: value.survey.closes_at, reminderAt: value.reminderAt } : { counts: value.counts, ...(value.snapshotDigest ? { snapshotDigest: value.snapshotDigest } : {}) }) };
  }
  const adapter = createPocketBaseAdapter({ pbUrl: need('pb-url'), authToken: process.env.FEEDBACK_PB_TOKEN, productionApply: flags['production-apply'] === true });
  if (flags.now) fail(['127.0.0.1', '[::1]', 'localhost'].includes(new URL(adapter.origin).hostname), 'clock override only allowed for disposable loopback tests');
  const shared = { adapter, surveyId: need('survey'), apply, now: flags.now ?? new Date().toISOString() };
  if (command === 'issue') return issueInvitations({ ...shared, setup: await readPrivateJson(need('setup')), frozen: await readPrivateJson(need('audience')), manifestPath: need('manifest') });
  if (['delivery', 'reminder'].includes(command)) return prepareDelivery({ ...shared, manifestPath: need('manifest'), suppressions: await readPrivateJson(need('suppressions')), publicOrigin: need('public-origin'), outputPath: need('out'), kind: command === 'reminder' ? 'reminder' : 'initial' });
  if (command === 'retain') return retainFeedback({ ...shared, setup: await readPrivateJson(need('setup')), target: need('target'), manifestPath: flags.manifest });
  return exportResults({ ...shared, setup: await readPrivateJson(need('setup')), outputPath: need('out'), includeRaw: flags['include-raw'] === true });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  runCli(process.argv.slice(2)).then(result => console.log(typeof result === 'string' ? result : JSON.stringify(result))).catch(error => {
    // Native errors may quote malformed JSON, filenames, contacts, or secrets.
    console.error(error instanceof OperationError ? error.message : 'Feedback operation failed; private input/target verification required. Details redacted.');
    process.exitCode = 1;
  });
}

export function freezeAudience(snapshot, review) {
  const plan = prepareAudience(snapshot);
  fail(review?.approved === true && review.snapshotDigest === plan.snapshotDigest && review.decisions && typeof review.decisions === 'object', 'matching explicit audience review required');
  const held = new Set(plan.records.filter(r => r.category === 'held').map(r => r.id));
  fail(Object.keys(review.decisions).every(key => held.has(key)) && [...held].every(key => ['include', 'exclude'].includes(review.decisions[key])), 'every held exception requires review');
  const audience = plan.records.filter(r => r.category === 'eligible' || r.category === 'held' && review.decisions[r.id] === 'include');
  return { kind: 'feedback-frozen-audience', version: 1, snapshot, review, counts: { ...plan.counts, approved: audience.length, reviewedExcluded: [...held].filter(key => review.decisions[key] === 'exclude').length, distinctApprovedEmails: new Set(audience.map(r => normalizedEmail(r.email))).size }, audience };
}
