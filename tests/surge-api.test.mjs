import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import test from 'node:test'
import { createSurgeHandler } from '../server/surge-api.ts'
import { STARTER_DESIGN } from '../src/data/library.ts'

async function withServer(options, callback) {
  const handler = createSurgeHandler(options)
  const server = createServer((request, response) => { void handler(request, response) })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const url = `http://127.0.0.1:${server.address().port}`
  try { await callback(url) }
  finally { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)) }
}

const request = (url, body = { message: 'Explain this circuit', design: STARTER_DESIGN, history: [] }, headers = {}) =>
  fetch(url + '/api/surge/chat', { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) })

test('provider status never exposes the credential', async () => {
  await withServer({ apiKey: 'test-private-key' }, async (url) => {
    const response = await fetch(url + '/api/surge/status')
    const body = await response.text()
    assert.equal(response.status, 200)
    assert.equal(JSON.parse(body).configured, true)
    assert.ok(!body.includes('test-private-key'))
  })
})

test('cross-origin requests and invalid circuit bodies are rejected before calling Gemini', async () => {
  await withServer({ apiKey: 'test-private-key', fetch: () => { throw new Error('Unexpected provider call') } }, async (url) => {
    assert.equal((await request(url, undefined, { Origin: 'https://unrelated.example' })).status, 403)
    assert.equal((await request(url, { message: 'Hello', design: {} })).status, 400)
    assert.equal((await request(url, { message: '', design: STARTER_DESIGN })).status, 400)
  })
})

test('a missing credential produces a clear error instead of a fabricated response', async () => {
  await withServer({}, async (url) => {
    const response = await request(url)
    assert.equal(response.status, 503)
    assert.match((await response.json()).error, /not connected/)
  })
})

test('Gemini receives current circuit context and valid incremental proposals reach the client', async () => {
  const reply = { reply: 'I suggest changing R1 to 22 kΩ.', actions: [{ type: 'update_component', id: 'r1', value: '22 kΩ' }] }
  let calls = 0
  await withServer({
    apiKey: 'test-private-key',
    fetch: async (endpoint, init) => {
      calls++
      assert.ok(endpoint.startsWith('https://generativelanguage.googleapis.com/'))
      assert.equal(init.headers['x-goog-api-key'], 'test-private-key')
      assert.ok(!endpoint.includes('test-private-key'))
      const body = JSON.parse(init.body)
      assert.ok(body.contents.at(-1).parts[0].text.includes('Ambient light controller'))
      assert.equal(body.generationConfig.responseMimeType, 'application/json')
      return Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify(reply) }] } }] })
    },
  }, async (url) => {
    const response = await request(url)
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), reply)
    assert.equal(calls, 1)
  })
})

test('malformed model actions and upstream errors cannot alter the workspace or leak credentials', async () => {
  await withServer({
    apiKey: 'test-private-key',
    fetch: async () => Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify({ reply: 'Change', actions: [{ type: 'remove_component', id: 'absent' }] }) }] } }] }),
  }, async (url) => { assert.equal((await request(url)).status, 502) })
  await withServer({
    apiKey: 'test-private-key',
    fetch: async () => new Response('test-private-key private provider response', { status: 429 }),
  }, async (url) => {
    const response = await request(url)
    assert.equal(response.status, 429)
    assert.ok(!(await response.text()).includes('test-private-key'))
  })
})

test('depleted provider credits show an actionable billing error', async () => {
  await withServer({
    apiKey: 'test-private-key',
    fetch: async () => new Response('private provider billing details', { status: 402 }),
  }, async (url) => {
    const response = await request(url)
    assert.equal(response.status, 402)
    const body = await response.json()
    assert.match(body.error, /prepaid credits/)
    assert.ok(!body.error.includes('private provider billing details'))
  })
})

test('workbench chat returns validated pin-level actions through the private API', async () => {
  const proposal = { reply: 'Add a battery and connect its positive terminal to the top rail.', actions: [
    { tool: 'place_battery' },
    { tool: 'add_wire', from: 'battery_0_pin0', to: 'tp_3', color: 'red' },
  ] }
  await withServer({ apiKey: 'test-private-key', fetch: async () => Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify(proposal) }] } }] }) }, async (url) => {
    const response = await fetch(url + '/api/surge/workbench', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'Add a battery', markdown: 'Empty board', board: { components: [], wires: [] }, history: [] }),
    })
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), proposal)
  })
})
