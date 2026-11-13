import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { renderPage } from '../src/pages.ts';

const shell = { registrationOpen: true, enabledProviders: ['google'], oauthQuery: null, notice: null };
const profile = { wtsUserId: 'wts_1', name: 'Ana', avatarUrl: null, preferredLanguage: null, username: 'ana', emailVisibility: false, revision: 3 };
const states = [
  { ...shell, kind: 'sign-in' },
  { ...shell, kind: 'sign-up' },
  { ...shell, kind: 'recovery' },
  { ...shell, kind: 'reset-password', token: 'tok' },
  { ...shell, kind: 'reset-password', token: null },
  { ...shell, kind: 'verify-email', email: 'a@example.test', verified: false },
  { ...shell, kind: 'verify-email', email: null, verified: true },
  { ...shell, kind: 'consent', client: { name: 'CFP <app>', redirectUri: 'https://cfp.example.test/cb' }, scopes: ['openid', 'email'] },
  { ...shell, kind: 'account', email: 'a@example.test', profile },
  { ...shell, kind: 'error', title: 'Request failed', message: 'Try again.' },
];

test('every page state renders the light glass header with the wordmark and 2027 label', () => {
  for (const state of states) {
    const html = renderPage(state);
    assert.match(html, /<header class="support-header">/, state.kind);
    assert.match(html, /<span class="brand-name">WhatTheStack<\/span><span class="brand-year">2027<\/span>/, state.kind);
    assert.equal((html.match(/<h1>/g) ?? []).length, 1, state.kind);
    assert.doesNotMatch(html, /WTS account<\/span>/, state.kind);
  }
});

test('consent puts the escaped client request inside the single panel and keeps both actions', () => {
  const html = renderPage(states[7]);
  assert.match(html, /<section class="consent-details"[^>]*><p class="consent-client"><strong>CFP &lt;app&gt;<\/strong> requests access/);
  assert.equal((html.match(/class="consent-details"/g) ?? []).length, 1);
  assert.match(html, /name="accept" value="true">Allow access/);
  assert.match(html, /name="accept" value="false">Deny access/);
});

test('behavior hooks used by account.js stay in place', () => {
  const actions = states.map((state) => [...renderPage(state).matchAll(/data-account-action="([^"]+)"/g)].map((match) => match[1]));
  assert.deepEqual(actions, [
    ['sign-in', 'social'], ['sign-up', 'social'], ['recovery'], ['reset-password'], [],
    ['verify-email'], [], ['consent'], ['profile', 'sign-out'], [],
  ]);
  assert.match(renderPage(states[0]), /data-password-toggle="current-password"/);
  assert.match(renderPage(states[3]), /data-reset-sign-in hidden/);
  assert.match(renderPage(states[8]), /data-profile-reload hidden/);
});

test('account.css uses orbit tokens and serves StarzoomShavian locally', async () => {
  const css = await readFile(new URL('../public/account.css', import.meta.url), 'utf8');
  assert.doesNotMatch(css, /#[0-9a-f]{3,8}\b/i);
  assert.match(css, /--color-orbit-paper: oklch\(97% 0\.018 82\);/);
  assert.match(css, /--color-orbit-hair: color-mix\(in oklch, var\(--color-orbit-ink\) 14%, transparent\);/);
  assert.match(css, /font-family: "StarzoomShavian";\s*src: url\("\/assets\/fonts\/starzoom-shavian\.regular\.woff2"\)/);
  assert.doesNotMatch(css, /border-radius: (?!0)/);
  await access(new URL('../public/fonts/starzoom-shavian.regular.woff2', import.meta.url));
  const dockerfile = await readFile(new URL('../Dockerfile', import.meta.url), 'utf8');
  assert.match(dockerfile, /COPY [^\n]*public\/fonts\/starzoom-shavian\.regular\.woff2 \.\/auth\/public\/fonts\//);
});
