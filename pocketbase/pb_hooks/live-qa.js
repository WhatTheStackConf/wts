/// <reference path="../pb_data/types.d.ts" />
// CommonJS module: required inside the route because JSVM handlers have isolated scope.
function fail(status, message) { throw new ApiError(status, message); }
function rows(app, collection, filter, sort, limit, offset, params) {
  return app.findRecordsByFilter(collection, filter, sort || '', limit || 1, offset || 0, params || {});
}
function instant(value) {
  if (!value) return null;
  const parsed = new Date(value.replace(' ', 'T'));
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}
function question(record, actor) {
  return { id: record.id, body: record.getString('body'), answered: record.getBool('answered'), created: instant(record.getString('created')), own: record.getString('author') === actor.id };
}
function actorFor(app, auth) {
  if (!auth || auth.collection().name !== 'users') fail(401, 'Sign in to use live Q&A.');
  const actors = rows(app, 'users', 'id = {:id}', '', 1, 0, { id: auth.id });
  if (!actors.length || !actors[0].getBool('verified')) fail(403, 'A verified User is required.');
  return actors[0];
}
function validate(body) {
  const fields = {
    session: ['operation', 'slug', 'page'], catalogue: ['operation', 'page', 'search'],
    ask: ['operation', 'slug', 'body', 'requestId'], mode: ['operation', 'slug', 'mode'],
    answer: ['operation', 'slug', 'questionId', 'answered'],
  };
  if (!body || typeof body !== 'object' || Array.isArray(body) || !Object.prototype.hasOwnProperty.call(fields, body.operation)) fail(400, 'Invalid live Q&A operation.');
  const keys = fields[body.operation];
  if (Object.keys(body).length !== keys.length || !keys.every(key => Object.prototype.hasOwnProperty.call(body, key))) fail(400, 'Unexpected or missing live Q&A fields.');
  if ('slug' in body && (typeof body.slug !== 'string' || !body.slug.trim() || body.slug.length > 2000)) fail(400, 'Invalid Session slug.');
  if ('page' in body && (!Number.isInteger(body.page) || body.page < 1 || body.page > 1000000)) fail(400, 'Invalid page.');
  if (body.operation === 'catalogue' && (typeof body.search !== 'string' || Array.from(body.search).length > 200)) fail(400, 'Invalid search.');
  if (body.operation === 'ask') {
    if (typeof body.body !== 'string' || !body.body.trim() || Array.from(body.body.trim()).length > 1000) fail(400, 'Questions must contain 1–1000 characters.');
    if (typeof body.requestId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.requestId)) fail(400, 'A UUID requestId is required.');
  }
  if (body.operation === 'mode' && !['auto', 'open', 'closed'].includes(body.mode)) fail(400, 'Invalid mode.');
  if (body.operation === 'answer' && (typeof body.answered !== 'boolean' || typeof body.questionId !== 'string' || !/^[a-z0-9]{15}$/.test(body.questionId))) fail(400, 'Invalid answer state or Question.');
}
function context(app, slug, now) {
  const sessions = rows(app, 'sessions', 'slug = {:slug} && published = true', '', 1, 0, { slug });
  if (!sessions.length) fail(404, 'Session not found.');
  const session = sessions[0];
  const controls = rows(app, 'live_qa_controls', 'session = {:id}', '', 1, 0, { id: session.id });
  const mode = controls.length ? controls[0].getString('mode') : 'auto';
  // Event Programme inherits publication from its Day and Appearance Event.
  const slots = rows(app, 'agenda_slots', 'session = {:id} && kind = "session" && published = true && programme.day.published = true && programme.appearance_event.published = true', '', 1, 0, { id: session.id });
  const startAt = slots.length ? instant(slots[0].getString('start_at')) : null;
  const endAt = slots.length ? instant(slots[0].getString('end_at')) : null;
  const scheduled = !!startAt && !!endAt && startAt <= now && now < endAt;
  return { session, controls, mode, startAt, endAt, accepting: slots.length > 0 && (mode === 'open' || mode === 'auto' && scheduled) };
}
exports.handle = (app, auth, body) => {
  validate(body);
  let reply;
  // One transaction serializes the author-wide cooldown, UUID claim and all authority reads.
  app.runInTransaction(tx => {
    const actor = actorFor(tx, auth);
    const canModerate = ['mc', 'admin'].includes(actor.getString('role'));
    const now = new Date().toISOString();
    if (['catalogue', 'mode', 'answer'].includes(body.operation) && !canModerate) fail(403, 'MC or admin authority is required.');
    if (body.operation === 'catalogue') {
      // Literal substring search: wildcard characters never broaden the query.
      const search = body.search.trim().replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
      const filter = $dbx.exp("published = true AND (title LIKE {:pattern} ESCAPE '\\' OR slug LIKE {:pattern} ESCAPE '\\')", { pattern: '%' + search + '%' });
      const total = tx.countRecords('sessions', filter);
      // Use the same SQL expression for rows and count: PB's ~ operator has
      // different empty-string and wildcard escaping semantics.
      const sessions = arrayOf(new Record(tx.findCollectionByNameOrId('sessions')));
      tx.recordQuery('sessions').andWhere(filter).orderBy('title', 'id').limit(50).offset((body.page - 1) * 50).all(sessions);
      reply = { items: sessions.map(record => ({ slug: record.getString('slug'), title: record.getString('title') })), page: body.page, totalPages: Math.ceil(total / 50) };
      return;
    }
    if (body.operation === 'ask') {
      const previous = rows(tx, 'live_qa_questions', 'author = {:author} && request_id = {:request}', '', 1, 0, { author: actor.id, request: body.requestId });
      if (previous.length) {
        const payload = JSON.parse(previous[0].getString('request_payload'));
        if (payload.slug !== body.slug || payload.body !== body.body) fail(409, 'requestId was already used for a different question.');
        reply = JSON.parse(previous[0].getString('request_reply'));
        return;
      }
    }
    const ctx = context(tx, body.slug, now);
    const session = ctx.session;
    if (body.operation === 'session') {
      const filter = 'session = {:session}' + (canModerate ? '' : ' && author = {:author}');
      const params = { session: session.id, author: actor.id };
      const total = tx.countRecords('live_qa_questions', $dbx.exp('session = {:session}' + (canModerate ? '' : ' AND author = {:author}'), params));
      reply = { sessionId: session.id, slug: session.getString('slug'), title: session.getString('title'), mode: ctx.mode, accepting: ctx.accepting, startAt: ctx.startAt, endAt: ctx.endAt, serverNow: now, canModerate, questions: rows(tx, 'live_qa_questions', filter, 'created,id', 50, (body.page - 1) * 50, params).map(record => question(record, actor)), page: body.page, totalPages: Math.ceil(total / 50) };
      return;
    }
    if (body.operation === 'ask') {
      if (!ctx.accepting) fail(409, 'Live Q&A is not accepting questions.');
      const recent = rows(tx, 'live_qa_questions', 'author = {:author}', '-created', 1, 0, { author: actor.id });
      if (recent.length && new Date(now).getTime() - new Date(instant(recent[0].getString('created'))).getTime() < 10000) fail(429, 'Wait 10 seconds between new questions.');
      const record = new Record(tx.findCollectionByNameOrId('live_qa_questions'));
      record.set('session', session.id);
      record.set('author', actor.id);
      record.set('body', body.body.trim());
      record.set('answered', false);
      record.set('created', now);
      record.set('request_id', body.requestId);
      record.set('request_payload', { slug: body.slug, body: body.body });
      record.set('request_reply', { pending: true });
      tx.save(record);
      reply = { question: question(record, actor) };
      record.set('request_reply', reply);
      tx.save(record);
      return;
    }
    if (body.operation === 'mode') {
      const control = ctx.controls[0] || new Record(tx.findCollectionByNameOrId('live_qa_controls'));
      control.set('session', session.id);
      control.set('mode', body.mode);
      tx.save(control);
      reply = { ok: true };
      return;
    }
    if (body.operation === 'answer') {
      const targets = rows(tx, 'live_qa_questions', 'id = {:id} && session = {:session}', '', 1, 0, { id: body.questionId, session: session.id });
      if (!targets.length) fail(404, 'Question not found.');
      targets[0].set('answered', body.answered);
      tx.save(targets[0]);
      reply = { ok: true };
      return;
    }
    fail(400, 'Invalid operation.');
  });
  return reply;
};
