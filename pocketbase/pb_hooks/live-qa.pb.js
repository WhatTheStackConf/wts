/// <reference path="../pb_data/types.d.ts" />
routerAdd('GET', '/api/wts/live-qa/programme', (e) => {
  e.response.header().set('Cache-Control', 'no-store');
  const api = require(`${__hooks}/live-qa.js`);
  return e.json(200, api.programme(e.app));
});
routerAdd('POST', '/api/wts/live-qa', (e) => {
  e.response.header().set('Cache-Control', 'private, no-store');
  const api = require(`${__hooks}/live-qa.js`);
  return e.json(200, api.handle(e.app, e.auth, e.requestInfo().body));
}, $apis.requireAuth('users'), $apis.bodyLimit(65536));
