// Approved-profile component acceptance, not a live-backend or deployment check.
import { createServer } from "vite";
import solid from "@solidjs/vite-plugin";
import { chromium, expect } from "@playwright/test";
import { readFileSync, readdirSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
const root = fileURLToPath(new URL('../', import.meta.url));
const manifest = JSON.parse(readFileSync(`${root}scripts/dj-2026.manifest.json`, 'utf8'));
const record = manifest.record;
const profile = { slug: record.slug, displayName: record.display_name, affiliation: record.affiliation, bio: record.bio,
  socialHandles: record.social_handles, isMc: false, isDj: true, sessionCount: 0, sessions: [], appearanceEvents: [],
  photoUrl: 'https://pb.example/api/files/speakers/dj/photo.jpg' };
const style = readdirSync(`${root}.output/public/assets`).find(n => n.startsWith('virtual_solid-ssr-entry-client-') && n.endsWith('.css'));
assert.ok(style, 'Build the production stylesheet first.');
const out = process.argv[2] || '/tmp/wts-dj-evidence';mkdirSync(out, { recursive: true });
const entry = `${root}tests/__dj-entry.tsx`, layout = `${root}tests/__dj-layout.tsx`, data = `${root}tests/__dj-data.ts`;
const server = await createServer({ configFile: false, root, plugins: [solid({ ssr: false }), {
  name: 'dj-component-acceptance',
  resolveId(id) { if (id === '/__dj-entry.tsx') return entry; if ([layout, data].includes(id)) return id; },
  load(id) {
    if (id === layout) return `export function Layout(p){return <main class="max-w-5xl mx-auto text-white">{p.children}</main>}`;
    if (id === data) return `export const fetchSpeakerBySlug=()=>(${JSON.stringify(profile)});`;
    if (id === entry) return `import {render} from '@solidjs/web';import {createRouter} from '@solidjs/router';
      import SpeakerDetail from '~/routes/speakers/[slug]/index';import {SpeakerCard} from '~/components/conference/SpeakerCard';
      const p=${JSON.stringify(profile)};const Router=createRouter({routes:[{path:'/',component:()=> <main class="p-6 mx-auto max-w-3xl"><SpeakerCard speaker={p} variant={new URLSearchParams(location.search).get('variant')||'full'} layout="featured"/></main>},{path:'/speakers/:slug',component:SpeakerDetail}]});render(()=> <Router/>,document.getElementById('app'));`;
  },
  configureServer(server) {server.middlewares.use(async (req,res,next)=>{
    if (req.url?.startsWith('/api/image?')) {res.setHeader('Content-Type','image/jpeg');res.end(readFileSync(`${root}scripts/${manifest.photo_asset}`));return;}
    if (!['/','/speakers/'+record.slug].includes(req.url?.split('?')[0])) return next();
    res.setHeader('Content-Type','text/html');res.end(await server.transformIndexHtml('/',`<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/@fs/${root}.output/public/assets/${style}"></head><body style="background:#100d1e"><div id="app"></div><script type="module" src="/__dj-entry.tsx"></script></body></html>`));
  });},
}],resolve:{alias:[{find:'~/layouts/Layout',replacement:layout},{find:'~/lib/speakers-public',replacement:data},{find:'~',replacement:`${root}src`},{find:'.velite',replacement:`${root}.velite`}]},server:{host:'127.0.0.1',port:0},logLevel:'error'});
let browser;
try {
  await server.listen();const origin=`http://127.0.0.1:${server.httpServer.address().port}`;
  browser=await chromium.launch({headless:true});
  for(const width of [390,1440]) {
    const page=await browser.newPage({viewport:{width,height:1000}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
    for(const variant of ['full','teaser']) {
      await page.goto(`${origin}/?variant=${variant}`);
      // Existing glitch pseudo-elements repeat the accessible heading name.
      await expect(page.getByRole('heading',{name:/DinaShantina/})).toBeVisible();
      await expect(page.getByRole('heading',{name:/DinaShantina/})).toHaveText('DinaShantina');
      await expect(page.getByText('DJ',{exact:true})).toBeVisible();
      await expect(page.getByText('MC',{exact:true})).toHaveCount(0);
      await expect(page.getByText('Talks not announced yet')).toHaveCount(0);
      await expect.poll(()=>page.locator('img').evaluateAll(a=>a.length>0&&a.every(i=>i.complete&&i.naturalWidth>0))).toBe(true);
      await page.screenshot({path:`${out}/card-${variant}-${width}.png`});
    }
    await page.goto(`${origin}/speakers/${record.slug}`);
    await expect(page.getByRole('heading',{name:'DinaShantina',exact:true})).toBeVisible();
    await expect(page.getByText('DJ',{exact:true})).toBeVisible();
    await expect(page.getByRole('heading',{name:'Sessions',exact:true})).toHaveCount(0);
    await expect(page.getByText('MC',{exact:true})).toHaveCount(0);
    await expect(page.locator('a[href="https://www.instagram.com/dinashantina/"]')).toBeVisible();
    await expect(page.locator('a[href="https://www.linkedin.com/in/dina-damjanovikj/"]')).toBeVisible();
    await expect(page.getByText(/part of the WhatTheStack organising team/)).toBeVisible();
    await expect.poll(()=>page.locator('img').evaluateAll(a=>a.length>0&&a.every(i=>i.complete&&i.naturalWidth>0))).toBe(true);
    await expect.poll(()=>page.locator('h1').evaluate(h=>{let o=1;for(let e=h;e;e=e.parentElement)o*=parseFloat(getComputedStyle(e).opacity);return o;})).toBe(1);
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    await page.screenshot({path:`${out}/profile-${width}.png`,fullPage:true});assert.deepEqual(errors,[]);
    console.log(`PASS ${width}px: DJ card/teaser/profile, supplied photo, biography, verified socials, no fake talk/MC, no overflow or page errors.`);
    await page.close();
  }
} finally {await browser?.close();await server.close();}
