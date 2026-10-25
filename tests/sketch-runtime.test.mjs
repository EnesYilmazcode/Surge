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

// The digit a run shows at a moment, from the seven segment pins a to g.
const SEGS = [13, 12, 14, 27, 26, 25, 33]
const DIGIT_OF = { 63: 0, 6: 1, 91: 2, 79: 3, 102: 4, 109: 5, 125: 6, 7: 7, 127: 8, 111: 9 }
const digitAt = (run, ms) => { const l = levelsAt(run, ms); return DIGIT_OF[SEGS.reduce((m, p, i) => m | ((l[p] ? 1 : 0) << i), 0)] }
const SHOW = `const int segs[] = {13, 12, 14, 27, 26, 25, 33};
const byte digits[] = {0x3F,0x06,0x5B,0x4F,0x66,0x6D,0x7D,0x07,0x7F,0x6F};
void show(int d) { for (int i = 0; i < 7; i++) digitalWrite(segs[i], (digits[d] >> i) & 1); }
`

test('a static variable inside loop() keeps its value between calls', () => {
  const run = runSketch(SHOW + `void setup() { for (int i = 0; i < 7; i++) pinMode(segs[i], OUTPUT); }
void loop() { static int n = 0; show(n); delay(1000); n++; if (n > 9) n = 0; }`, { maxMs: 12000 })
  assert.equal(run.error, undefined)
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map(s => digitAt(run, s * 1000 + 500)), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 0, 1])
})

test('two functions can each keep a static of the same name', () => {
  const run = runSketch(`int a() { static int n = 0; return ++n; }
int b() { static int n = 10; return ++n; }
void setup() { pinMode(2, OUTPUT); pinMode(4, OUTPUT); }
void loop() { int x = a(); int y = b(); digitalWrite(2, x == 3); digitalWrite(4, y == 13); delay(100); }`, { maxMs: 1000 })
  assert.equal(run.error, undefined)
  assert.deepEqual(run.events.filter(e => e.level === 1).map(e => [e.t, e.pin]), [[200, 2], [200, 4]])
})

test('a counter timed by millis() alone, with no delay(), steps once a second', () => {
  const run = runSketch(SHOW + `unsigned long last = 0; int n = 0;
void setup() { for (int i = 0; i < 7; i++) pinMode(segs[i], OUTPUT); show(0); }
void loop() { if (millis() - last >= 1000) { last = millis(); n = (n + 1) % 10; show(n); } }`, { maxMs: 12000 })
  assert.equal(run.error, undefined)
  assert.equal(run.ended, 'max')
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map(s => digitAt(run, s * 1000 + 600)), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
})

test('a run says why it ended', () => {
  assert.equal(runSketch(BLINK, { maxMs: 2000 }).ended, 'max')
  assert.equal(runSketch('void setup() {}\nvoid loop() { pinMode(2, OUTPUT); digitalWrite(2, HIGH); delayMicroseconds(1); digitalWrite(2, LOW); delayMicroseconds(1); }', { maxMs: 60000 }).ended, 'events')
})

test('everyday Arduino helpers work: min, max, constrain, map, bitRead, abs', () => {
  const run = runSketch(`void setup() { pinMode(2, OUTPUT); pinMode(4, OUTPUT); pinMode(5, OUTPUT); }
void loop() {
  int a = constrain(12, 0, 9) == 9 && min(3, 4) == 3 && max(3, 4) == 4 && abs(-2) == 2;
  int b = map(5, 0, 10, 0, 100) == 50;
  int c = bitRead(5, 0) == 1 && bitRead(5, 1) == 0;
  digitalWrite(2, a); digitalWrite(4, b); digitalWrite(5, c); delay(100);
}`, { maxMs: 300 })
  assert.equal(run.error, undefined)
  assert.deepEqual(levelsAt(run, 200), { 2: 1, 4: 1, 5: 1 })
})

test('random(lo, hi) stays in range, and randomSeed is accepted', () => {
  const run = runSketch(`int bad = 0;
void setup() { randomSeed(analogRead(0)); pinMode(2, OUTPUT); }
void loop() { int r = random(1, 7); if (r < 1 || r > 6) bad = 1; digitalWrite(2, bad); delay(1); }`, { maxMs: 500 })
  assert.equal(run.error, undefined)
  assert.equal(levelsAt(run, 499)[2], 0)
})

test('a reference parameter changes the caller\'s variable', () => {
  const run = runSketch(`int n = 0;
void bump(int &x, int by) { x = x + by; }
void setup() { pinMode(2, OUTPUT); }
void loop() { bump(n, 1); digitalWrite(2, n == 3); delay(100); }`, { maxMs: 500 })
  assert.equal(run.error, undefined)
  assert.deepEqual(run.events.filter(e => e.level === 1).map(e => e.t), [200])
})

test('enums and enum classes become int constants', () => {
  const run = runSketch(`enum Mode { IDLE, COUNTING = 5, DONE };
enum class Dir { UP, DOWN };
Mode m = DONE;
Dir d = Dir::DOWN;
void setup() { pinMode(2, OUTPUT); }
void loop() { digitalWrite(2, m == 6 && d == Dir::DOWN); delay(100); }`, { maxMs: 300 })
  assert.equal(run.error, undefined)
  assert.equal(levelsAt(run, 200)[2], 1)
})

test('random() gives every face of a die, odd and even', () => {
  const run = runSketch(`int seen = 0;
void setup() { for (int p = 1; p <= 6; p++) pinMode(p + 10, OUTPUT); }
void loop() { int r = random(1, 7); digitalWrite(r + 10, HIGH); delay(10); }`, { maxMs: 2000 })
  assert.equal(run.error, undefined)
  const lit = Object.entries(levelsAt(run, 1999)).filter(([, level]) => level === 1).map(([pin]) => Number(pin))
  assert.deepEqual(lit.sort((a, b) => a - b), [11, 12, 13, 14, 15, 16])
})
