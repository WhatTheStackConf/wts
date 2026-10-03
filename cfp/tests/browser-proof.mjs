import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { importedEmail, importedPassword } from '../../auth/acceptance/fixtures.mjs';

const { chromium } = createRequire(new URL('../../auth/package.json', import.meta.url))('playwright');
const cfpRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const artifactDir = join(cfpRoot, 'acceptance', 'artifacts', `browser-${Date.now()}`);
const results = [];
const messages = [];
const waiters = new Set();
let fixtureFailure;
let browser;
let finished = false;
const fixture = spawn(process.execPath, ['--experimental-strip-types', 'tests/browser-fixture.mjs'], {
  cwd: cfpRoot, stdio: ['pipe', 'pipe', 'pipe'],
});
fixture.stderr.resume();
const lines = createInterface({ input: fixture.stdout });
const exited = new Promise((accept) => fixture.once('close', (code) => {
  fixtureFailure = new Error(`The isolated browser fixture exited with code ${code}.`);
  for (const waiter of waiters) waiter.reject(fixtureFailure);
  accept(code);
}));
lines.on('line', (line) => {
  let value;
  try { value = JSON.parse(line); } catch { return; }
  if (value.failedAction) {
    fixtureFailure = new Error(`The isolated fixture failed at ${value.failedAction}.`);
    for (const waiter of waiters) waiter.reject(fixtureFailure);
  }
  messages.push(value);
  for (const waiter of waiters) {
    if (waiter.predicate(value)) {
      messages.splice(messages.indexOf(value), 1);
      waiters.delete(waiter);
      waiter.accept(value);
      break;
    }
  }
});
function message(predicate, timeout = 180_000) {
  const index = messages.findIndex(predicate);
  if (index !== -1) return Promise.resolve(messages.splice(index, 1)[0]);
  if (fixtureFailure) return Promise.reject(fixtureFailure);
  return new Promise((accept, reject) => {
    const waiter = { predicate, accept: (value) => { clearTimeout(timer); accept(value); }, reject: (error) => { clearTimeout(timer); waiters.delete(waiter); reject(error); } };
    const timer = setTimeout(() => waiter.reject(new Error('The isolated fixture command timed out.')), timeout);
    waiters.add(waiter);
  });
}
async function command(input, predicate) {
  const result = message(predicate);
  fixture.stdin.write(`${JSON.stringify(input)}\n`);
  return result;
}
async function check(name, run) {
  await run();
  results.push(name);
  console.log(`PASS ${name}`);
}
const button = (page, name) => page.getByRole('button', { name, exact: true });
const text = (page, value) => page.getByText(value, { exact: true });

try {
  await mkdir(artifactDir, { recursive: true, mode: 0o700 });
  const { origin } = await message((value) => value.ready);
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  page.setDefaultTimeout(20_000);
  const rpcHeaders = [];
  page.on('response', (response) => {
    if (response.url() === `${origin}/_server`) rpcHeaders.push(response.headers());
  });
  async function signIn(targetPage, email = importedEmail, password = importedPassword, returnTo = '/applications') {
    await targetPage.goto(`${origin}/auth/login?returnTo=${encodeURIComponent(returnTo)}`);
    await targetPage.waitForURL((url) => url.origin === origin || url.pathname === '/sign-in' || url.pathname === '/consent');
    if (new URL(targetPage.url()).pathname === '/sign-in') {
      await targetPage.locator('#email').fill(email);
      await targetPage.locator('#current-password').fill(password);
      await button(targetPage, 'Sign in').click();
      await targetPage.waitForURL((url) => url.origin === origin || url.pathname === '/consent');
    }
    if (new URL(targetPage.url()).pathname === '/consent') await button(targetPage, 'Allow access').click();
    await targetPage.waitForURL(`${origin}${returnTo}`);
  }
  async function proposal(targetPage, title, suffix) {
    await targetPage.locator('#proposal-title').fill(title);
    await targetPage.getByRole('textbox', { name: 'Abstract', exact: true }).fill(`Synthetic abstract ${suffix}.`);
    await targetPage.getByRole('textbox', { name: 'Key takeaways', exact: true }).fill(`Synthetic takeaways ${suffix}.`);
    await targetPage.locator('#proposal-tech').fill(`Synthetic technical requirements ${suffix}.`);
  }
  async function finishSteps(targetPage, suffix, first = false) {
    await button(targetPage, 'Next: Experience').click();
    if (!first) assert.equal(await targetPage.locator('#previous-presentation').inputValue(), '');
    await targetPage.locator('#previous-presentation').fill(`Synthetic previous presentation ${suffix}.`);
    await button(targetPage, 'Next: Expenses').click();
    if (first) await targetPage.getByRole('radio', { name: 'No', exact: true }).check();
    else {
      assert.equal(await targetPage.getByRole('radio').count(), 0);
      await targetPage.getByRole('link', { name: 'Edit applicant settings', exact: true }).waitFor();
    }
    if (!first) {
      assert.equal(await targetPage.locator('#organizer-notes').inputValue(), '');
      assert.equal(await targetPage.locator('#additional-info').inputValue(), '');
    }
    await targetPage.locator('#organizer-notes').fill(`Synthetic private note ${suffix}.`);
    await targetPage.locator('#additional-info').fill(`Synthetic additional information ${suffix}.`);
    await button(targetPage, 'Review application').click();
    for (const value of [`Synthetic previous presentation ${suffix}.`, `Synthetic private note ${suffix}.`, `Synthetic additional information ${suffix}.`]) await text(targetPage, value).waitFor();
  }
  async function receipt(targetPage, name = 'Submit application') {
    await button(targetPage, name).click();
    await targetPage.getByRole('heading', { name: 'Submission received', exact: true }).waitFor();
    return new URL(await targetPage.getByRole('link', { name: 'View submitted application', exact: true }).getAttribute('href'), origin).pathname;
  }
  let firstApplication;
  let secondApplication;
  let reuseDraft;
  await check('first application saves reusable speaker data and every presentation field', async () => {
    await signIn(page);
    await button(page, 'New application').click();
    await button(page, 'Continue').click();
    await page.locator('#app-name').fill('Synthetic saved CFP speaker');
    await page.locator('#app-bio').fill('Synthetic reusable speaker biography.');
    await page.locator('#app-affiliation').fill('Synthetic organization');
    await page.locator('#app-social').fill('https://example.test/synthetic-speaker');
    await page.locator('#app-talks').fill('Synthetic reusable speaking history.');
    await page.locator('#app-contact').fill('Email');
    await button(page, 'Next: Proposal').click();
    await proposal(page, 'Synthetic first presentation', 'one');
    await finishSteps(page, 'one', true);
    firstApplication = await receipt(page);
  });
  await check('second application after process replacement needs only blank presentation fields', async () => {
    await command({ command: 'restart' }, (value) => value.restarted);
    await page.goto(`${origin}/applications`);
    await button(page, 'New application').click();
    await text(page, 'Synthetic saved CFP speaker').waitFor();
    await button(page, 'Continue').click();
    assert.equal(await page.locator('#app-name').count(), 0);
    for (const selector of ['#proposal-title', '#proposal-tech']) assert.equal(await page.locator(selector).inputValue(), '');
    for (const name of ['Abstract', 'Key takeaways']) assert.equal((await page.getByRole('textbox', { name, exact: true }).innerText()).trim(), '');
    await proposal(page, 'Synthetic second presentation', 'two');
    await finishSteps(page, 'two');
    secondApplication = await receipt(page);
    assert.notEqual(secondApplication, firstApplication);
    const inspected = await command({ command: 'inspect' }, (value) => value.applications);
    assert.equal(inspected.applications.length, 2);
    assert.equal(inspected.profiles.length, 1);
  });
  await check('profile and settings updates remain shared without changing submitted presentations', async () => {
    await page.goto(`${origin}/profile`);
    await page.locator('#profile-name').fill('Synthetic updated CFP speaker');
    await button(page, 'Save profile').click();
    await text(page, 'Your speaker profile is saved.').waitFor();
    await page.goto(`${origin}/settings`);
    await page.locator('#contact-method').fill('Signal');
    await page.getByRole('radio', { name: 'Other', exact: true }).check();
    await button(page, 'Save settings').click();
    await text(page, 'Your applicant settings are saved.').waitFor();
    for (const [path, title] of [[firstApplication, 'Synthetic first presentation'], [secondApplication, 'Synthetic second presentation']]) {
      await page.goto(`${origin}${path}`);
      await page.getByRole('heading', { name: title, exact: true }).waitFor();
      await text(page, 'Synthetic updated CFP speaker').waitFor();
      await text(page, 'Signal').waitFor();
      await text(page, 'Other').waitFor();
    }
  });
  await check('pending edits stay private and stale or cross-origin writes fail', async () => {
    await page.goto(`${origin}${firstApplication}`);
    await button(page, 'Edit pending application').click();
    await button(page, 'Continue').waitFor();
    const editPath = new URL(page.url()).pathname;
    await button(page, 'Continue').click();
    await page.locator('#proposal-title').fill('Synthetic edited presentation');
    const capture = page.waitForRequest((request) => request.url() === `${origin}/_server` && request.method() === 'POST');
    await button(page, 'Save draft').click();
    const request = await capture;
    await text(page, 'Draft saved to your account.').waitFor();
    const headers = { ...await request.allHeaders(), origin };
    delete headers.cookie;
    const body = JSON.parse(request.postData());
    body[0].presentation.title = 'Rejected stale presentation';
    const stale = await context.request.post(`${origin}/_server`, { headers, data: JSON.stringify(body) });
    assert.equal(stale.status(), 200, 'The same-origin stale request must reach the domain guard.');
    assert.match(await stale.text(), /conflict/);
    assert.equal(stale.headers()['cache-control'], 'private, no-store');
    for (const value of [undefined, 'null', 'https://sibling.example.test']) {
      const deniedHeaders = { ...headers };
      if (value === undefined) delete deniedHeaders.origin;
      else deniedHeaders.origin = value;
      const denied = await context.request.post(`${origin}/_server`, { headers: deniedHeaders, data: JSON.stringify(body) });
      if (denied.status() === 200) assert.match(await denied.text(), /forbidden/);
      else assert.equal(denied.status(), 403);
      assert.equal(denied.headers()['cache-control'], 'private, no-store');
    }
    await page.goto(`${origin}${firstApplication}`);
    await page.getByRole('heading', { name: 'Synthetic first presentation', exact: true }).waitFor();
    await page.goto(`${origin}${editPath}`);
    await button(page, 'Continue').click();
    assert.equal(await page.locator('#proposal-title').inputValue(), 'Synthetic edited presentation');
    await button(page, 'Next: Experience').click();
    await button(page, 'Next: Expenses').click();
    await button(page, 'Review application').click();
    assert.equal(await receipt(page, 'Save changes'), firstApplication);
    await page.goto(`${origin}${firstApplication}`);
    await page.getByRole('heading', { name: 'Synthetic edited presentation', exact: true }).waitFor();
  });
  await check('finalized edit recovery opens the target and Reuse copies an independent draft', async () => {
    await page.goto(`${origin}${secondApplication}`);
    await button(page, 'Edit pending application').click();
    await button(page, 'Continue').click();
    await command({ command: 'finalize', applicationId: secondApplication.split('/').at(-1) }, (value) => value.finalized);
    await button(page, 'Save draft').click();
    const recovery = page.getByRole('link', { name: 'Open the application to create a Reuse draft.', exact: true });
    assert.equal(await recovery.getAttribute('href'), secondApplication);
    await recovery.click();
    await button(page, 'Reuse as a new application').click();
    await button(page, 'Continue').waitFor();
    reuseDraft = new URL(page.url()).pathname;
    await button(page, 'Continue').click();
    assert.equal(await page.locator('#proposal-title').inputValue(), 'Synthetic second presentation');
    await page.locator('#proposal-title').fill('Synthetic independent reused presentation');
    await button(page, 'Save draft').click();
    await text(page, 'Draft saved to your account.').waitFor();
    await page.goto(`${origin}${secondApplication}`);
    await page.getByRole('heading', { name: 'Synthetic second presentation', exact: true }).waitFor();
  });
  await check('closure keeps every draft field readable and profile maintenance available', async () => {
    await command({ command: 'close' }, (value) => value.cfpOpen === false);
    await page.goto(`${origin}${reuseDraft}`);
    await page.getByRole('region', { name: 'Saved draft details', exact: true }).waitFor();
    for (const value of ['Synthetic independent reused presentation', 'Synthetic previous presentation two.', 'Synthetic private note two.', 'Synthetic additional information two.']) await text(page, value).waitFor();
    assert.equal(await button(page, 'Save draft').count(), 0);
    await page.goto(`${origin}/profile`);
    await page.locator('#profile-bio').fill('Synthetic biography maintained after closure.');
    await button(page, 'Save profile').click();
    await text(page, 'Your speaker profile is saved.').waitFor();
  });
  await check('another account cannot read applicant records or browser history from the first account', async () => {
    const otherContext = await browser.newContext({ ignoreHTTPSErrors: true });
    const other = await otherContext.newPage();
    await signIn(other, 'second@acceptance.localhost', 'Synthetic second password 04!');
    await text(other, 'Your submitted applications will appear here.').waitFor();
    await other.goto(`${origin}${firstApplication}`);
    await other.getByRole('alert').waitFor();
    assert.equal(await other.getByRole('article', { name: 'Submitted application details', exact: true }).count(), 0);
    assert.doesNotMatch(await other.locator('body').innerText(), /Synthetic updated CFP speaker|Synthetic edited presentation|Synthetic private note/);
    await button(page, 'Sign out').click();
    await page.waitForURL(`${origin}/`);
    await page.goBack();
    await page.getByRole('link', { name: 'Sign in to edit your profile', exact: true }).waitFor();
    assert.equal(await page.locator('#profile-name').count(), 0);
    await otherContext.close();
    await signIn(page, importedEmail, importedPassword, firstApplication);
    await page.getByRole('heading', { name: 'Synthetic edited presentation', exact: true }).waitFor();
  });
  await check('restore rejects old browser sessions and unfinished flows with the same key', async () => {
    const unfinished = await browser.newContext({ ignoreHTTPSErrors: true });
    const flowPage = await unfinished.newPage();
    await flowPage.goto(`${origin}/auth/login`);
    await flowPage.locator('#email').waitFor();
    await command({ command: 'backup' }, (value) => value.backupPath);
    await command({ command: 'restore' }, (value) => value.restored);
    await page.goto(`${origin}${firstApplication}`);
    await page.getByRole('link', { name: 'Sign in to continue', exact: true }).waitFor();
    assert.equal(await page.getByRole('article', { name: 'Submitted application details', exact: true }).count(), 0);
    await flowPage.locator('#email').fill(importedEmail);
    await flowPage.locator('#current-password').fill(importedPassword);
    await button(flowPage, 'Sign in').click();
    await flowPage.waitForURL((url) => url.origin === origin || url.pathname === '/consent');
    if (new URL(flowPage.url()).pathname === '/consent') await button(flowPage, 'Allow access').click();
    await flowPage.waitForURL((url) => url.origin === origin);
    assert.match(await flowPage.locator('body').innerText(), /sign.in|authorization|flow/i);
    await flowPage.goto(`${origin}/applications`);
    await flowPage.getByRole('link', { name: 'Sign in to continue', exact: true }).waitFor();
    await unfinished.close();
    await signIn(page, importedEmail, importedPassword, firstApplication);
    await page.getByRole('heading', { name: 'Synthetic edited presentation', exact: true }).waitFor();
    await text(page, 'CFP closed').waitFor();
  });
  await check('private headers, host-only cookies, browser storage, and responsive rendering', async () => {
    assert.ok(rpcHeaders.length > 0);
    assert.ok(rpcHeaders.every((headers) => headers['cache-control'] === 'private, no-store'));
    const cookies = (await context.cookies(origin)).filter((cookie) => cookie.name.startsWith('__Host-wts-cfp-'));
    assert.equal(cookies.length, 1);
    assert.ok(cookies.every((cookie) => cookie.secure && cookie.httpOnly && cookie.path === '/' && cookie.domain === '127.0.0.2'));
    const stored = await page.evaluate(() => JSON.stringify({ local: Object.entries(localStorage), session: Object.entries(sessionStorage) }));
    assert.doesNotMatch(stored, /Synthetic|acceptance\.localhost|access_token|id_token|refresh_token|client_secret|__Host-wts-cfp-/);
    await page.screenshot({ path: join(artifactDir, 'desktop.png'), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({ path: join(artifactDir, 'mobile.png'), fullPage: true });
  });
  await check('provider outage denies private reads while anonymous status remains available', async () => {
    await page.goto(`${origin}/profile`);
    await page.locator('#profile-bio').fill('Synthetic unsaved biography after provider outage.');
    await command({ command: 'stop-provider' }, (value) => value.providerStopped);
    await button(page, 'Save profile').click();
    await page.getByRole('alert').waitFor();
    assert.equal(await page.locator('#profile-name').count(), 0);
    await page.goto(`${origin}${firstApplication}`);
    await page.getByRole('alert').waitFor();
    assert.equal(await page.getByRole('article', { name: 'Submitted application details', exact: true }).count(), 0);
    assert.doesNotMatch(await page.locator('main').innerText(), /Synthetic updated CFP speaker|Synthetic edited presentation|Synthetic private note/);
    const ready = await context.request.get(`${origin}/readyz`);
    assert.equal(ready.status(), 200);
    await page.goto(`${origin}/`);
    await page.getByRole('heading', { name: 'Call for Papers', exact: true }).waitFor();
  });
  finished = true;
} catch (error) {
  console.error(`FAIL ${error instanceof Error ? error.message : 'The built browser proof failed.'}`);
  process.exitCode = 1;
} finally {
  await browser?.close();
  if (!fixtureFailure) {
    fixture.stdin.write('{"command":"cleanup"}\n');
    fixture.stdin.end();
  }
  const cleanup = await message((value) => 'cleanupFailures' in value, 30_000).catch(() => ({ cleanupFailures: 1 }));
  if (cleanup.cleanupFailures !== 0) process.exitCode = 1;
  const timer = setTimeout(() => fixture.kill('SIGTERM'), 10_000);
  await exited;
  clearTimeout(timer);
  lines.close();
  const result = { passed: finished, checks: results, cleanupFailures: cleanup.cleanupFailures, limitations: ['Synthetic local HTTPS only. No production integration, deployment, or provider callback changes.'] };
  await writeFile(join(artifactDir, 'result.json'), `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600 });
  console.log(JSON.stringify({ ...result, artifactDir }));
}
