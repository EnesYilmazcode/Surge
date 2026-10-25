import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { askCodex, CodexUnavailableError } from '../server/codex-cli.ts'
import { createSurgeHandler } from '../server/surge-api.ts'

// On Windows the adapter starts the command through a shell, so the fake runs as `node <script>`.
const FAKE = fileURLToPath(new URL('./helpers/fake-codex.mjs', import.meta.url))
const SCHEMA = { type: 'object', properties: { reply: { type: 'string' }, actions: { type: 'array' } }, required: ['reply', 'actions'] }
const fake = (options = {}) => ({ command: 'node', commandArgs: [FAKE], ...options })

async function withMode(mode, callback) {
  const previous = process.env.FAKE_CODEX_MODE
  process.env.FAKE_CODEX_MODE = mode
  try { await callback() }
  finally { if (previous === undefined) delete process.env.FAKE_CODEX_MODE; else process.env.FAKE_CODEX_MODE = previous }
}

async function withServer(options, callback) {
  const handler = createSurgeHandler(options)
  const server = createServer((request, response) => { void handler(request, response) })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  try { await callback(`http://127.0.0.1:${server.address().port}`) }
  finally { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)) }
}

const workbench = (url) => fetch(url + '/api/surge/workbench', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    message: 'Build an LED circuit.',
    markdown: '# Board\nEmpty',
    board: { components: [], wires: [] },
    history: [{ role: 'user', text: 'Hi' }, { role: 'model', text: 'Hello' }],
  }),
})

test('askCodex returns the reply, runs read-only and ephemeral, and puts the system text first', async () => {
  await withMode('ok', async () => {
    const out = await askCodex({ system: 'You are Surge.', prompt: 'Build an LED.', schema: SCHEMA }, fake())
    assert.match(out.reply, /^Fake Codex answered\./)
    assert.equal(out.seen.readOnly, true)
    assert.equal(out.seen.ephemeral, true)
    assert.deepEqual(out.seen.schemaRequires, ['reply', 'actions'])
    assert.equal(out.seen.model, null)
    assert.equal(out.seen.systemFirst, true)
  })
})

test('askCodex passes a model when one is set', async () => {
  await withMode('ok', async () => {
    const out = await askCodex({ system: 'You are Surge.', prompt: 'p', schema: SCHEMA }, fake({ model: 'gpt-5.5' }))
    assert.equal(out.seen.model, 'gpt-5.5')
  })
})

test('askCodex rejects a run that writes no reply, a non-zero exit, and a missing install', async () => {
  await withMode('no-file', async () => {
    await assert.rejects(askCodex({ system: 's', prompt: 'p', schema: SCHEMA }, fake()), /without a reply/)
  })
  await withMode('crash', async () => {
    await assert.rejects(askCodex({ system: 's', prompt: 'p', schema: SCHEMA }, fake()), /exited with code 2/)
  })
  await assert.rejects(
    askCodex({ system: 's', prompt: 'p', schema: SCHEMA }, { command: 'surge-no-such-codex-cli' }),
    CodexUnavailableError,
  )
})

test('aborting a Codex turn stops the process and rejects at once', async () => {
  await withMode('hang', async () => {
    const controller = new AbortController()
    setTimeout(() => controller.abort(), 300)
    const started = Date.now()
    await assert.rejects(askCodex({ system: 's', prompt: 'p', schema: SCHEMA, signal: controller.signal }, fake()), /aborted/)
    assert.equal(Date.now() - started < 8000, true)
  })
})

test('the chat route answers through Codex and reports it as the provider', async () => {
  await withMode('ok', async () => {
    await withServer({ provider: 'codex', codex: fake({ model: 'gpt-5.5' }) }, async (url) => {
      const status = await (await fetch(url + '/api/surge/status')).json()
      assert.deepEqual(status, { configured: true, provider: 'Codex', model: 'gpt-5.5' })
      const res = await workbench(url)
      assert.equal(res.status, 200)
      const body = await res.json()
      assert.match(body.reply, /^Fake Codex answered\. History: true$/)
      assert.deepEqual(body.actions, [])
    })
  })
})

test('the chat route says plainly when Codex is missing', async () => {
  await withServer({ provider: 'codex', codex: { command: 'surge-no-such-codex-cli' } }, async (url) => {
    const res = await workbench(url)
    assert.equal(res.status, 503)
    assert.match((await res.json()).error, /Codex is not installed/)
  })
})

test('strictSchema lists every property as required, and makes the optional ones nullable', async () => {
  const { strictSchema, dropNulls } = await import('../server/codex-cli.ts')
  const action = {
    type: 'object',
    properties: { tool: { type: 'string', enum: ['place_resistor'] }, holeA: { type: 'string' }, resistance: { type: 'number' } },
    required: ['tool', 'holeA'],
    additionalProperties: false,
  }
  const strict = strictSchema({ type: 'object', properties: { reply: { type: 'string' }, actions: { type: 'array', items: { anyOf: [action] } } }, required: ['reply', 'actions'] })
  const item = strict.properties.actions.items.anyOf[0]
  assert.deepEqual(item.required, ['tool', 'holeA', 'resistance'])
  assert.deepEqual(item.properties.resistance.anyOf[1], { type: 'null' })
  assert.deepEqual(strict.required, ['reply', 'actions'])
  // The model's nulls go, so a validator only sees the fields it meant
  assert.deepEqual(dropNulls({ reply: 'ok', actions: [{ tool: 'place_resistor', holeA: 'a1', resistance: null }] }), { reply: 'ok', actions: [{ tool: 'place_resistor', holeA: 'a1' }] })
})
