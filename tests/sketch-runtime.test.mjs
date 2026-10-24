import test from 'node:test'
import assert from 'node:assert/strict'
import { runSketch, levelsAt } from '../src/sketch-runtime.ts'

const BLINK = `
const int LED_PIN = 2;
void setup() { pinMode(LED_PIN, OUTPUT); }
void loop() {
  digitalWrite(LED_PIN, HIGH);
  delay(500);
  digitalWrite(LED_PIN, LOW);
  delay(500);
}`

test('delay() moves a virtual clock, so a blink is recorded without waiting', () => {
  const started = Date.now()
  const run = runSketch(BLINK, { maxMs: 3000 })
  assert.equal(run.error, undefined)
  assert.ok(Date.now() - started < 1000)
  assert.deepEqual(run.events.slice(0, 5).map(e => [e.t, e.pin, e.level]),
    [[0, 2, 0], [0, 2, 1], [500, 2, 0], [1000, 2, 1], [1500, 2, 0]])
  assert.deepEqual(levelsAt(run, 700), { 2: 0 })
  assert.deepEqual(levelsAt(run, 1200), { 2: 1 })
})

test('a pin is not driven until the sketch makes it an OUTPUT', () => {
  const run = runSketch('void setup() { digitalWrite(2, HIGH); } void loop() { delay(100); }', { maxMs: 500 })
  assert.deepEqual(run.events, [])
})

test('digitalRead sees what the circuit wires to the pin, and millis() follows the clock', () => {
  const sketch = `
void setup() { pinMode(2, OUTPUT); pinMode(4, INPUT_PULLUP); }
void loop() {
  if (digitalRead(4) == LOW) { digitalWrite(2, HIGH); } else { digitalWrite(2, LOW); }
  delay(100);
}`
  assert.equal(levelsAt(runSketch(sketch, { maxMs: 300, inputs: { 4: 0 } }), 200)[2], 1)
  assert.equal(levelsAt(runSketch(sketch, { maxMs: 300, inputs: { 4: 1 } }), 200)[2], 0)
  assert.equal(levelsAt(runSketch(sketch, { maxMs: 300 }), 200)[2], 0)   // pull-up, nothing wired
})

test('Serial output is collected', () => {
  const run = runSketch('void setup() { Serial.begin(115200); Serial.println("hi"); Serial.println(7); } void loop() { delay(100); }', { maxMs: 200 })
  assert.equal(run.error, undefined)
  assert.equal(run.serial, 'hi\n7\n')
})

test('unsupported code reports the sketch line, not the interpreter line', () => {
  const run = runSketch('void setup() {}\nclass A { };\nvoid loop() { delay(10); }', { maxMs: 100 })
  assert.equal(run.error, 'Line 2: "class A { };" is not supported yet.')
})

test('a loop that never calls delay() is stopped', () => {
  const run = runSketch('void setup() {} void loop() { int x = 0; while (true) { x++; } }', { maxMs: 100 })
  assert.match(run.error ?? '', /too long/)
})
