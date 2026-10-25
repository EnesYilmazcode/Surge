import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import test from 'node:test'
import { validateWorkbenchActions } from '../server/workbench-api.ts'
import { levelsAt, runSketch } from '../src/sketch-runtime.ts'

// The board, simulator and solver are plain browser scripts, so they load through the shared CommonJS helper.
const require = createRequire(import.meta.url)
const load = require('./helpers/workbench.cjs')
const BM = load('board-model')
const Sim = load('simulation')
// The browser scripts run in their own VM realm, so compare plain copies of their arrays.
const plain = (value) => JSON.parse(JSON.stringify(value))

// The DevKit's pins in header order, as the editor and the server name them.
const ESP32_PINS = ['EN', 'VP', 'VN', 'D34', 'D35', 'D32', 'D33', 'D25', 'D26', 'D27', 'D14', 'D12', 'D13', 'GND', 'VIN',
  'D23', 'D22', 'TX0', 'RX0', 'D21', 'D19', 'D18', 'D5', 'TX2', 'RX2', 'D4', 'D2', 'D15', 'GND', '3V3']

// A DevKit at column 1: pins 0 to 14 run along row i, pins 15 to 29 along row b.
const esp32Holes = () => ESP32_PINS.map((_, k) => (k < 15 ? { col: k, row: 'i' } : { col: k - 15, row: 'b' }))

// The worked layout from the prompt, with the display at S = 20.
const LAYOUT = [
  { tool: 'place_seg7', holeA: 'e20' },
  { tool: 'place_resistor', holeA: 'a20', holeB: 'a27', resistance: 330 },   // segment e
  { tool: 'place_resistor', holeA: 'b21', holeB: 'b28', resistance: 330 },   // segment d
  { tool: 'place_resistor', holeA: 'c23', holeB: 'c30', resistance: 330 },   // segment c
  { tool: 'place_resistor', holeA: 'g24', holeB: 'g31', resistance: 330 },   // segment b
  { tool: 'place_resistor', holeA: 'h23', holeB: 'h30', resistance: 330 },   // segment a
  { tool: 'place_resistor', holeA: 'i21', holeB: 'i28', resistance: 330 },   // segment f
  { tool: 'place_resistor', holeA: 'j20', holeB: 'j27', resistance: 330 },   // segment g
  // GPIO wires: D26 (e), D27 (d), D14 (c), D12 (b), D13 (a), D25 (f), D33 (g)
  { tool: 'add_wire', from: 'i9', to: 'e27', color: 'yellow' },
  { tool: 'add_wire', from: 'i10', to: 'e28', color: 'green' },
  { tool: 'add_wire', from: 'i11', to: 'e30', color: 'blue' },
  { tool: 'add_wire', from: 'i12', to: 'f31', color: 'white' },
  { tool: 'add_wire', from: 'i13', to: 'f30', color: 'red' },
  { tool: 'add_wire', from: 'i8', to: 'f28', color: 'yellow' },
  { tool: 'add_wire', from: 'i7', to: 'f27', color: 'green' },
  { tool: 'add_wire', from: 'i14', to: 'a22', color: 'black' },   // GND to the common cathode
]

// Segment letters lit for each digit, from the usual common-cathode table.
const DIGIT = { 0: 'abcdef', 1: 'bc', 2: 'abdeg', 3: 'abcdg', 4: 'bcfg', 5: 'acdfg', 6: 'acdefg', 7: 'abc', 8: 'abcdefg', 9: 'abcdfg' }
// The GPIO that drives each segment in the layout above.
const GPIO = { a: 13, b: 12, c: 14, d: 27, e: 26, f: 25, g: 33 }

function boardWithLayout() {
  const start = BM.emptyBoard()
  start.components.push({ type: 'esp32', holes: esp32Holes(), values: {} })
  const r = BM.applyActions(start, LAYOUT)
  assert.equal(r.errors.length, 0, 'the worked layout should apply without errors: ' + plain(r.errors).join('; '))
  return r.board
}

// Drive the DevKit's GPIOs so that the given segments are HIGH, and read which segments carry current.
function litFor(board, digit) {
  const sim = BM.toSim(board, Sim.PROPS)
  const levels = {}
  for (const seg of Object.keys(GPIO)) levels[GPIO[seg]] = DIGIT[digit].includes(seg) ? 1 : 0
  const result = Sim.analyze(sim.components, sim.wires, { pins: { 0: levels } })
  const display = sim.components.find((c) => c.type === 'seg7')
  return { result, lit: Object.keys(result.segments.get(display)).sort().join(''), display }
}

test('a 7-segment display takes ten holes: pin 1 in row e, then five more columns on rows e and f', () => {
  const r = BM.applyActions(BM.emptyBoard(), [{ tool: 'place_seg7', holeA: 'e20' }])
  assert.equal(r.errors.length, 0)
  const holes = plain(r.board.components[0].holes.map(BM.formatHole))
  assert.deepEqual(holes, ['e20', 'e21', 'e22', 'e23', 'e24', 'f24', 'f23', 'f22', 'f21', 'f20'])
  assert.deepEqual(plain(r.resolved), [{ tool: 'place_seg7', holeA: 'e20' }])
})

test('a display placed off row e, too far right, or onto taken holes is refused with a reason', () => {
  const offRow = BM.applyActions(BM.emptyBoard(), [{ tool: 'place_seg7', holeA: 'a20' }])
  assert.equal(offRow.errors.length, 1)
  assert.match(offRow.errors[0], /not a valid pin 1 hole/)

  const tooFar = BM.applyActions(BM.emptyBoard(), [{ tool: 'place_seg7', holeA: 'e47' }])
  assert.equal(tooFar.errors.length, 1)

  const twice = BM.applyActions(BM.emptyBoard(), [{ tool: 'place_seg7', holeA: 'e20' }, { tool: 'place_seg7', holeA: 'e21' }])
  assert.equal(twice.board.components.length, 1)
  assert.equal(twice.errors.length, 1)
  assert.match(twice.errors[0], /already taken/)
})

test('the server accepts a display placement on row e and rejects others', () => {
  const ok = { tool: 'place_seg7', holeA: 'e20' }
  assert.deepEqual(validateWorkbenchActions([ok], { components: [] }), [ok])
  assert.throws(() => validateWorkbenchActions([{ tool: 'place_seg7', holeA: 'a20' }], { components: [] }), /Invalid 7-segment placement/)
  assert.throws(() => validateWorkbenchActions([{ tool: 'place_seg7', holeA: 'e47' }], { components: [] }), /Invalid 7-segment placement/)
  // remove_component can name a display, as seg7_0
  const board = { components: [{ type: 'seg7' }] }
  assert.doesNotThrow(() => validateWorkbenchActions([{ tool: 'remove_component', id: 'seg7_0' }], board))
})

test('the worked layout lights exactly the segments of each digit, driven by the ESP32 pins', () => {
  const board = boardWithLayout()
  for (let digit = 0; digit <= 9; digit++) {
    const { lit } = litFor(board, digit)
    assert.equal(lit, [...DIGIT[digit]].sort().join(''), `digit ${digit}`)
  }
})

test('a lit segment carries about (3.3 V - 2 V) / 330 ohm, and a dark one carries nothing', () => {
  const { result, display } = litFor(boardWithLayout(), 8)
  const lit = result.segments.get(display)
  for (const seg of Object.keys(lit)) {
    const mA = lit[seg] * 1000
    assert.ok(mA > 3.0 && mA < 4.6, `segment ${seg} carries ${mA.toFixed(2)} mA`)
  }
  assert.equal(Object.keys(lit).length, 7)
  assert.ok(result.lines.some((l) => /7-segment display: .* lit/.test(l.text)))
  assert.ok(!result.lines.some((l) => l.cls === 'sim-err'), 'no over-current warning with 330 ohm')
})

test('a display segment wired straight from a GPIO, with no resistor, is reported as a short', () => {
  const start = BM.emptyBoard()
  start.components.push({ type: 'esp32', holes: esp32Holes(), values: {} })
  // Same layout, but segment e is wired straight from its GPIO with no resistor
  const bare = LAYOUT.filter((a) => !(a.tool === 'place_resistor' && a.holeA === 'a20') && a.to !== 'e27')
  bare.push({ tool: 'add_wire', from: 'i9', to: 'a20', color: 'yellow' })
  const board = BM.applyActions(start, bare).board
  const sim = BM.toSim(board, Sim.PROPS)
  const levels = { 26: 1, 27: 0, 14: 0, 12: 0, 13: 0, 25: 0, 33: 0 }
  const result = Sim.analyze(sim.components, sim.wires, { pins: { 0: levels } })
  // A GPIO straight onto a diode has no resistance in its path, so the solver reports a short
  assert.ok(result.lines.some((l) => l.cls === 'sim-err' && /Short circuit/.test(l.text)), JSON.stringify(plain(result.lines)))
})

test('the counting sketch shows 1 to 9 on the display, one digit every 800 ms', () => {
  const sketch = `
// Counts 1 to 9 on a common-cathode 7-segment display, one digit every 800 ms.
const int SEGMENTS[7] = {13, 12, 14, 27, 26, 25, 33};
// One row per digit 0-9, one column per segment a to g (1 = lit).
const int DIGITS[70] = {
  1,1,1,1,1,1,0,
  0,1,1,0,0,0,0,
  1,1,0,1,1,0,1,
  1,1,1,1,0,0,1,
  0,1,1,0,0,1,1,
  1,0,1,1,0,1,1,
  1,0,1,1,1,1,1,
  1,1,1,0,0,0,0,
  1,1,1,1,1,1,1,
  1,1,1,1,0,1,1
};
void setup() {
  for (int i = 0; i < 7; i++) pinMode(SEGMENTS[i], OUTPUT);
}
void loop() {
  for (int digit = 1; digit <= 9; digit++) {
    for (int i = 0; i < 7; i++) digitalWrite(SEGMENTS[i], DIGITS[digit * 7 + i]);
    delay(800);
  }
}
`
  const run = runSketch(sketch, { maxMs: 8000 })
  assert.equal(run.error, undefined, run.error)
  const pins = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((seg) => GPIO[seg])
  const digitOf = (ms) => {
    const levels = levelsAt(run, ms)
    const lit = pins.map((pin, i) => (levels[pin] ? 'abcdefg'[i] : '')).join('')
    return Object.keys(DIGIT).find((d) => [...DIGIT[d]].sort().join('') === [...lit].sort().join(''))
  }
  const shown = [0, 1, 2, 3, 4, 5, 6, 7, 8].map((k) => digitOf(k * 800 + 1))
  assert.deepEqual(shown, ['1', '2', '3', '4', '5', '6', '7', '8', '9'])
})
