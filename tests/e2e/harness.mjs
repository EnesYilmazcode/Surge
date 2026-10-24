// Shared setup for the end-to-end tests: a dev server on its own port, a
// headless Chrome, and a few helpers for driving the editor.
//
// Chrome is found through CHROME_PATH, or at the usual install locations.

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import puppeteer from 'puppeteer-core';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const PORT = Number(process.env.E2E_PORT || 5179);
export const BASE = `http://127.0.0.1:${PORT}`;

const CHROME_CANDIDATES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
];

export const wait = ms => sleep(ms);

export async function startServer() {
  const vite = fileURLToPath(new URL('../../node_modules/vite/bin/vite.js', import.meta.url));
  const child = spawn(process.execPath, [vite, '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'],
    { cwd: ROOT, stdio: 'ignore' });
  for (let i = 0; i < 120; i++) {
    try {
      const res = await fetch(`${BASE}/app.html`);
      if (res.ok) return child;
    } catch { /* not up yet */ }
    await sleep(500);
  }
  child.kill();
  throw new Error(`The dev server did not start on ${BASE}`);
}

export async function startBrowser() {
  const executablePath = process.env.CHROME_PATH || CHROME_CANDIDATES.find(existsSync);
  if (!executablePath) throw new Error('No Chrome found. Set CHROME_PATH to a Chrome executable.');
  return puppeteer.launch({
    executablePath,
    headless: true,
    args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });
}

// A page with the editor loaded and its App ready. Page errors are collected in page.errors.
export async function openEditor(browser, path = '/app.html') {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  page.errors = [];
  page.on('pageerror', e => page.errors.push(e.message));
  await page.goto(BASE + path, { waitUntil: 'networkidle0', timeout: 60000 });
  await page.waitForFunction(() => window.App?.state?.breadboard, { timeout: 60000 });
  return page;
}

// Screen position, in page pixels, of a hole on the board (a row letter and a column).
export async function holePoint(page, col, row) {
  return page.evaluate((col, row) => {
    const hole = App.state.breadboard.getHole(col, row);
    const v = hole.world.clone();
    v.y = 0.2;
    v.project(App.camera);
    const r = document.getElementById('canvas').getBoundingClientRect();
    return { x: r.left + (v.x + 1) / 2 * r.width, y: r.top + (1 - v.y) / 2 * r.height };
  }, col, row);
}

// Hover over a hole and click it, as a person would.
export async function clickHole(page, col, row) {
  const p = await holePoint(page, col, row);
  await page.mouse.move(p.x, p.y);
  await wait(200);
  await page.mouse.down();
  await page.mouse.up();
  await wait(600);
}

// The simulator's readout, as text.
export function readout(page) {
  return page.evaluate(() => (document.getElementById('sim-results')?.innerText || '').replace(/\s+/g, ' ').trim());
}

// Run the circuit and report whether the LED turned on during a few samples.
export async function ledLitWhileRunning(page, samples = 8) {
  await page.evaluate(() => App.runSimulation());
  let lit = false;
  for (let i = 0; i < samples && !lit; i++) {
    await wait(400);
    lit = /LED ON/.test(await readout(page));
  }
  await page.evaluate(() => App.stopSimulation());
  return lit;
}
