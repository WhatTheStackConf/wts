import { afterAll, beforeAll, describe, expect, it } from 'vite-plus/test';
import PocketBase from 'pocketbase';
import { handleLiveQaRequest } from './live-qa-http';
import type { LiveQaQuestion, LiveQaRequest, LiveQaSession } from './live-qa-contract';
import { startLiveQaPocketBase } from './live-qa-pocketbase-test-helper';

const send = <T>(client: PocketBase, body: LiveQaRequest) => client.send<T>('/api/wts/live-qa', { method: 'POST', body });

describe('live Q&A real PocketBase API', () => {
  let fixture: Awaited<ReturnType<typeof startLiveQaPocketBase>>;
  beforeAll(async () => { fixture = await startLiveQaPocketBase(); }, 30_000);
  afterAll(async () => { await fixture?.cleanup(); });

  it('accepts a trimmed private question during its canonical published Agenda Slot', async () => {
    const { client } = await fixture.user();
    const { slug, session } = await fixture.session();
    const before = await send<LiveQaSession>(client, { operation: 'session', slug, page: 1 });
    expect(before).toMatchObject({ sessionId: session.id, slug, mode: 'auto', accepting: true, canModerate: false, questions: [], page: 1 });
    const result = await send<{ question: LiveQaQuestion }>(client, { operation: 'ask', slug, body: '  Why?  ', requestId: crypto.randomUUID() });
    expect(result.question).toMatchObject({ body: 'Why?', answered: false, own: true });
    expect(Object.keys(result.question).sort()).toEqual(['answered', 'body', 'created', 'id', 'own']);
    const after = await send<LiveQaSession>(client, { operation: 'session', slug, page: 1 });
    expect(after.questions).toEqual([result.question]);
  });

  it('only authors and live MC/admin users see questions; moderators explicitly set modes and answers', async () => {
    const alice = await fixture.user();
    const bob = await fixture.user();
    const mc = await fixture.user('mc');
    const admin = await fixture.user('admin');
    const { slug } = await fixture.session();
    const { slug: otherSlug } = await fixture.session();
    const { question } = await send<{ question: LiveQaQuestion }>(alice.client, { operation: 'ask', slug, body: 'Private thought', requestId: crypto.randomUUID() });
    expect((await send<LiveQaSession>(bob.client, { operation: 'session', slug, page: 1 })).questions).toEqual([]);
    for (const moderator of [mc, admin]) {
      const view = await send<LiveQaSession>(moderator.client, { operation: 'session', slug, page: 1 });
      expect(view.questions).toEqual([{ ...question, answered: moderator === admin, own: false }]);
      expect(JSON.stringify(view)).not.toContain(alice.record.id);
      expect(JSON.stringify(view)).not.toContain(alice.record.email);
      expect(await send(moderator.client, { operation: 'answer', slug, questionId: question.id, answered: true })).toEqual({ ok: true });
    }
    await expect(send(mc.client, { operation: 'answer', slug: otherSlug, questionId: question.id, answered: false })).rejects.toMatchObject({ status: 404 });
    await expect(send(bob.client, { operation: 'mode', slug, mode: 'open' })).rejects.toMatchObject({ status: 403 });
    await expect(send(alice.client, { operation: 'answer', slug, questionId: question.id, answered: false })).rejects.toMatchObject({ status: 403 });
    expect((await send<LiveQaSession>(alice.client, { operation: 'session', slug, page: 1 })).questions[0].answered).toBe(true);
    expect(await send(mc.client, { operation: 'answer', slug, questionId: question.id, answered: false })).toEqual({ ok: true });
    expect((await send<LiveQaSession>(alice.client, { operation: 'session', slug, page: 1 })).questions[0].answered).toBe(false);
    await fixture.pb.collection('users').update(mc.record.id, { role: 'user' });
    expect((await send<LiveQaSession>(mc.client, { operation: 'session', slug, page: 1 })).questions).toEqual([]);
    await expect(send(mc.client, { operation: 'mode', slug, mode: 'open' })).rejects.toMatchObject({ status: 403 });
    await expect(send(mc.client, { operation: 'catalogue', search: '', page: 1 })).rejects.toMatchObject({ status: 403 });
    await fixture.pb.collection('users').update(alice.record.id, { verified: false });
    await expect(send(alice.client, { operation: 'session', slug, page: 1 })).rejects.toMatchObject({ status: 403 });
  });

  it('replays one UUID transactionally after answer, close and restart; rejects changed payload and enforces author-wide cooldown', async () => {
    const alice = await fixture.user();
    const bob = await fixture.user();
    const mc = await fixture.user('mc');
    const { slug } = await fixture.session();
    const { slug: otherSlug } = await fixture.session();
    const request = { operation: 'ask' as const, slug, body: '  Replay me  ', requestId: crypto.randomUUID() };
    const results = await Promise.all(Array.from({ length: 6 }, () => send<{ question: LiveQaQuestion }>(alice.client, request)));
    for (const result of results) expect(result).toEqual(results[0]);
    await expect(send(alice.client, { ...request, body: 'Replay me' })).rejects.toMatchObject({ status: 409 });
    await expect(send(alice.client, { ...request, slug: otherSlug })).rejects.toMatchObject({ status: 409 });
    await expect(send(alice.client, { ...request, slug: otherSlug, requestId: crypto.randomUUID() })).rejects.toMatchObject({ status: 429 });
    const bobsReply = await send<{ question: LiveQaQuestion }>(bob.client, request);
    expect(bobsReply.question.id).not.toBe(results[0].question.id);
    await send(mc.client, { operation: 'answer', slug, questionId: results[0].question.id, answered: true });
    await send(mc.client, { operation: 'mode', slug, mode: 'closed' });
    expect(await send(alice.client, request)).toEqual(results[0]);
    await fixture.restart();
    expect(await send(alice.client, request)).toEqual(results[0]);
    const view = await send<LiveQaSession>(alice.client, { operation: 'session', slug, page: 1 });
    expect(view.questions).toEqual([{ ...results[0].question, answered: true }]);
    expect(view.accepting).toBe(false);
  });

  it('uses canonical future/ended times, supports all override modes and keeps ended queues readable', async () => {
    const attendee = await fixture.user();
    const mc = await fixture.user('mc');
    const future = await fixture.session({ startAt: new Date(Date.now() + 3_600_000).toISOString() });
    await fixture.pb.collection('sessions').update(future.session.id, { starts_at: new Date(Date.now() - 60_000).toISOString() });
    const read = () => send<LiveQaSession>(attendee.client, { operation: 'session', slug: future.slug, page: 1 });
    expect(await read()).toMatchObject({ accepting: false, startAt: future.startAt, endAt: future.endAt, mode: 'auto' });
    const ask = { operation: 'ask' as const, slug: future.slug, body: 'Delayed talk', requestId: crypto.randomUUID() };
    await expect(send(attendee.client, ask)).rejects.toMatchObject({ status: 409 });
    for (const mode of ['open', 'closed', 'auto', 'open'] as const) {
      expect(await send(mc.client, { operation: 'mode', slug: future.slug, mode })).toEqual({ ok: true });
      expect(await read()).toMatchObject({ mode, accepting: mode === 'open' });
    }
    await send(attendee.client, ask);
    const ended = await fixture.session({ startAt: new Date(Date.now() - 3_600_000).toISOString(), endAt: new Date(Date.now() - 1).toISOString() });
    const endedAuthor = await fixture.user();
    const readEnded = () => send<LiveQaSession>(endedAuthor.client, { operation: 'session', slug: ended.slug, page: 1 });
    expect((await readEnded()).accepting).toBe(false);
    await send(mc.client, { operation: 'mode', slug: ended.slug, mode: 'open' });
    expect((await readEnded()).accepting).toBe(true);
    const result = await send<{ question: LiveQaQuestion }>(endedAuthor.client, { operation: 'ask', slug: ended.slug, body: 'Overrunning talk', requestId: crypto.randomUUID() });
    await send(mc.client, { operation: 'mode', slug: ended.slug, mode: 'auto' });
    expect(await readEnded()).toMatchObject({ accepting: false, questions: [result.question] });
  });

  it('honors publication gates and the unmodified coordinated publication validation hooks', async () => {
    const attendee = await fixture.user();
    const mc = await fixture.user('mc');
    const draft = await fixture.session({ published: false });
    await expect(send(attendee.client, { operation: 'session', slug: draft.slug, page: 1 })).rejects.toMatchObject({ status: 404 });
    await expect(send(mc.client, { operation: 'mode', slug: draft.slug, mode: 'open' })).rejects.toMatchObject({ status: 404 });
    // A published Session without a published Slot is never automatically accepting.
    await fixture.pb.collection('sessions').update(draft.session.id, { published: true, starts_at: new Date(Date.now() - 60_000).toISOString() });
    expect(await send(attendee.client, { operation: 'session', slug: draft.slug, page: 1 })).toMatchObject({ accepting: false, startAt: null, endAt: null });
    await send(mc.client, { operation: 'mode', slug: draft.slug, mode: 'open' });
    expect(await send(attendee.client, { operation: 'session', slug: draft.slug, page: 1 })).toMatchObject({ accepting: false });
    await fixture.pb.collection('conference_days').update(draft.day.id, { published: false });
    await expect(draft.publish(true)).rejects.toMatchObject({ status: 400 });
    await fixture.pb.collection('conference_days').update(draft.day.id, { published: true });
    await fixture.pb.collection('appearance_events').update(draft.appearanceEvent.id, { published: false });
    await expect(draft.publish(true)).rejects.toMatchObject({ status: 400 });
    await fixture.pb.collection('appearance_events').update(draft.appearanceEvent.id, { published: true });
    await draft.publish(true);
    expect(await send(attendee.client, { operation: 'session', slug: draft.slug, page: 1 })).toMatchObject({ accepting: true });
    for (const [collection, id] of [['conference_days', draft.day.id], ['appearance_events', draft.appearanceEvent.id], ['sessions', draft.session.id], ['agenda_slots', draft.slot.id]]) {
      await expect(fixture.pb.collection(collection).update(id, { published: false })).rejects.toMatchObject({ status: 400 });
    }
    await draft.publish(false);
    await expect(send(attendee.client, { operation: 'session', slug: draft.slug, page: 1 })).rejects.toMatchObject({ status: 404 });
  });

  it('provides bounded searchable MC catalogue pages without draft sessions or private fields', async () => {
    const mc = await fixture.user('mc');
    const prefix = `catalogue-${crypto.randomUUID()}`;
    for (let i = 0; i < 52; i++) await fixture.pb.collection('sessions').create({ slug: `${prefix}-${String(i).padStart(2, '0')}`, title: `Catalogue ${String(i).padStart(2, '0')}`, abstract: 'Synthetic', published: true });
    await fixture.pb.collection('sessions').create({ slug: `${prefix}-draft`, title: 'Draft sentinel', abstract: 'Private sentinel', published: false });
    const first = await send<{ items: { slug: string; title: string }[]; page: number; totalPages: number }>(mc.client, { operation: 'catalogue', search: prefix, page: 1 });
    const second = await send<typeof first>(mc.client, { operation: 'catalogue', search: prefix, page: 2 });
    expect(first.items).toHaveLength(50);
    expect(second.items).toHaveLength(2);
    expect(first).toMatchObject({ page: 1, totalPages: 2 });
    expect(second).toMatchObject({ page: 2, totalPages: 2 });
    expect(new Set([...first.items, ...second.items].map(item => item.slug)).size).toBe(52);
    expect(first.items[0]).toEqual({ slug: `${prefix}-00`, title: 'Catalogue 00' });
    expect(second.items[1]).toEqual({ slug: `${prefix}-51`, title: 'Catalogue 51' });
    expect((await send<typeof first>(mc.client, { operation: 'catalogue', search: 'Catalogue 51', page: 1 })).items).toEqual([{ slug: `${prefix}-51`, title: 'Catalogue 51' }]);
    expect((await send<typeof first>(mc.client, { operation: 'catalogue', search: `" || published = false || title ~ "`, page: 1 })).items).toEqual([]);
    expect((await send<typeof first>(mc.client, { operation: 'catalogue', search: '%', page: 1 })).items).toEqual([]);
    expect((await send<typeof first>(mc.client, { operation: 'catalogue', search: prefix, page: 3 })).items).toEqual([]);
    const literal = { slug: `literal-${prefix}`, title: '100% tested_under pressure' };
    await fixture.pb.collection('sessions').create({ ...literal, abstract: 'Synthetic', published: true });
    for (const search of ['%', '_', '100%', 'tested_under']) {
      const result = await send<typeof first>(mc.client, { operation: 'catalogue', search, page: 1 });
      expect(result.items).toEqual([literal]);
      expect(result.totalPages).toBe(1);
    }
    const all = await send<typeof first>(mc.client, { operation: 'catalogue', search: '', page: 1 });
    expect(all.items).toHaveLength(50);
    expect(all.items).toContainEqual(literal);
  }, 15_000);

  it('locks direct records and prevents self-granted MC authority', async () => {
    const alice = await fixture.user();
    const mc = await fixture.user('mc');
    const talk = await fixture.session();
    const { question } = await send<{ question: LiveQaQuestion }>(alice.client, { operation: 'ask', slug: talk.slug, body: 'Private record sentinel', requestId: crypto.randomUUID() });
    for (const client of [new PocketBase(fixture.baseUrl), alice.client, mc.client]) {
      for (const collection of ['live_qa_questions', 'live_qa_controls']) {
        await expect(client.collection(collection).getList()).rejects.toMatchObject({ status: 403 });
        await expect(client.collection(collection).create({ session: talk.session.id, author: alice.record.id, body: 'Forged', mode: 'open' })).rejects.toMatchObject({ status: 403 });
      }
      await expect(client.collection('live_qa_questions').getOne(question.id)).rejects.toMatchObject({ status: 403 });
      await expect(client.collection('live_qa_questions').update(question.id, { answered: true })).rejects.toMatchObject({ status: 403 });
      await expect(client.collection('live_qa_questions').delete(question.id)).rejects.toMatchObject({ status: 403 });
    }
    await expect(alice.client.collection('users').update(alice.record.id, { role: 'mc' })).rejects.toMatchObject({ status: 404 });
    expect((await alice.client.collection('users').authRefresh()).record.role).toBe('user');
    await expect(new PocketBase(fixture.baseUrl).collection('users').create({ email: `${crypto.randomUUID()}@example.test`, password: fixture.password, passwordConfirm: fixture.password, role: 'mc' })).rejects.toMatchObject({ status: 400 });
    const after = await send<LiveQaSession>(mc.client, { operation: 'session', slug: talk.slug, page: 1 });
    expect(after.questions).toEqual([{ ...question, own: false }]);
  });

  it('validates text, UUIDs and privileged fields without accepting forged identities', async () => {
    const alice = await fixture.user();
    const talk = await fixture.session();
    const valid = { operation: 'ask' as const, slug: talk.slug, body: 'Question', requestId: crypto.randomUUID() };
    const invalid = [
      { ...valid, body: '   ' }, { ...valid, body: 'x'.repeat(1001) }, { ...valid, body: 1 },
      { ...valid, requestId: 'invalid' }, { ...valid, author: alice.record.id },
      { operation: 'session', slug: talk.slug, page: 0 },
      { operation: 'session', slug: talk.slug, page: 1, canModerate: true },
    ];
    for (const body of invalid) await expect(alice.client.send('/api/wts/live-qa', { method: 'POST', body })).rejects.toMatchObject({ status: 400 });
    const unicode = await send<{ question: LiveQaQuestion }>(alice.client, { ...valid, body: '🐉'.repeat(1000) });
    expect(unicode.question.body).toBe('🐉'.repeat(1000));
    const anonymous = new PocketBase(fixture.baseUrl);
    await expect(send(anonymous, { operation: 'session', slug: talk.slug, page: 1 })).rejects.toMatchObject({ status: 401 });
    expect((await send<LiveQaSession>(alice.client, { operation: 'session', slug: talk.slug, page: 1 })).questions).toHaveLength(1);
  });

  it('serves the cookie HTTP adapter with fresh authority and private no-store responses', async () => {
    const alice = await fixture.user();
    const bob = await fixture.user();
    const mc = await fixture.user('mc');
    const talk = await fixture.session();
    const origin = 'https://wts.example.test';
    const request = (client: PocketBase, body: LiveQaRequest, requestOrigin = origin, expectedActor = client.authStore.record!.id) => {
      // Even a forged embedded admin role is not trusted: token refresh is mandatory.
      const cookie = `pb_auth=${encodeURIComponent(JSON.stringify({ token: client.authStore.token, record: { id: alice.record.id, role: 'admin', verified: true } }))}`;
      return handleLiveQaRequest(new Request(`${origin}/api/live-qa`, { method: 'POST', headers: { origin: requestOrigin, cookie, 'content-type': 'application/json', 'x-wts-qa-user': expectedActor }, body: JSON.stringify(body) }), fixture.baseUrl);
    };
    const ask = { operation: 'ask' as const, slug: talk.slug, body: 'Real HTTP private question', requestId: crypto.randomUUID() };
    const created = await request(alice.client, ask);
    expect(created.status).toBe(200);
    expect(created.headers.get('cache-control')).toBe('private, no-store');
    expect(await created.json()).toMatchObject({ question: { body: ask.body, own: true } });
    const read = { operation: 'session' as const, slug: talk.slug, page: 1 };
    expect(await (await request(bob.client, read)).json()).toMatchObject({ canModerate: false, questions: [] });
    expect(await (await request(mc.client, read)).json()).toMatchObject({ canModerate: true, questions: [{ body: ask.body, own: false }] });
    expect((await request(alice.client, { operation: 'catalogue', page: 1, search: '' })).status).toBe(403);
    expect((await request(alice.client, ask, 'https://attacker.example')).status).toBe(403);
    expect((await request(bob.client, ask, origin, alice.record.id)).status).toBe(403);
    expect((await request(bob.client, read, origin, alice.record.id)).status).toBe(403);
    expect((await request(bob.client, read, origin, '')).status).toBe(403);
    expect((await send<LiveQaSession>(bob.client, read)).questions).toEqual([]);
    await fixture.pb.collection('users').update(mc.record.id, { role: 'user' });
    expect(await (await request(mc.client, read)).json()).toMatchObject({ canModerate: false, questions: [] });
    await fixture.pb.collection('users').update(alice.record.id, { verified: false });
    expect((await request(alice.client, read)).status).toBe(401);
  });

  it('pages oldest-first private question queues with a stable tie-breaker and private counts', async () => {
    const alice = await fixture.user();
    const bob = await fixture.user();
    const mc = await fixture.user('mc');
    const { slug, session } = await fixture.session();
    // Seed stored questions rather than new asks through the public cooldown.
    // PB autodates ignore REST-supplied created values, even for superusers.
    // Increasing IDs give same-millisecond creations a known stable tie-breaker.
    for (let i = 0; i < 103; i++) await fixture.pb.collection('live_qa_questions').create({ id: String(i).padStart(15, '0'), session: session.id, author: i < 51 ? alice.record.id : bob.record.id, body: `Historical ${String(i).padStart(3, '0')}`, answered: false, request_id: crypto.randomUUID(), request_payload: { fixture: true }, request_reply: { fixture: true } });
    const page = (client: PocketBase, page: number) => send<LiveQaSession>(client, { operation: 'session', slug, page });
    const a1 = await page(alice.client, 1);
    const a2 = await page(alice.client, 2);
    expect(a1.questions).toHaveLength(50);
    expect(a2.questions.map(q => q.body)).toEqual(['Historical 050']);
    expect(a1.totalPages).toBe(2);
    expect(a1.questions.every(q => q.own)).toBe(true);
    const queues = await Promise.all([page(mc.client, 1), page(mc.client, 2), page(mc.client, 3)]);
    expect(queues.map(q => q.questions.length)).toEqual([50, 50, 3]);
    expect(queues.every(q => q.totalPages === 3)).toBe(true);
    const bodies = queues.flatMap(q => q.questions.map(item => item.body));
    expect(bodies).toEqual(Array.from({ length: 103 }, (_, i) => `Historical ${String(i).padStart(3, '0')}`));
    expect((await page(alice.client, 3)).questions).toEqual([]);
    expect((await page(bob.client, 1)).questions[0].body).toBe('Historical 051');
  }, 15_000);
});
