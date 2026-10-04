import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
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
  const staffContexts = [];
  async function staffPage(email, password, returnTo = '/applications') {
    const staffContext = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1440, height: 1000 } });
    staffContexts.push(staffContext);
    const staff = await staffContext.newPage();
    staff.setDefaultTimeout(20_000);
    await signIn(staff, email, password, returnTo);
    return { page: staff, context: staffContext };
  }
  async function rpc(context, request, change, requestedOrigin = origin) {
    const headers = { ...await request.allHeaders(), origin: requestedOrigin };
    for (const name of ['cookie', 'host', 'content-length']) delete headers[name];
    const body = JSON.parse(request.postData());
    change(body[0]);
    return context.request.post(`${origin}/_server`, { headers, data: JSON.stringify(body) });
  }
  function staffMutation(staff, kind) {
    return staff.waitForRequest((request) => request.url() === `${origin}/_server` && request.method() === 'POST' && request.postData()?.includes(kind));
  }
  async function criterion(staff, prefix, value) {
    for (const name of ['relevance', 'originality', 'depth', 'clarity', 'takeaways', 'engagement']) {
      const control = staff.locator(`#${prefix}-${name}`);
      if (await control.evaluate((element) => element.tagName) === 'SELECT') await control.selectOption(String(value));
      else await control.fill(String(value));
    }
  }
  let administrator;
  let reviewer;
  let secondReviewer;
  let unassigned;
  let savedReviewRequest;
  let grantRequest;
  let assignmentRequest;
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
  await check('real OIDC identities receive edition-local staff access through the maintenance bootstrap', async () => {
    administrator = await staffPage('legacy@acceptance.localhost', 'b'.repeat(73));
    reviewer = await staffPage('second@acceptance.localhost', 'Synthetic second password 04!');
    secondReviewer = await staffPage('boundary@acceptance.localhost', 'a'.repeat(72));
    unassigned = await staffPage('unassigned@acceptance.localhost', importedPassword);
    const bootstrap = await command({ command: 'bootstrap-admin', wtsUserId: 'syntheticuser04' }, (value) => value.bootstrapped);
    assert.equal(bootstrap.bootstrapped.role, 'admin');
    assert.equal(bootstrap.bootstrapped.state, 'active');
    await administrator.page.goto(`${origin}/admin/staff`);
    await administrator.page.getByRole('heading', { name: 'CFP staff and gates', exact: true }).waitFor();
    const soleAdmin = administrator.page.getByRole('row').filter({ hasText: 'syntheticuser04' });
    assert.equal(await button(soleAdmin, 'Revoke admin').isDisabled(), true);
    for (const id of ['syntheticuser02', 'syntheticuser03', 'syntheticuser06']) {
      const row = administrator.page.getByRole('row').filter({ hasText: id });
      const capture = staffMutation(administrator.page, 'set-grant');
      await button(row, 'Grant reviewer').click();
      const request = await capture;
      if (!grantRequest) grantRequest = request;
      await button(administrator.page.getByRole('row').filter({ hasText: id }), 'Revoke reviewer').waitFor();
    }
    const forged = await rpc(context, grantRequest, (value) => { value.requestId = randomUUID(); value.wtsUserId = 'syntheticuser01'; });
    assert.match(await forged.text(), /forbidden/);
    const lastAdmin = await rpc(administrator.context, grantRequest, (value) => {
      value.requestId = randomUUID(); value.wtsUserId = 'syntheticuser04'; value.role = 'admin'; value.active = false; value.expectedRevision = 1;
    });
    assert.match(await lastAdmin.text(), /last_admin/);
    await page.goto(`${origin}/admin`);
    await page.getByRole('alert').first().waitFor();
    assert.equal(await page.getByRole('checkbox', { name: /Select Synthetic/ }).count(), 0);
  });
  await check('assigned reviewer access excludes applicant identity and unassigned proposals', async () => {
    await administrator.page.locator('input[name="reviewOpen"]').check();
    await button(administrator.page, 'Save review and report policy').click();
    await text(administrator.page, 'Review and daily report policy saved.').waitFor();
    await unassigned.page.goto(`${origin}/reviewer`);
    await unassigned.page.getByRole('heading', { name: 'Reviewer queue', exact: true }).waitFor();
    assert.equal(await unassigned.page.getByRole('link', { name: 'Synthetic edited presentation', exact: true }).count(), 0);
    await unassigned.page.goto(`${origin}/reviewer/${firstApplication.split('/').at(-1)}`);
    await unassigned.page.getByRole('alert').first().waitFor();
    assert.doesNotMatch(await unassigned.page.locator('main').innerText(), /Synthetic edited presentation|Synthetic private note/);
    await administrator.page.goto(`${origin}/admin/${firstApplication.split('/').at(-1)}`);
    await administrator.page.getByRole('heading', { name: 'Synthetic edited presentation', exact: true }).waitFor();
    for (const id of ['syntheticuser02', 'syntheticuser03']) {
      await administrator.page.getByLabel('Reviewer with an active edition grant').selectOption(id);
      const assignment = staffMutation(administrator.page, 'set-assignments');
      await button(administrator.page, 'Assign reviewer').click();
      assignmentRequest = await assignment;
      await administrator.page.getByText(`${id} · revision 1`, { exact: true }).waitFor();
    }
    const responses = [];
    const capture = (response) => {
      if (response.url() === `${origin}/_server`) responses.push(response.text());
    };
    reviewer.page.on('response', capture);
    await reviewer.page.goto(`${origin}/reviewer/${firstApplication.split('/').at(-1)}`);
    await reviewer.page.getByRole('heading', { name: 'Your review', exact: true }).waitFor();
    const body = await reviewer.page.locator('main').innerText();
    assert.match(body, /Synthetic technical requirements one/);
    assert.doesNotMatch(body, /Synthetic updated CFP speaker|Synthetic private note|Synthetic additional information|imported@acceptance\.localhost/);
    const payloads = (await Promise.all(responses)).join('\n');
    assert.doesNotMatch(payloads, /Synthetic updated CFP speaker|Synthetic private note|Synthetic additional information|imported@acceptance\.localhost/);
    reviewer.page.off('response', capture);
  });
  await check('stable-ID self-review and historical-edition grants cannot bypass resource scope', async () => {
    await administrator.page.goto(`${origin}/admin/staff`);
    const own = administrator.page.getByRole('row').filter({ hasText: 'syntheticuser01' });
    await button(own, 'Grant reviewer').click();
    await button(administrator.page.getByRole('row').filter({ hasText: 'syntheticuser01' }), 'Revoke reviewer').waitFor();
    const denied = await rpc(administrator.context, assignmentRequest, (value) => {
      value.requestId = randomUUID();
      value.changes[0].reviewerId = 'syntheticuser01';
      value.changes[0].expectedRevision = 0;
    });
    assert.match(await denied.text(), /forbidden|not_found|invalid_fields/);
    await page.goto(`${origin}/reviewer/${firstApplication.split('/').at(-1)}`);
    await page.getByRole('alert').first().waitFor();
    assert.equal(await button(page, 'Save review').count(), 0);
    await button(administrator.page.getByRole('row').filter({ hasText: 'syntheticuser01' }), 'Revoke reviewer').click();
    await button(administrator.page.getByRole('row').filter({ hasText: 'syntheticuser01' }), 'Grant reviewer').waitFor();
    await command({ command: 'historical-reviewer' }, (value) => value.historicalReviewer);
    await button(administrator.page.getByRole('row').filter({ hasText: 'syntheticuser06' }), 'Revoke reviewer').click();
    await button(administrator.page.getByRole('row').filter({ hasText: 'syntheticuser06' }), 'Grant reviewer').waitFor();
    await unassigned.page.goto(`${origin}/reviewer`);
    await unassigned.page.getByRole('alert').first().waitFor();
    assert.equal(await unassigned.page.getByRole('heading', { name: 'Assigned proposals', exact: true }).count(), 0);
  });
  await check('private reviewer scores, notes, and weight votes save with stale-write protection', async () => {
    await criterion(reviewer.page, 'score', 4);
    await reviewer.page.getByLabel('Private notes').fill('Private reviewer one sentinel.');
    await reviewer.page.getByLabel('I suspect this presentation uses AI-generated content.').check();
    const capture = staffMutation(reviewer.page, 'save-review');
    await button(reviewer.page, 'Save review').click();
    savedReviewRequest = await capture;
    await text(reviewer.page, 'Saved review revision 1.').waitFor();
    const stale = await rpc(reviewer.context, savedReviewRequest, (value) => { value.requestId = randomUUID(); value.notes = 'Rejected stale review.'; });
    assert.match(await stale.text(), /conflict/);
    assert.equal(stale.headers()['cache-control'], 'private, no-store');
    const denied = await rpc(reviewer.context, savedReviewRequest, (value) => { value.requestId = randomUUID(); }, 'https://sibling.example.test');
    assert.match(await denied.text(), /forbidden/);
    await secondReviewer.page.goto(`${origin}/reviewer/${firstApplication.split('/').at(-1)}`);
    await secondReviewer.page.getByRole('heading', { name: 'Your review', exact: true }).waitFor();
    assert.doesNotMatch(await secondReviewer.page.locator('main').innerText(), /Private reviewer one sentinel/);
    await criterion(secondReviewer.page, 'score', 5);
    await secondReviewer.page.getByLabel('Private notes').fill('Private reviewer two sentinel.');
    await button(secondReviewer.page, 'Save review').click();
    await text(secondReviewer.page, 'Saved review revision 1.').waitFor();
    await reviewer.page.goto(`${origin}/reviewer`);
    await reviewer.page.getByRole('heading', { name: 'Your criterion weights', exact: true }).waitFor();
    await criterion(reviewer.page, 'weight', 1);
    await button(reviewer.page, 'Save my weights').click();
    await text(reviewer.page, 'Saved weight vote revision 1.').waitFor();
    await administrator.page.goto(`${origin}/admin`);
    const row = administrator.page.getByRole('row').filter({ hasText: 'Synthetic edited presentation' });
    await row.waitFor();
    assert.match(await row.innerText(), /4\.50/);
    await administrator.page.goto(`${origin}/admin/${firstApplication.split('/').at(-1)}`);
    await text(administrator.page, 'Private reviewer one sentinel.').waitFor();
    await text(administrator.page, 'Private reviewer two sentinel.').waitFor();
    assert.equal(await administrator.page.locator('#score-relevance').count(), 0);
  });
  await check('Review next clears the previous proposal and saves to the new assigned proposal', async () => {
    await administrator.page.goto(`${origin}/admin/${secondApplication.split('/').at(-1)}`);
    await administrator.page.getByLabel('Reviewer with an active edition grant').selectOption('syntheticuser02');
    await button(administrator.page, 'Assign reviewer').click();
    await administrator.page.getByText('syntheticuser02 · revision 1', { exact: true }).waitFor();
    await reviewer.page.goto(`${origin}/reviewer/${firstApplication.split('/').at(-1)}`);
    await reviewer.page.getByRole('heading', { name: 'Your review', exact: true }).waitFor();
    await button(reviewer.page, 'Review next proposal').click();
    await reviewer.page.waitForURL(`${origin}/reviewer/${secondApplication.split('/').at(-1)}`);
    await reviewer.page.getByRole('heading', { name: 'Synthetic second presentation', exact: true }).waitFor();
    assert.equal(await reviewer.page.getByLabel('Private notes').inputValue(), '');
    assert.equal(await reviewer.page.locator('#score-relevance').inputValue(), '');
    await criterion(reviewer.page, 'score', 2);
    await reviewer.page.getByLabel('Private notes').fill('Private second-proposal review sentinel.');
    await button(reviewer.page, 'Save review').click();
    await text(reviewer.page, 'Saved review revision 1.').waitFor();
    const stored = await command({ command: 'staff-inspect' }, (value) => value.staff);
    const own = stored.reviews.filter((review) => review.reviewer_id === 'syntheticuser02');
    assert.deepEqual(own.map((review) => review.application_id).sort(), [firstApplication.split('/').at(-1), secondApplication.split('/').at(-1)].sort());
    assert.ok(own.every((review) => review.revision === 1));
  });
  await check('application closure and review closure remain independent', async () => {
    await administrator.page.goto(`${origin}/admin/staff`);
    await administrator.page.locator('input[name="cfpOpen"]').uncheck();
    await button(administrator.page, 'Save CFP gate').click();
    await text(administrator.page, 'CFP intake closed.').waitFor();
    await reviewer.page.goto(`${origin}/reviewer/${firstApplication.split('/').at(-1)}`);
    await reviewer.page.getByLabel('Private notes').fill('Private reviewer one after intake closure.');
    await button(reviewer.page, 'Save review').click();
    await text(reviewer.page, 'Saved review revision 2.').waitFor();
    await administrator.page.locator('input[name="cfpOpen"]').check();
    await button(administrator.page, 'Save CFP gate').click();
    await text(administrator.page, 'CFP intake opened.').waitFor();
    await administrator.page.locator('input[name="reviewOpen"]').uncheck();
    await button(administrator.page, 'Save review and report policy').click();
    await text(administrator.page, 'Review and daily report policy saved.').waitFor();
    const closed = await rpc(reviewer.context, savedReviewRequest, (value) => { value.requestId = randomUUID(); value.expectedReviewRevision = 2; });
    assert.match(await closed.text(), /review_closed/);
    await administrator.page.locator('input[name="reviewOpen"]').check();
    await button(administrator.page, 'Save review and report policy').click();
    await text(administrator.page, 'Review and daily report policy saved.').waitFor();
  });
  await check('confirmed presentation edits preserve evaluated content and exclude stale review scores', async () => {
    await page.goto(`${origin}${firstApplication}`);
    await button(page, 'Edit pending application').click();
    await button(page, 'Continue').click();
    await page.getByRole('textbox', { name: 'Abstract', exact: true }).fill('Synthetic changed abstract for current review.');
    await button(page, 'Next: Experience').click();
    await button(page, 'Next: Expenses').click();
    await button(page, 'Review application').click();
    assert.equal(await receipt(page, 'Save changes'), firstApplication);
    await reviewer.page.goto(`${origin}/reviewer/${firstApplication.split('/').at(-1)}`);
    await reviewer.page.getByRole('heading', { name: 'Presentation evaluated by this review', exact: true }).waitFor();
    assert.match(await reviewer.page.locator('main').innerText(), /Synthetic abstract one/);
    assert.match(await reviewer.page.locator('main').innerText(), /Synthetic changed abstract for current review/);
    await button(reviewer.page, 'Save review').click();
    await text(reviewer.page, 'Saved review revision 3.').waitFor();
    await administrator.page.goto(`${origin}/admin`);
    const row = administrator.page.getByRole('row').filter({ hasText: 'Synthetic edited presentation' });
    await row.waitFor();
    assert.match(await row.innerText(), /4\.00/);
  });
  await check('bulk selection rejects changed evidence atomically and permits audited reopening', async () => {
    for (const title of ['Synthetic edited presentation', 'Synthetic second presentation']) await administrator.page.getByRole('checkbox', { name: `Select ${title}`, exact: true }).check();
    await secondReviewer.page.goto(`${origin}/reviewer`);
    await secondReviewer.page.getByRole('heading', { name: 'Your criterion weights', exact: true }).waitFor();
    await criterion(secondReviewer.page, 'weight', 2);
    await button(secondReviewer.page, 'Save my weights').click();
    await text(secondReviewer.page, 'Saved weight vote revision 1.').waitFor();
    await button(administrator.page, 'Accept selected').click();
    await administrator.page.getByRole('alert').first().waitFor();
    const stale = await command({ command: 'inspect' }, (value) => value.applications);
    assert.deepEqual(stale.applications.map((application) => application.status), ['pending', 'pending']);
    await administrator.page.goto(`${origin}/admin`);
    for (const title of ['Synthetic edited presentation', 'Synthetic second presentation']) await administrator.page.getByRole('checkbox', { name: `Select ${title}`, exact: true }).check();
    await button(administrator.page, 'Accept selected').click();
    await administrator.page.getByRole('checkbox', { name: 'Select Synthetic edited presentation', exact: true }).waitFor({ state: 'detached' });
    const decided = await command({ command: 'inspect' }, (value) => value.applications);
    assert.deepEqual(decided.applications.map((application) => application.status), ['accepted', 'accepted']);
    await page.goto(`${origin}${firstApplication}`);
    await text(page, 'accepted').waitFor();
    await reviewer.page.goto(`${origin}/reviewer/${firstApplication.split('/').at(-1)}`);
    await reviewer.page.getByRole('alert').first().waitFor();
    assert.equal(await button(reviewer.page, 'Save review').count(), 0);
    await administrator.page.getByRole('combobox', { name: 'Status', exact: true }).selectOption('accepted');
    await button(administrator.page, 'Apply filters').click();
    for (const title of ['Synthetic edited presentation', 'Synthetic second presentation']) await administrator.page.getByRole('checkbox', { name: `Select ${title}`, exact: true }).check();
    await button(administrator.page, 'Reopen selected to pending').click();
    await administrator.page.getByRole('checkbox', { name: 'Select Synthetic edited presentation', exact: true }).waitFor({ state: 'detached' });
    const reopened = await command({ command: 'inspect' }, (value) => value.applications);
    assert.deepEqual(reopened.applications.map((application) => application.status), ['pending', 'pending']);
  });
  await check('staff revocation denies the same session and prevents historical receipt replay', async () => {
    await reviewer.page.goto(`${origin}/reviewer/${firstApplication.split('/').at(-1)}`);
    await reviewer.page.getByRole('heading', { name: 'Your review', exact: true }).waitFor();
    await reviewer.page.getByLabel('Private notes').fill('Unsaved private reviewer value after revocation.');
    await administrator.page.goto(`${origin}/admin/staff`);
    await button(administrator.page.getByRole('row').filter({ hasText: 'syntheticuser02' }), 'Revoke reviewer').click();
    await button(administrator.page.getByRole('row').filter({ hasText: 'syntheticuser02' }), 'Grant reviewer').waitFor();
    await button(reviewer.page, 'Save review').click();
    await reviewer.page.getByRole('alert').first().waitFor();
    assert.equal(await reviewer.page.getByLabel('Private notes').count(), 0);
    assert.doesNotMatch(await reviewer.page.locator('main').innerText(), /Synthetic edited presentation|Unsaved private reviewer/);
    const replay = await rpc(reviewer.context, savedReviewRequest, () => {});
    assert.match(await replay.text(), /forbidden/);
    await administrator.page.goto(`${origin}/admin`);
    const row = administrator.page.getByRole('row').filter({ hasText: 'Synthetic edited presentation' });
    await row.waitFor();
    assert.match(await row.innerText(), /4\.00/);
  });
  await check('built submissions queue one durable confirmation per committed receipt', async () => {
    const before = await command({ command: 'staff-inspect' }, (value) => value.staff);
    assert.equal(before.mailJobs.filter((job) => job.kind === 'submission').length, 4);
    const tick = await command({ command: 'mail-tick' }, (value) => value.mailTick);
    assert.equal(tick.mailTick.sent, 4);
    assert.equal(tick.mailTick.failed, 0);
    assert.equal(tick.capturedMessages, 4);
    const replay = await command({ command: 'mail-tick' }, (value) => value.mailTick);
    assert.equal(replay.mailTick.sent, 0);
    assert.equal(replay.capturedMessages, 4);
  });
  await check('an administrator retains revision-bound selections across pages for a 51-proposal decision', async () => {
    const seeded = await command({ command: 'seed-bulk' }, (value) => value.seededBulk);
    await administrator.page.goto(`${origin}/admin`);
    await administrator.page.getByLabel('Search title or applicant').fill('Synthetic pagination proposal');
    await button(administrator.page, 'Apply filters').click();
    await administrator.page.getByRole('checkbox', { name: /Select Synthetic pagination proposal/ }).first().waitFor();
    const firstPage = administrator.page.getByRole('checkbox', { name: /Select Synthetic pagination proposal/ });
    assert.equal(await firstPage.count(), 50);
    for (const checkbox of await firstPage.all()) await checkbox.check();
    await button(administrator.page, 'Next page').click();
    const lastPage = administrator.page.getByRole('checkbox', { name: /Select Synthetic pagination proposal/ });
    await administrator.page.waitForFunction(() => document.querySelectorAll('input[aria-label^="Select Synthetic pagination proposal"]').length === 1);
    await lastPage.first().check();
    await button(administrator.page, 'Accept selected').click();
    await lastPage.first().waitFor({ state: 'detached' });
    const stored = await command({ command: 'inspect' }, (value) => value.applications);
    const decided = stored.applications.filter((application) => seeded.ids.includes(application.application_id));
    assert.equal(decided.length, 51);
    assert.ok(decided.every((application) => application.status === 'accepted'));
  });
  await check('staff surfaces retain private headers, keyboard focus, and responsive layouts', async () => {
    for (const [staff, path] of [[administrator.page, '/admin'], [secondReviewer.page, '/reviewer']]) {
      const response = await staff.goto(`${origin}${path}`);
      assert.equal(response.headers()['cache-control'], 'private, no-store');
      assert.equal(response.headers()['x-robots-tag'], 'noindex, nofollow');
      await staff.locator('main h1').waitFor();
      for (const width of [320, 390, 768, 1024, 1440]) {
        await staff.setViewportSize({ width, height: 1000 });
        assert.equal(await staff.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${path} must fit ${width}px`);
      }
      await staff.getByRole('link', { name: 'Skip to main content', exact: true }).focus();
      assert.equal(await staff.evaluate(() => getComputedStyle(document.activeElement).outlineStyle), 'solid');
      const stored = await staff.evaluate(() => JSON.stringify({ local: Object.entries(localStorage), session: Object.entries(sessionStorage) }));
      assert.doesNotMatch(stored, /Synthetic|acceptance\.localhost|access_token|client_secret|__Host-wts-cfp-/);
      await staff.screenshot({ path: join(artifactDir, path === '/admin' ? 'admin-desktop.png' : 'reviewer-desktop.png'), fullPage: true });
      await staff.setViewportSize({ width: 390, height: 844 });
      await staff.screenshot({ path: join(artifactDir, path === '/admin' ? 'admin-mobile.png' : 'reviewer-mobile.png'), fullPage: true });
    }
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
    const staff = await command({ command: 'staff-inspect' }, (value) => value.staff);
    assert.equal(staff.grants.filter((grant) => grant.state === 'active').length, 0);
    assert.equal(staff.assignments.filter((assignment) => assignment.state === 'active').length, 0);
    assert.ok(staff.policy.every((policy) => policy.review_open === 0 && policy.daily_report_enabled === 0));
    await administrator.page.goto(`${origin}/admin`);
    await administrator.page.getByRole('alert').first().waitFor();
    assert.equal(await administrator.page.getByRole('checkbox', { name: /Select Synthetic/ }).count(), 0);
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
    await signIn(administrator.page, 'legacy@acceptance.localhost', 'b'.repeat(73));
    await command({ command: 'bootstrap-admin', wtsUserId: 'syntheticuser04' }, (value) => value.bootstrapped);
    await administrator.page.goto(`${origin}/admin`);
    await administrator.page.getByRole('link', { name: 'Synthetic edited presentation', exact: true }).waitFor();
    await command({ command: 'stop-provider' }, (value) => value.providerStopped);
    await administrator.page.goto(`${origin}/admin/${firstApplication.split('/').at(-1)}`);
    await administrator.page.getByRole('alert').first().waitFor();
    assert.doesNotMatch(await administrator.page.locator('main').innerText(), /Synthetic updated CFP speaker|Private reviewer|Synthetic private note/);
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
