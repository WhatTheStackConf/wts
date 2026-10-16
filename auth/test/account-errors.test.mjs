import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

const source = await readFile(new URL('../public/account.js', import.meta.url), 'utf8');

class HTMLElement {
  hidden = true;
  textContent = '';
  focus() {}
}
class HTMLButtonElement extends HTMLElement {}
class HTMLInputElement extends HTMLElement {}

class HTMLFormElement extends HTMLElement {
  action = '/api/auth/request-password-reset';
  dataset = { accountAction: 'recovery' };
  error = new HTMLElement();
  status = new HTMLElement();
  attributes = new Map();
  listeners = new Map();
  addEventListener(type, listener) { this.listeners.set(type, listener); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  setAttribute(name, value) { this.attributes.set(name, value); }
  removeAttribute(name) { this.attributes.delete(name); }
  querySelector(selector) {
    if (selector === '[data-form-error]') return this.error;
    if (selector === '[data-form-status]') return this.status;
    return null;
  }
  querySelectorAll() { return []; }
}

async function submitWithError(status, body) {
  const form = new HTMLFormElement();
  runInNewContext(source, {
    HTMLElement, HTMLButtonElement, HTMLInputElement, HTMLFormElement, URL, TextEncoder,
    FormData: class { get(name) { return name === 'email' ? 'user@example.test' : null; } },
    location: { origin: 'https://auth.example.test', assign() {} },
    fetch: async () => ({ ok: false, status, json: async () => body }),
    document: { querySelectorAll: (selector) => selector === 'form[data-account-action]' ? [form] : [] },
  });
  form.listeners.get('submit')({ preventDefault() {}, submitter: null });
  await new Promise((resolve) => setTimeout(resolve, 0));
  return form.error.textContent;
}

test('an error code that names an Object.prototype member falls back to the status message', async () => {
  assert.equal(await submitWithError(401, { code: 'toString' }), 'Your session has ended. Return to sign in.');
  assert.equal(await submitWithError(429, { error: { code: 'constructor' } }), 'Too many requests. Wait a minute, then try again.');
  assert.equal(await submitWithError(400, { error: '__proto__' }), 'The account service did not accept these values. Check the fields, then try again.');
});

test('a known error code shows its own message', async () => {
  assert.equal(await submitWithError(400, { code: 'INVALID_EMAIL' }), 'Enter a valid email address.');
});
