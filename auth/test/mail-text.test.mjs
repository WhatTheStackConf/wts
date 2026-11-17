import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mailText } from '../acceptance/mail-text.mjs';

const link = 'http://localhost:43213/reset-password?token=4DAaNyJGgyExQ29j1EoTVQtq';

test('a 7bit message keeps a token that starts with hex characters', () => {
  const raw = ['Content-Type: text/plain; charset=utf-8', 'Content-Transfer-Encoding: 7bit', '', 'Open this link to reset your password.', '', link, ''].join('\r\n');
  assert.ok(mailText(raw).includes(link));
});

test('a message without a transfer encoding header is not decoded', () => {
  const raw = ['Content-Type: text/plain; charset=utf-8', '', link, ''].join('\r\n');
  assert.ok(mailText(raw).includes(link));
});

test('a quoted-printable message is decoded, including soft line breaks', () => {
  const raw = ['Content-Type: text/plain; charset=utf-8', 'Content-Transfer-Encoding: quoted-printable', '', 'http://localhost:43213/reset-password?token=3D4DAaNyJGgy=', 'ExQ29j1EoTVQtq', ''].join('\r\n');
  assert.ok(mailText(raw).includes(link));
});

test('only the quoted-printable part of a multipart message is decoded', () => {
  const raw = [
    'Content-Type: multipart/alternative; boundary="b1"', '',
    '--b1', 'Content-Type: text/plain', 'Content-Transfer-Encoding: 7bit', '', link, '',
    '--b1', 'Content-Type: text/html', 'Content-Transfer-Encoding: quoted-printable', '', '<a href=3D"x">reset</a>', '',
    '--b1--', '',
  ].join('\r\n');
  const text = mailText(raw);
  assert.ok(text.includes(link));
  assert.ok(text.includes('<a href="x">reset</a>'));
});
