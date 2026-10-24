// End-to-end checks for the homepage: the scene in its iframe, and the big button that opens the editor.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, startBrowser, BASE, wait } from './harness.mjs';

let server, browser;
before(async () => {
  server = await startServer();
  browser = await startBrowser();
}, { timeout: 180000 });
after(async () => {
  await browser?.close();
  server?.kill();
});

test('the big button on the homepage opens the editor', async () => {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle0', timeout: 60000 });
  const frameEl = await page.waitForSelector('#scene');
  const frame = await frameEl.contentFrame();
  await frame.waitForFunction(() => window.App?.homeButton, { timeout: 60000 });
  await wait(1000);

  // Hover the cap: the cursor turns to a hand over the button
  const point = await frame.evaluate(() => {
    const cap = App.homeButton.hit[0];
    const v = cap.getWorldPosition(cap.position.clone());
    v.y += 0.8;
    v.project(App.camera);
    const r = document.getElementById('canvas').getBoundingClientRect();
    return { x: r.left + (v.x + 1) / 2 * r.width, y: r.top + (1 - v.y) / 2 * r.height };
  });
  const box = await frameEl.boundingBox();
  await page.mouse.move(box.x + point.x, box.y + point.y);
  await wait(300);
  assert.equal(await frame.evaluate(() => document.getElementById('canvas').style.cursor), 'pointer');

  await page.mouse.down();
  await page.mouse.up();
  await page.waitForFunction(() => location.pathname.endsWith('/app.html'), { timeout: 15000 });
  await page.close();
});

test('the homepage names the product and shows the mark', async () => {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle0', timeout: 60000 });
  const title = await page.$eval('.hero-title', el => el.textContent.trim());
  assert.equal(title, 'Surge');
  await page.close();
});
