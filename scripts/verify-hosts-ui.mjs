// Mounted-component acceptance using a read-only public-field source snapshot.
// Not a full-route/deployment test. Run after pnpm build, passing the snapshot path.
import { createServer } from "vite";
import solid from "@solidjs/vite-plugin";
import { chromium, expect } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { readFileSync, readdirSync, mkdirSync } from "node:fs";
import assert from "node:assert/strict";

const root = fileURLToPath(new URL("../", import.meta.url));
assert.ok(process.argv[2], "Pass a public-field PocketBase snapshot, not a private backup.");
const source = JSON.parse(readFileSync(process.argv[2], "utf8"));
const evidence = process.argv[3] || "/tmp/wts-hosts-ui-evidence";
mkdirSync(evidence, { recursive: true });
const stylesheet = readdirSync(`${root}.output/public/assets`).find((name) => name.startsWith("virtual_solid-ssr-entry-client-") && name.endsWith(".css"));
assert.ok(stylesheet, "Build production CSS first.");
const fixtureId = `${root}tests/__hosts-ui-fixture.tsx`;
let programme;
let sessions;
const server = await createServer({ configFile: false, root, plugins: [solid({ ssr: true }), {
  name: "hosts-ui-fixture",
  resolveId(id) { if (id === "/__hosts-ui-fixture.tsx") return fixtureId; },
  load(id) {
    if (id !== fixtureId) return;
    return `import { render } from "@solidjs/web";
      import { AgendaProgramme } from "~/components/AgendaProgramme";
      import { SessionParticipants } from "~/components/conference/SessionParticipants";
      const programme = ${JSON.stringify(programme)};
      const sessions = ${JSON.stringify(sessions)};
      const slug = new URLSearchParams(location.search).get("session");
      const session = sessions.find(s => s.slug === slug);
      render(() => <main class="p-4 mx-auto max-w-7xl text-white"><h1>Host presentation — public snapshot component check</h1>
        {session ? <div class="max-w-4xl mx-auto"><h2>{session.title}</h2><SessionParticipants speakers={session.speakers} hosts={session.hosts}/></div> : <AgendaProgramme programme={programme} id="host-agenda"/>}
      </main>, document.getElementById("app"));`;
  },
  configureServer(server) { server.middlewares.use(async (req, res, next) => {
    // Proxy on the fixture server so navigation cannot invalidate a Playwright
    // Route while its image fetch is still pending. Use the real image service.
    if (req.url?.startsWith('/api/image?')) {
      try {
        const image = await fetch(`https://wts.sh${req.url}`, { signal: AbortSignal.timeout(20_000) });
        const body = Buffer.from(await image.arrayBuffer());
        if (!res.destroyed) {
          res.statusCode = image.status;
          res.setHeader('Content-Type', image.headers.get('content-type') || 'application/octet-stream');
          res.end(body);
        }
      } catch {
        if (!res.destroyed) { res.statusCode = 502; res.end('Fixture image proxy failed.'); }
      }
      return;
    }
    if (req.url?.split("?")[0] !== "/") return next();
    res.setHeader("Content-Type", "text/html");
    res.end(await server.transformIndexHtml("/", `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/@fs/${root}.output/public/assets/${stylesheet}"></head><body style="background:#100d1e"><div id="app"></div><script type="module" src="/__hosts-ui-fixture.tsx"></script></body></html>`));
  }); },
}], resolve: { alias: { "~": `${root}src`, ".velite": `${root}.velite` } }, server: { host: "127.0.0.1", port: 0 }, logLevel: "error" });
let browser;
try {
  // Compute file URLs server-side, avoiding localhost's browser PB URL rewrite.
  process.env.PUBLIC_POCKETBASE_URL = "https://pb-2026.wts.sh";
  const { buildPublicAgenda, publicAgendaSession } = await server.ssrLoadModule("/src/lib/programme-public.ts");
  const agenda = buildPublicAgenda(source.conference_days, source.appearance_events, source.event_programmes, source.agenda_tracks, source.agenda_slots, source.sessions, source.speakers);
  programme = agenda.days.find(day => day.key === "main-day").programmes[0];
  const byId = new Map(source.speakers.map(s => [s.id, s]));
  const bySlug = new Map(source.speakers.map(s => [s.slug, s]));
  for (const slug of ['darko-bozhinovski', 'miodrag-cekikj']) assert.equal(bySlug.get(slug).is_mc, false);
  sessions = source.sessions.filter(s => s.published && s.format === "Fireside chat").map(s => {
    const projected = publicAgendaSession(s, byId);
    const detail = person => ({ slug: person.slug, displayName: person.name, photoUrl: person.photoUrl, affiliation: bySlug.get(person.slug).affiliation || "", isMc: bySlug.get(person.slug).is_mc, sessionCount: 1, appearanceEvents: [] });
    return { ...projected, speakers: projected.speakers.map(detail), hosts: projected.hosts?.map(detail) };
  });
  assert.equal(sessions.length, 6);
  await server.listen();
  const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
  browser = await chromium.launch({ headless: true });
  for (const width of [390, 1440]) {
    const page = await browser.newPage({ viewport: { width, height: 1000 } });
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));

    await page.goto(origin);
    const assignedMcs = [['Stage 1', 'tony-edwards'], ['Stage 2', 'stojan-ezhov'], ['Stage 3', 'dimitar-grozdanov'], ['Stage 4', 'nikola-dinevski'], ['Stage 5', 'marijana-ilovska-zlatanovska']];
    for (const [stageName, slug] of assignedMcs) {
      const track = programme.tracks.find(t => t.name === stageName);
      if (width < 1024) await page.getByRole('combobox', { name: 'Choose a stage' }).selectOption(track.key);
      const mcs = page.getByRole('list', { name: `${stageName} MCs`, exact: true });
      await expect(mcs).toBeVisible();
      await expect(mcs.locator('a')).toHaveCount(1);
      await expect(mcs.locator('a')).toHaveAttribute('href', `/speakers/${slug}`);
      await mcs.scrollIntoViewIfNeeded();
      await expect.poll(() => mcs.locator('img').evaluateAll(images => images.map(i => ({ loaded: i.complete && i.naturalWidth > 0, src: i.currentSrc }))), { message: `${width}px ${stageName} MC portrait must decode` }).toEqual([{ loaded: true, src: expect.any(String) }]);
      await expect(page.locator('[data-stage-mcs]:visible')).toHaveCount(width < 1024 ? 1 : 5);
      if (stageName === 'Stage 5') await mcs.locator('..').screenshot({ path: `${evidence}/stage-mc-${width}.png` });
    }
    // Back to the first stage, then Stage 5: reactive selections must not retain the prior MC.
    if (width < 1024) {
      await page.getByRole('combobox', { name: 'Choose a stage' }).selectOption('stage-2');
      await expect(page.getByRole('list', { name: 'Stage 1 MCs', exact: true })).toContainText('Tony Edwards');
      await expect(page.getByRole('list', { name: 'Stage 5 MCs', exact: true })).toHaveCount(0);
    }
    if (width < 1024) await page.getByRole("combobox", { name: "Choose a stage" }).selectOption("stage-5");
    const list = width < 1024 ? page.locator('#host-agenda-mobile-slots > ol') : page.getByRole("list", { name: /all stages, chronological order/ });
    await expect(list).toBeVisible();
    const party = list.locator(':scope > li').filter({ has: page.getByRole('heading', { name: 'DJ After Party', exact: true }) });
    await expect(party).toHaveCount(1);
    await expect(party.getByRole('link', { name: 'DinaShantina', exact: true })).toHaveAttribute('href', '/speakers/dina-damjanovikj');
    await expect(party).toContainText('17:00');
    await expect(party).toContainText('18:00');
    await expect(party).toContainText('Location: Stage 1');
    await expect(party.locator('[data-session-hosts]')).toHaveCount(0);
    await expect(party.locator('a[href^="/sessions/"]')).toHaveCount(0);
    await party.scrollIntoViewIfNeeded();
    await expect.poll(() => party.locator('img').evaluateAll(images => images.length === 1 && images.every(i => i.complete && i.naturalWidth > 0))).toBe(true);
    await expect(party.locator('img')).toHaveAttribute('sizes', '40px');
    await party.screenshot({ path: `${evidence}/after-party-${width}.png` });
    for (const kind of ["Opening", "Closing"]) {
      const card = list.locator(':scope > li').filter({ has: page.getByRole("heading", { name: kind, exact: true }) });
      await expect(card.getByRole("link", { name: "Darko Bozhinovski" })).toBeVisible();
      await card.scrollIntoViewIfNeeded();
      await expect.poll(() => card.locator('img').evaluateAll(images => images.length > 0 && images.every(i => i.complete && i.naturalWidth > 0))).toBe(true);
      await expect(card).not.toContainText("Hosted by");
      if (kind === "Opening") await card.screenshot({ path: `${evidence}/opening-${width}.png` });
    }
    for (const session of sessions) {
      const card = list.locator(':scope > li').filter({ has: page.getByRole("link", { name: session.title, exact: true }) });
      const hosts = card.locator('[data-session-hosts]');
      await expect(hosts.getByRole("link", { name: session.hosts[0].displayName })).toBeVisible();
      const guests = card.getByRole("list", { name: "Speakers", exact: true });
      await expect(guests.getByRole("link", { name: session.hosts[0].displayName })).toHaveCount(0);
      assert.ok(await hosts.evaluate(e => parseFloat(getComputedStyle(e).borderTopWidth) > 0));
      const guestBox = await guests.boundingBox();
      const hostBox = await hosts.boundingBox();
      assert.ok(hostBox.y >= guestBox.y + guestBox.height);
      await hosts.scrollIntoViewIfNeeded();
      await expect.poll(() => hosts.locator('img').evaluateAll(images => images.length > 0 && images.every(i => i.complete && i.naturalWidth > 0))).toBe(true);
      if (session.slug === "fireside-who-owes-open-source-what") await card.screenshot({ path: `${evidence}/fireside-${width}.png` });
    }
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    for (const session of sessions) {
      await page.goto(`${origin}/?session=${session.slug}`);
      await expect(page.getByRole("heading", { name: "Host", exact: true })).toBeVisible();
      await expect(page.getByRole("list", { name: "Speakers", exact: true }).getByRole("link", { name: session.hosts[0].displayName })).toHaveCount(0);
      const host = page.getByRole("list", { name: "Hosts", exact: true });
      await host.scrollIntoViewIfNeeded();
      await expect.poll(() => host.locator('img').evaluateAll(images => images.length > 0 && images.every(i => i.complete && i.naturalWidth > 0))).toBe(true);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      if (session.slug === "fireside-who-owes-open-source-what") await page.screenshot({ path: `${evidence}/participants-${width}.png`, fullPage: true });
    }
    assert.deepEqual(errors, []);
    console.log(`PASS ${width}px: all five assigned stage MCs; opening/closing photos; six separated non-MC fireside hosts; decoded images; zero overflow/page errors.`);

    await page.close();
  }
  console.log(`Evidence: ${evidence}. Component checks only; no deployment claimed.`);
} finally {
  await browser?.close();
  await server.close();
}
