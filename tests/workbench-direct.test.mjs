import assert from 'node:assert/strict'
import test from 'node:test'
import { Readable } from 'node:stream'
import { validateWorkbenchActions, createWorkbenchHandler } from '../server/workbench-api.ts'

const board = {
  components: [{ type: 'resistor' }, { type: 'led' }, { type: 'esp32' }],
  wires: [],
  sketches: [{ name: 'sketch.ino', code: 'void setup() {}' }],
}

test('write_sketch is accepted for a sketch the board sent', () => {
  const actions = [{ tool: 'write_sketch', file: 'sketch.ino', code: 'void setup() { pinMode(2, OUTPUT); }' }]
  assert.deepEqual(validateWorkbenchActions(actions, board), actions)
})

test('write_sketch is rejected for a file the board did not send, or for oversized text', () => {
  assert.throws(() => validateWorkbenchActions([{ tool: 'write_sketch', file: 'other.ino', code: 'x' }], board), /Invalid sketch edit/)
  assert.throws(() => validateWorkbenchActions([{ tool: 'write_sketch', file: 'sketch.ino', code: 'x'.repeat(20001) }], board), /Invalid sketch edit/)
  assert.throws(() => validateWorkbenchActions([{ tool: 'write_sketch', file: 'sketch.ino', code: 'a\0b' }], board), /Invalid sketch edit/)
})

test('set_value sets a resistor in ohms or an LED colour, and nothing else', () => {
  assert.doesNotThrow(() => validateWorkbenchActions([{ tool: 'set_value', id: 'resistor_0', resistance: 1000 }], board))
  assert.doesNotThrow(() => validateWorkbenchActions([{ tool: 'set_value', id: 'led_0', color: 'green' }], board))
  assert.throws(() => validateWorkbenchActions([{ tool: 'set_value', id: 'resistor_1', resistance: 100 }], board), /Invalid part reference/)
  assert.throws(() => validateWorkbenchActions([{ tool: 'set_value', id: 'led_0', resistance: 100 }], board), /Invalid resistance/)
  assert.throws(() => validateWorkbenchActions([{ tool: 'set_value', id: 'led_0', color: 'purple' }], board), /Invalid colour/)
  assert.throws(() => validateWorkbenchActions([{ tool: 'set_value', id: 'resistor_0' }], board), /Nothing to set/)
})

test('unknown tools are still rejected', () => {
  assert.throws(() => validateWorkbenchActions([{ tool: 'format_disk' }], board), /Unsupported circuit action/)
})

// A fake HTTP request and response, enough for the handler.
function call(body) {
  const request = Readable.from([JSON.stringify(body)])
  request.method = 'POST'
  request.headers = { 'content-type': 'application/json' }
  const response = { status: 0, text: '', writableEnded: false, destroyed: false,
    writeHead(status) { this.status = status }, end(text) { this.text = text; this.writableEnded = true },
    on() {}, off() {} }
  return createWorkbenchHandler({ apiKey: 'test-key', fetch: async () => ({ ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify({ reply: 'ok', actions: [] }) }] } }] }) }) })(request, response)
    .then(() => response)
}

test('the handler accepts a board with a sketch on it', async () => {
  const response = await call({ message: 'hello', markdown: '', board, history: [] })
  assert.equal(response.status, 200)
})

test('the handler refuses a sketch over the size limit', async () => {
  const big = { ...board, sketches: [{ name: 'sketch.ino', code: 'x'.repeat(20001) }] }
  const response = await call({ message: 'hello', markdown: '', board: big, history: [] })
  assert.equal(response.status, 400)
})

test('place_esp32 and connect_pin are checked for their placement and pin names', () => {
  assert.doesNotThrow(() => validateWorkbenchActions([{ tool: 'place_esp32', holeA: 'i5', holeB: 'b5', code: 'void setup() {}' }], board))
  assert.doesNotThrow(() => validateWorkbenchActions([{ tool: 'connect_pin', pin: 'esp32_0_D2', to: 'a7', color: 'red' }], board))
  assert.throws(() => validateWorkbenchActions([{ tool: 'place_esp32', holeA: 'a5', holeB: 'b5' }], board), /Invalid ESP32 placement/)
  assert.throws(() => validateWorkbenchActions([{ tool: 'place_esp32', holeA: 'i40', holeB: 'b40' }], board), /Invalid ESP32 placement/)
  assert.throws(() => validateWorkbenchActions([{ tool: 'connect_pin', pin: 'esp32_0_D99', to: 'a7', color: 'red' }], board), /Invalid ESP32 pin/)
  assert.throws(() => validateWorkbenchActions([{ tool: 'connect_pin', pin: 'esp32_5_D2', to: 'a7', color: 'red' }], board), /Invalid ESP32 pin/)
  assert.throws(() => validateWorkbenchActions([{ tool: 'connect_pin', pin: 'esp32_0_D2', to: 'z9', color: 'red' }], board), /Invalid wire endpoint/)
})

test('a sketch written for a newly placed ESP32 under a made-up file name goes into that board', async () => {
  const { sketchesIntoNewBoards, validateWorkbenchActions } = await import('../server/workbench-api.ts')
  const actions = [
    { tool: 'place_esp32', holeA: 'i1', holeB: 'b1' },
    { tool: 'write_sketch', file: 'esp32_0.ino', code: 'void setup() {}\nvoid loop() {}' },
  ]
  const fixed = sketchesIntoNewBoards(actions, { sketches: [] })
  assert.equal(fixed.length, 1)
  assert.equal(fixed[0].code, 'void setup() {}\nvoid loop() {}')
  assert.doesNotThrow(() => validateWorkbenchActions(fixed, { components: [], sketches: [] }))
  // An edit to a file that exists is left alone
  const keep = [{ tool: 'write_sketch', file: 'sketch.ino', code: 'x' }]
  assert.deepEqual(sketchesIntoNewBoards(keep, { sketches: [{ name: 'sketch.ino' }] }), keep)
})
