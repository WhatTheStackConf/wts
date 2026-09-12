/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const users = app.findCollectionByNameOrId('users');
  const role = users.fields.getByName('role');
  if (!role.values.includes('mc')) role.values = role.values.concat(['mc']);
  // Preserve the existing registration/update rules and role-guard hooks.
  app.save(users);
  const sessions = app.findCollectionByNameOrId('sessions');
  const locked = { type: 'base', listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null };
  const questions = new Collection(Object.assign({}, locked, {
    name: 'live_qa_questions',
    fields: [
      { name: 'session', type: 'relation', required: true, collectionId: sessions.id, maxSelect: 1, cascadeDelete: false },
      { name: 'author', type: 'relation', required: true, collectionId: users.id, maxSelect: 1, cascadeDelete: false },
      { name: 'body', type: 'text', required: true, max: 1000 },
      { name: 'answered', type: 'bool' },
      { name: 'request_id', type: 'text', required: true, max: 36 },
      // Exact caller payload and frozen first reply make committed-response loss replay safe.
      { name: 'request_payload', type: 'json', required: true, maxSize: 65536 },
      { name: 'request_reply', type: 'json', required: true, maxSize: 16384 },
      { name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
    ],
  }));
  questions.addIndex('idx_live_qa_author_request', true, 'author, request_id', '');
  questions.addIndex('idx_live_qa_session_created', false, 'session, created, id', '');
  questions.addIndex('idx_live_qa_session_author_created', false, 'session, author, created, id', '');
  questions.addIndex('idx_live_qa_author_created', false, 'author, created', '');
  app.save(questions);
  const controls = new Collection(Object.assign({}, locked, {
    name: 'live_qa_controls',
    fields: [
      { name: 'session', type: 'relation', required: true, collectionId: sessions.id, maxSelect: 1, cascadeDelete: false },
      { name: 'mode', type: 'select', required: true, maxSelect: 1, values: ['auto', 'open', 'closed'] },
    ],
  }));
  controls.addIndex('idx_live_qa_control_session', true, 'session', '');
  app.save(controls);
}, (app) => {
  if (app.countRecords('users', $dbx.exp("role = 'mc'"))) throw new Error('Reassign MC users before role rollback.');
  app.delete(app.findCollectionByNameOrId('live_qa_questions'));
  app.delete(app.findCollectionByNameOrId('live_qa_controls'));
  const users = app.findCollectionByNameOrId('users');
  users.fields.getByName('role').values = users.fields.getByName('role').values.filter(value => value !== 'mc');
  app.save(users);
});
