import assert from 'node:assert/strict'
import test from 'node:test'
import { Readable } from 'node:stream'
import { createWorkbenchHandler } from '../server/workbench-api.ts'

const board = { components: [{ type: 'resistor' }], wires: [], sketches: [] }

const message = (text, stop_reason = 'end_turn') => new Response(JSON.stringify({
  id: 'msg_test', type: 'message', role: 'assistant', model: 'claude-opus-5-5', stop_reason, stop_sequence: null,
  content: [{ type: 'text', text }], usage: { input_tokens: 10, output_tokens: 10 },
}), { status: 200, headers: { 'content-type': 'application/json' } })

const failure = (status, type, text) => new Response(JSON.stringify({ type: 'error', error: { type, message: text } }), {
  status, headers: { 'content-type': 'application/json' },
})

function call(body, options) {
  const request = Readable.from([JSON.stringify(body)])
  request.method = 'POST'
  request.headers = { 'content-type': 'application/json' }
  const response = { status: 0, text: '', writableEnded: false, destroyed: false,
    writeHead(status) { this.status = status }, end(text) { this.text = text; this.writableEnded = true },
    on() {}, off() {} }
  return createWorkbenchHandler({ provider: 'anthropic', apiKey: 'test-key', ...options })(request, response)
    .then(() => response)
}

test('the Claude path sends the schema, the earlier turns and the request, and returns the reply', async () => {
  let sent
  const fetch = async (url, init) => {
    sent = { url: String(url), headers: new Headers(init.headers), body: JSON.parse(init.body) }
    return message(JSON.stringify({ reply: 'ok', actions: [] }))
  }
  const response = await call({
    message: 'hello', markdown: '', board,
    history: [{ role: 'model', text: 'Opening reply' }, { role: 'user', text: 'Earlier question' }, { role: 'model', text: 'Earlier answer' }],
  }, { fetch })
  assert.equal(response.status, 200)
  assert.deepEqual(JSON.parse(response.text), { reply: 'ok', actions: [] })
  assert.match(sent.url, /api\.anthropic\.com\/v1\/messages$/)
  assert.equal(sent.headers.get('authorization'), 'Bearer test-key')
  assert.equal(sent.body.model, 'claude-opus-5-5')
  assert.equal(sent.body.output_config.format.type, 'json_schema')
  assert.doesNotMatch(JSON.stringify(sent.body.output_config.format.schema), /"minimum"|"maximum"/)
  assert.deepEqual(sent.body.messages.map((m) => m.role), ['user', 'assistant', 'user'])
  assert.equal(sent.body.messages[0].content, 'Earlier question')
  assert.match(sent.body.messages[2].content, /Request:\nhello$/)
})

test('a rate limit from Claude comes back as 429 and a readable message', async () => {
  const fetch = async () => failure(429, 'rate_limit_error', 'slow down')
  const response = await call({ message: 'hello', markdown: '', board, history: [] }, { fetch })
  assert.equal(response.status, 429)
  assert.match(JSON.parse(response.text).error, /request limit/)
})

test('an account out of credits comes back as 402 with the next step', async () => {
  const fetch = async () => failure(400, 'invalid_request_error', 'Your credit balance is too low to access the Anthropic API.')
  const response = await call({ message: 'hello', markdown: '', board, history: [] }, { fetch })
  assert.equal(response.status, 402)
  assert.match(JSON.parse(response.text).error, /Claude Console/)
})

test('a rejected key is reported without echoing the key', async () => {
  const fetch = async () => failure(401, 'authentication_error', 'invalid x-api-key')
  const response = await call({ message: 'hello', markdown: '', board, history: [] }, { fetch })
  assert.equal(response.status, 502)
  assert.match(JSON.parse(response.text).error, /ANTHROPIC_API_KEY/)
  assert.doesNotMatch(response.text, /test-key/)
})

test('a reply cut off by max_tokens is not used', async () => {
  const fetch = async () => message('{"reply": "partial', 'max_tokens')
  const response = await call({ message: 'hello', markdown: '', board, history: [] }, { fetch })
  assert.equal(response.status, 502)
})

test('without a server key the Claude path refuses before calling out', async () => {
  let called = false
  const response = await call({ message: 'hello', markdown: '', board, history: [] }, { apiKey: undefined, fetch: async () => { called = true; return message('{}') } })
  assert.equal(response.status, 503)
  assert.equal(called, false)
})
