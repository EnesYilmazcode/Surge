import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { BASE, startServer, startBrowser, openEditor } from './harness.mjs';

let server, browser;
before(async () => {
  server = await startServer();
  browser = await startBrowser();
}, { timeout: 180000 });
after(async () => { await browser?.close(); server?.kill(); });

test('Share copies a link that restores the circuit in a fresh browser context', async () => {
  const page = await openEditor(browser);
  const expected = await page.evaluate(async () => {
    const data = await fetch('/editor/demo.surge').then(response => response.json());
    App.loadCircuitData(data);
    App.state.circuitName = 'Shared LED — 電路';
    Object.defineProperty(navigator.clipboard, 'writeText', { configurable: true, value: async text => { window.copiedLink = text; } });
    return App.exportBoard();
  });
  await page.click('button[onclick="App.shareCircuit()"]');
  await page.waitForFunction(() => document.getElementById('hint-text').textContent === 'Link copied!');
  const link = await page.evaluate(() => window.copiedLink);
  assert.ok(link.startsWith(BASE + '/app.html#circuit=v1.'));
  const recipientContext = await browser.createBrowserContext();
  try {
    const recipient = await recipientContext.newPage();
    await recipient.setViewport({ width: 1440, height: 900 });
    await recipient.goto(link, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await recipient.waitForFunction(() => Boolean(window.App?.sharedCircuitReady), { timeout: 60000 });
    await recipient.evaluate(() => App.sharedCircuitReady);
    assert.deepEqual(await recipient.evaluate(() => App.exportBoard()), expected);
    assert.equal(await recipient.evaluate(() => App.state.circuitName), 'Shared LED — 電路');
    assert.equal(await recipient.$eval('#hint-text', node => node.textContent), 'Shared circuit opened');
  } finally { await recipientContext.close(); }
  assert.deepEqual(page.errors, []);
  await page.close();
});

test('a blocked clipboard offers the actual link for manual copying', async () => {
  const page = await openEditor(browser);
  await page.evaluate(() => {
    Object.defineProperty(navigator.clipboard, 'writeText', { configurable: true, value: async () => { throw new Error('denied'); } });
    document.execCommand = () => false;
    window.prompt = (message, link) => { window.manualLink = link; };
  });
  await page.click('button[onclick="App.shareCircuit()"]');
  await page.waitForFunction(() => window.manualLink);
  assert.match(await page.evaluate(() => window.manualLink), /#circuit=v1\./);
  assert.notEqual(await page.$eval('#hint-text', node => node.textContent), 'Link copied!');
  await page.close();
});
