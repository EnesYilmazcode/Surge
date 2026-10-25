import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { askClaude, ClaudeUnavailableError } from '../server/claude-cli.ts'
import { createSurgeHandler } from '../server/surge-api.ts'

const FAKE = fileURLToPath(new URL('./helpers/fake-claude.mjs', import.meta.url))
const SCHEMA = { type: 'object', properties: { reply: { type: 'string' }, actions: { type: 'array' } }, required: ['reply', 'actions'] }
const fake = (options = {}) => ({ command: process.execPath, commandArgs: [FAKE], model: 'sonnet', ...options })

async function withMode(mode, callback) {
  const previous = process.env.FAKE_CLAUDE_MODE
  process.env.FAKE_CLAUDE_MODE = mode
  try { await callback() }
  finally { if (previous === undefined) delete process.env.FAKE_CLAUDE_MODE; else process.env.FAKE_CLAUDE_MODE = previous }
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

test('askClaude returns the structured output and sends the prompt on stdin with no tools', async () => {
  await withMode('ok', async () => {
    const out = await askClaude({ system: 'You are Surge.', prompt: 'Build an LED.', schema: SCHEMA }, fake())
    assert.equal(out.reply.startsWith('Fake Claude answered.'), true)
    assert.equal(out.seen.model, 'sonnet')
    assert.equal(out.seen.tools, '')          // no tools, so the model cannot touch files or run commands
    assert.equal(out.seen.hasSchema, true)
    assert.equal(out.seen.systemPrompt, 'You are Surge.')
    assert.equal(out.seen.promptTail.endsWith('Build an LED.'), true)
  })
})

test('askClaude falls back to parsing the result text when no structured output is given', async () => {
  await withMode('result-only', async () => {
    const out = await askClaude({ system: 's', prompt: 'p', schema: SCHEMA }, fake())
    assert.equal(out.reply.startsWith('Fake Claude answered.'), true)
  })
})

test('askClaude rejects an error envelope, non-JSON output, and a non-zero exit', async () => {
  await withMode('error', async () => {
    await assert.rejects(askClaude({ system: 's', prompt: 'p', schema: SCHEMA }, fake()), /did not finish/)
  })
  await withMode('garbage', async () => {
    await assert.rejects(askClaude({ system: 's', prompt: 'p', schema: SCHEMA }, fake()), /not JSON/)
  })
  await withMode('crash', async () => {
    await assert.rejects(askClaude({ system: 's', prompt: 'p', schema: SCHEMA }, fake()), /exited with code 3: simulated crash/)
  })
})

test('a missing Claude Code install is reported as unavailable, not as a bad reply', async () => {
  await assert.rejects(
    askClaude({ system: 's', prompt: 'p', schema: SCHEMA }, { command: 'surge-no-such-claude-cli' }),
    ClaudeUnavailableError,
  )
})

test('aborting a turn stops the CLI and rejects at once', async () => {
  await withMode('hang', async () => {
    const controller = new AbortController()
    setTimeout(() => controller.abort(), 200)
    const started = Date.now()
    await assert.rejects(askClaude({ system: 's', prompt: 'p', schema: SCHEMA, signal: controller.signal }, fake()), /aborted/)
    assert.equal(Date.now() - started < 5000, true)
  })
})

test('the chat route answers through Claude Code, keeps earlier turns, and reports the provider', async () => {
  await withMode('ok', async () => {
    await withServer({ provider: 'claude', claude: fake() }, async (url) => {
      const status = await (await fetch(url + '/api/surge/status')).json()
      assert.deepEqual(status, { configured: true, provider: 'Claude Code', model: 'sonnet' })
      const res = await workbench(url)
      assert.equal(res.status, 200)
      const body = await res.json()
      assert.match(body.reply, /^Fake Claude answered\. History: true$/)
      assert.deepEqual(body.actions, [])
    })
  })
})

test('the chat route says plainly when Claude Code is missing, and never returns a fake circuit', async () => {
  await withServer({ provider: 'claude', claude: { command: 'surge-no-such-claude-cli' } }, async (url) => {
    const res = await workbench(url)
    assert.equal(res.status, 503)
    assert.match((await res.json()).error, /Claude Code is not installed/)
  })
})
