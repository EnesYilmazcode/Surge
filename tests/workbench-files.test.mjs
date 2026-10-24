import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import test from 'node:test'
const context = vm.createContext({})
vm.runInContext(readFileSync(new URL('../public/editor/project-format.js', import.meta.url), 'utf8'), context)
const validate = context.WorkbenchFiles.validate
const fixture = () => ({
  version: 1, name: 'LED circuit',
  components: [
    { type: 'battery', holeRefs: null, position: { x: 13.2, z: 0 } },
    { type: 'resistor', resistance: 470, holeRefs: [{ col: 2, row: 'a' }, { col: 6, row: 'a' }] },
  ],
  wires: [{ startHole: null, startCompIdx: 0, startPinIdx: 0, endHole: { col: 2, row: 'tp' }, color: 0xef4444 }],
})

test('project validation preserves electrical values and off-board pin wires', () => {
  const result = validate(fixture())
  assert.equal(result.components[1].resistance, 470)
  assert.equal(result.wires[0].startCompIdx, 0)
  assert.equal(result.wires[0].startPinIdx, 0)
  assert.equal(result.wires[0].endHole.row, 'tp')
})

test('invalid sockets, pin references and untrusted thumbnails are rejected or removed', () => {
  const socket = fixture()
  socket.components[1].holeRefs[0].col = 50
  assert.throws(() => validate(socket), /socket/)
  const missing = fixture()
  missing.wires[0].startCompIdx = 99
  assert.throws(() => validate(missing), /missing component/)
  const thumb = fixture()
  thumb.thumbnail = 'https://unrelated.example/track'
  assert.equal(validate(thumb).thumbnail, undefined)
  const invalid = fixture()
  invalid.components[1].resistance = -1
  assert.throws(() => validate(invalid), /resistance/)
})

test('modern component values and LED colors survive project loading', () => {
  const circuit = fixture()
  circuit.components[1].values = { resistance: 2200 }
  circuit.components.push({ type: 'led', holeRefs: [{ col: 8, row: 'b' }, { col: 10, row: 'b' }], values: { color: 'blue', forwardVoltage: 3.2, maxCurrent: 0.02 } })
  const result = validate(circuit)
  assert.equal(result.components[1].values.resistance, 2200)
  assert.equal(result.components[2].values.color, 'blue')
  assert.equal(result.components[2].values.forwardVoltage, 3.2)
})

test('an ESP32 needs all 30 of its sockets', () => {
  const holeRefs = []
  for (const row of ['i', 'b']) for (let col = 5; col < 20; col++) holeRefs.push({ col, row })
  const ok = fixture()
  ok.components.push({ type: 'esp32', holeRefs, values: {} })
  assert.equal(validate(ok).components[2].holeRefs.length, 30)
  const short = fixture()
  short.components.push({ type: 'esp32', holeRefs: holeRefs.slice(0, 2) })
  assert.throws(() => validate(short), /30 socket/)
})
