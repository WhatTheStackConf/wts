import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { chromium } from '@playwright/test';
import { startLiveQaPocketBase } from '../src/lib/live-qa-pocketbase-test-helper.ts';

const fixture = await startLiveQaPocketBase({workspace:true});
const token = randomBytes(32).toString('base64url');
const port = 3189;
let server, browser;
try {
  const player = await fixture.user('user', '<img src=x onerror=alert(1)>');
  const admin = await fixture.user('admin', 'Crew Admin');
  for(const [user,xp] of [[player,40],[admin,20]]) await fixture.pb.collection('gamification_profiles').create({user:user.record.id,total_xp:xp,leaderboard_xp:xp,access_level:2,unlocked_badge_count:2,ops_board_visible:false,ops_board_display_name:'=FORMULA',public_badges_visible:false,totals_version:1,totals_recalculated_at:new Date().toISOString()});
  server = spawn(process.execPath,['.output/server/index.mjs'], {env:{PATH:process.env.PATH,HOME:process.env.HOME,NODE_ENV:'production',HOST:'127.0.0.1',PORT:String(port),POCKETBASE_URL:fixture.baseUrl,POCKETBASE_SUPERUSER_EMAIL:fixture.superuserEmail,POCKETBASE_SUPERUSER_PASSWORD:fixture.password,RAFFLE_SHARE_TOKEN_SHA256:createHash('sha256').update(token).digest('hex'),RAFFLE_SHARE_EXPIRES_AT:new Date(Date.now()+120000).toISOString()},stdio:'ignore'});
  const base = `http://127.0.0.1:${port}`;
  for(let i=0;i<100;i++) { try { if((await fetch(base+'/crew-raffle')).ok) break; } catch {} await new Promise(r=>setTimeout(r,100)); }
  for (const suffix of ['', '?key='+token]) assert.equal((await fetch(base+'/api/crew-raffle'+suffix)).status,404);
  const headers = {Authorization:'Bearer '+token};
  const response = await fetch(base+'/api/crew-raffle',{headers});
  assert.equal(response.status,200); assert.match(response.headers.get('cache-control'),/no-store/);
  const data = await response.json(); assert.equal(data.total,2); assert.equal(data.rows[0].email,player.record.email); assert.equal(data.rows[0].xp,40);
  assert.equal((await fetch(base+'/api/crew-raffle',{headers,method:'POST'})).status,405);
  assert.equal((await fetch(base+'/api/crew-raffle',{headers,method:'HEAD'})).status,200);
  browser = await chromium.launch({headless:true});
  const page = await browser.newPage({viewport:{width:390,height:844}});
  const errors=[]; const requests=[];
  page.on('pageerror',e=>errors.push(e.message)); page.on('request',r=>requests.push(r.url()));
  await page.goto(base+'/crew-raffle#key='+token);
  await page.locator('#summary').filter({hasText:'1 matching'}).waitFor();
  assert.equal(await page.locator('#rows tr').count(),1);
  assert.match(await page.locator('#rows').innerText(),/<img src=x onerror=alert\(1\)>/);
  assert.equal(await page.locator('#rows img').count(),0);
  await page.locator('#admins').check(); assert.equal(await page.locator('#rows tr').count(),2);
  await page.locator('#search').fill(player.record.email); assert.equal(await page.locator('#rows tr').count(),1);
  const downloadPromise=page.waitForEvent('download'); await page.locator('#export').click();
  const download=await downloadPromise; const stream=await download.createReadStream(); let csv=''; for await(const chunk of stream) csv+=chunk;
  assert.match(csv,/'=FORMULA/); assert.match(csv,/Registered name/); assert.ok(csv.includes(player.record.email));
  await page.locator('#refresh').click(); await page.locator('#refresh').isEnabled();
  assert.deepEqual(errors,[]); assert.ok(requests.every(url=>url.startsWith(base)));
  await page.screenshot({path:'/tmp/wts-crew-raffle-mobile.png',fullPage:true});
  await page.route('**/api/crew-raffle',route=>route.fulfill({status:503,body:'unavailable'}));
  await page.locator('#refresh').click(); await page.locator('#status').filter({hasText:'Refresh failed'}).waitFor();
  assert.equal(await page.locator('#rows tr').count(),0); assert.equal(await page.locator('#export').isDisabled(),true);
  console.log('PASS: built HTTP route + real PocketBase read/expansion; missing/query token denial; methods; mobile render; admin toggle; search; XSS; safe CSV; no third-party requests; failed refresh clears PII.');
} finally {
  if(browser) await browser.close();
  if(server) { server.kill('SIGTERM'); await new Promise(r=>server.once('exit',r)); }
  await fixture.cleanup();
}
