import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';

const base = process.argv[2] || 'http://127.0.0.1:3197';
const browser = await chromium.launch({ headless: true });
try {
  for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
    const page = await browser.newPage({ viewport });
    for (const path of ['/register', '/tickets', ...['lucifer', 'object', 'ping-pong', 'raise', 'skopje-e-moj-grad', 't-shirts', 'zero'].map(slug => `/qr/${slug}`)]) {
      await page.goto(base + path, { waitUntil: 'networkidle' });
      await page.getByRole('heading', { name: 'Registration closed', exact: true }).waitFor();
      assert.equal(await page.locator('input[type=password]').count(), 0);
      assert.equal(await page.getByRole('button', { name: /create account|get ticket|apply now/i }).count(), 0);
      assert.equal(await page.locator('a[href*="hievents.foundry.mk"], a[href*="Student%20Ticket"]').count(), 0);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      const target = path === '/register' ? '/login' : '/agenda';
      assert.ok(await page.locator(`a[href="${target}"]`).count());
      console.log(JSON.stringify({ base, path, viewport, closureVisible: true, signupAndCheckoutAbsent: true, noHorizontalOverflow: true }));
    }
    await page.goto(base + '/login', { waitUntil: 'networkidle' });
    await page.getByText('New account registration is closed.', { exact: false }).waitFor();
    assert.equal(await page.locator('a[href="/register"]').count(), 0);
    assert.ok(await page.locator('input[type=password]').count());
    console.log(JSON.stringify({ path: '/login', viewport, existingLoginAvailable: true }));
    await page.close();
  }
} finally { await browser.close(); }
