// Runs the hard prompts in bench/cases.mjs through the real editor and chat, and
// checks what each built circuit does.
//
//   npm run dev                      (in another window; the chat model is whatever it serves)
//   node bench/run.mjs               every case, 2 tries each
//   node bench/run.mjs count-0-9 dice --tries 3
//
// SURGE_URL picks the server (default http://127.0.0.1:5173). Results are printed
// and saved to bench/results/<time>.json.

import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { setTimeout as wait } from 'node:timers/promises'
import puppeteer from 'puppeteer-core'
import { CASES, DIGITS } from './cases.mjs'

const BASE = process.env.SURGE_URL || 'http://127.0.0.1:5173'
const argv = process.argv.slice(2)
const triesAt = argv.indexOf('--tries')
const TRIES = triesAt >= 0 ? Number(argv[triesAt + 1]) : 2
const POOL = Number(process.env.SURGE_BENCH_POOL || 3)
const picked = argv.filter((a, i) => !a.startsWith('--') && argv[i - 1] !== '--tries')
const cases = picked.length ? CASES.filter(c => picked.includes(c.id)) : CASES
const CHROME = process.env.CHROME_PATH || ['C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/google-chrome', '/usr/bin/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find(existsSync)

async function openEditor(browser) {
  const page = await browser.newPage()
  await page.setViewport({ width: 1280, height: 800 })
  await page.evaluateOnNewDocument(() => { try { localStorage.clear() } catch { /* storage blocked */ } })
  page.errors = []
  page.on('pageerror', e => page.errors.push(e.message))
  await page.goto(BASE + '/app.html', { waitUntil: 'networkidle0', timeout: 60000 })
  await page.waitForFunction(() => window.App?.state?.breadboard && window.surgeAsk, { timeout: 60000 })
  return page
}

// Sends one chat message, waits for the reply, and applies the proposal. Returns the reply text.
async function ask(page, message) {
  const before = await page.evaluate(() => document.querySelectorAll('#surge-messages .chat-msg').length)
  await page.evaluate(m => { window.surgeQuick(m) }, message)
  await page.waitForFunction(n => {
    const done = !document.getElementById('surge-send')?.hasAttribute('disabled')
    return done && document.querySelectorAll('#surge-messages .chat-msg:not(.typing)').length > n
  }, { timeout: 300000, polling: 500 }, before)
  return page.evaluate(() => {
    const msgs = [...document.querySelectorAll('#surge-messages .chat-msg')]
    const reply = msgs.filter(m => m.classList.contains('ai')).pop()?.innerText || msgs.pop()?.innerText || ''
    const pending = document.getElementById('surge-pending-bar')?.style.display === 'flex'
    const count = document.getElementById('surge-pending-count')?.textContent || ''
    if (pending) window.surgeAcceptChanges()
    return { reply, pending, count }
  })
}

// What the board shows over simulated time, from the sketch run, without waiting in real time.
function trace(page, ms, step) {
  return page.evaluate(async (ms, step) => {
    const comps = App.state.components, wires = App.state.wires
    const boards = []
    comps.forEach((c, i) => { if (c.type === 'esp32') boards.push(i) })
    if (!boards.length) return { error: 'no ESP32 on the board' }
    const runs = await Promise.all(boards.map(i => App.runSketch(App.getSketch(comps[i].values && comps[i].values.sketch), { maxMs: ms })))
    const bad = runs.find(r => r.error)
    if (bad) return { error: 'sketch: ' + bad.error }
    const samples = [], seen = new Map()
    for (let t = 0; t < ms; t += step) {
      const pins = {}
      boards.forEach((ci, k) => { pins[ci] = runs[k].at(t) })
      const key = JSON.stringify(pins)
      if (!seen.has(key)) {
        const r = App.simAnalyze(comps, wires, { pins })
        seen.set(key, {
          digits: comps.filter(c => c.type === 'seg7').map(c => Object.keys((r.segments && r.segments.get(c)) || {}).sort().join('')),
          leds: (r.ledsOn || []).map(c => (c.values && c.values.color) || 'red'),
          errs: (r.lines || []).filter(l => l.cls === 'sim-err').map(l => l.text.trim()),
        })
      }
      samples.push({ t, step, ...seen.get(key) })
    }
    return { samples }
  }, ms, step)
}

// Runs the circuit in the editor for `ms` of real time and lists the digits the display
// showed, as a person watching it would see them. This is the live playback, which the
// trace above does not go through.
async function watch(page, ms) {
  const setup = await page.evaluate(() => {
    const display = App.state.components.find(c => c.type === 'seg7')
    if (!display) return 'no 7-segment display on the board'
    window.__shown = []
    const set = display.group.userData.setSegments
    display.group.userData.setSegments = lit => { window.__shown.push(Object.keys(lit || {}).sort().join('')); return set(lit) }
    App.runSimulation()
    return null
  })
  if (setup) return { error: setup }
  await wait(ms)
  const shown = await page.evaluate(() => { App.stopSimulation(); return window.__shown })
  const digits = []
  for (const s of shown) { const d = DIGITS[s]; if (d !== undefined && digits[digits.length - 1] !== d) digits.push(d) }
  return { digits }
}

// Presses buttons in the running editor, as a person clicks them, and reads the digit after each.
async function press(page, order) {
  const setup = await page.evaluate(() => {
    const display = App.state.components.find(c => c.type === 'seg7')
    if (!display) return 'no 7-segment display on the board'
    const buttons = App.state.components.filter(c => c.type === 'button')
    if (!buttons.length) return 'no push button on the board'
    window.__lit = ''
    const set = display.group.userData.setSegments
    display.group.userData.setSegments = lit => { window.__lit = Object.keys(lit || {}).sort().join(''); return set(lit) }
    // Left to right on the board, by the lowest column a button sits in
    const col = b => Math.min(...(b.holes || []).map(h => h.col))
    window.__buttons = buttons.slice().sort((a, b) => col(a) - col(b))
    App.runSimulation()
    return null
  })
  if (setup) return { error: setup }
  const read = () => page.evaluate(() => window.__lit)
  await wait(1500)
  const lit = [await read()]
  for (const b of order) {
    const pressed = await page.evaluate(i => {
      const btn = window.__buttons[i]
      if (!btn) return false
      App.toggleButton(btn); App.runSimulation()
      return true
    }, b)
    if (!pressed) return { error: `there is no button ${b + 1}` }
    await wait(350)
    await page.evaluate(i => { App.toggleButton(window.__buttons[i]); App.runSimulation() }, b)
    await wait(900)
    lit.push(await read())
  }
  const errs = await page.evaluate(() => [...document.querySelectorAll('#sim-results .sim-err')].map(e => e.innerText.trim()))
  return { digits: lit.map(s => DIGITS[s] ?? (s ? `?${s}` : ' ')), errs }
}

async function runOne(browser, c, attempt) {
  const t0 = Date.now()
  const page = await openEditor(browser)
  const r = await build(page, c, attempt)
  r.seconds = Math.round((Date.now() - t0) / 1000)
  if (page.errors.length) r.pageErrors = page.errors
  await page.close()
  return r
}

async function build(page, c, attempt) {
  const out = { id: c.id, attempt }
  try {
    const first = await ask(page, c.prompt)
    out.reply = first.reply
    out.changes = first.count
    if (!first.pending) return { ...out, pass: false, why: 'no changes proposed: ' + first.reply.slice(0, 160) }
    await wait(1500)
    if (c.followUp) {
      const next = await ask(page, c.followUp)
      out.followUpReply = next.reply
      if (!next.pending) return { ...out, pass: false, why: 'no changes for the follow-up: ' + next.reply.slice(0, 160) }
      await wait(1500)
    }
    out.board = await page.evaluate(() => App.state.components.map(c => c.type).join(','))
    out.sketch = await page.evaluate(() => {
      const esp = App.state.components.filter(c => c.type === 'esp32')
      return esp.map(c => App.getSketch(c.values && c.values.sketch)).join('\n// ---\n')
    })
    let result
    if (c.presses) {
      const r = await press(page, c.presses)
      if (r.error) return { ...out, pass: false, why: r.error }
      out.digits = r.digits
      result = c.check(r.digits)
      if (result.pass && r.errs.length) result = { pass: false, why: 'simulator errors: ' + r.errs.join('; ') }
    } else {
      const r = await trace(page, c.traceMs, 50)
      if (r.error) return { ...out, pass: false, why: r.error }
      const errs = [...new Set(r.samples.flatMap(s => s.errs))]
      result = errs.length ? { pass: false, why: 'simulator errors: ' + errs.join('; ') } : c.check(r.samples)
      if (result.pass && c.watch) {
        const w = await watch(page, c.watch.ms)
        out.watched = w.digits
        if (w.error) result = { pass: false, why: w.error }
        else if (!w.digits.join(' ').includes(c.watch.see.join(' '))) result = { pass: false, why: `the live display showed ${w.digits.join(' ')}, not ${c.watch.see.join(' ')}` }
      }
    }
    return { ...out, ...result }
  } catch (e) {
    return { ...out, pass: false, why: 'bench error: ' + e.message }
  }
}

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, protocolTimeout: 600000,
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
const jobs = cases.flatMap(c => Array.from({ length: TRIES }, (_, k) => [c, k + 1]))
const results = []
console.log(`${jobs.length} runs against ${BASE}, ${POOL} at a time`)
let next = 0
await Promise.all(Array.from({ length: POOL }, async () => {
  while (next < jobs.length) {
    const [c, k] = jobs[next++]
    const r = await runOne(browser, c, k)
    results.push(r)
    console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${c.id} #${k}  ${r.why}  (${r.seconds} s)`)
  }
}))
await browser.close()

console.log('\nCase                 Passed')
for (const c of cases) {
  const rs = results.filter(r => r.id === c.id)
  console.log(`${c.id.padEnd(20)} ${rs.filter(r => r.pass).length}/${rs.length}`)
}
const total = results.filter(r => r.pass).length
console.log(`Total                ${total}/${results.length}`)

const dir = new URL('./results/', import.meta.url)
mkdirSync(dir, { recursive: true })
const file = new URL(new Date().toISOString().replace(/[:.]/g, '-') + '.json', dir)
writeFileSync(file, JSON.stringify({ base: BASE, tries: TRIES, results }, null, 2))
console.log('Saved ' + file.pathname)
