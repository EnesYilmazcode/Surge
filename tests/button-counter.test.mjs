import assert from 'node:assert/strict'
import test from 'node:test'
import { levelsAt, runSketch } from '../src/sketch-runtime.ts'

// A debounced press counter, the sketch the assistant writes for "a button counter on the seven-segment display".
// It has no delay(): its timing comes from millis(), which must move while the loop polls the pin.
const COUNTER = `
const int LED_PIN = 2;
const int BUTTON_PIN = 23;
const int segments[] = {13, 12, 14, 27, 26, 25, 33};
const byte digits[] = {
  0b00111111, 0b00000110, 0b01011011, 0b01001111, 0b01100110,
  0b01101101, 0b01111101, 0b00000111, 0b01111111, 0b01101111
};
int count = 0;
bool lastReading = HIGH;
bool stableButton = HIGH;
bool blinkState = LOW;
unsigned long changedAt = 0;
unsigned long blinkAt = 0;

void showDigit() {
  for (int i = 0; i < 7; ++i) {
    digitalWrite(segments[i], (digits[count] & (1 << i)) ? HIGH : LOW);
  }
}

void setup() {
  pinMode(LED_PIN, OUTPUT);
  Serial.begin(115200);
  pinMode(BUTTON_PIN, INPUT_PULLUP);
  for (int i = 0; i < 7; ++i) pinMode(segments[i], OUTPUT);
  showDigit();
}

void loop() {
  unsigned long now = millis();
  bool reading = digitalRead(BUTTON_PIN);
  if (reading != lastReading) changedAt = now;
  lastReading = reading;
  if (now - changedAt > 30 && reading != stableButton) {
    stableButton = reading;
    if (stableButton == LOW) {
      count = (count + 1) % 10;
      showDigit();
    }
  }
  if (now - blinkAt > 500) {
    blinkAt = now;
    blinkState = !blinkState;
    digitalWrite(LED_PIN, blinkState);
  }
}
`

// The seven-segment pins in order a..g, and the segments each digit lights.
const SEG = ['a', 'b', 'c', 'd', 'e', 'f', 'g']
const PIN = [13, 12, 14, 27, 26, 25, 33]
const DIGIT = { 0: 'abcdef', 1: 'bc', 2: 'abdeg', 3: 'abcdg', 4: 'bcfg', 5: 'acdfg', 6: 'acdefg', 7: 'abc', 8: 'abcdefg', 9: 'abcdfg' }

// The digit the display shows at a moment of the run.
function shownAt(run, ms) {
  const levels = levelsAt(run, ms)
  const lit = SEG.filter((_, i) => levels[PIN[i]]).join('')
  return Object.keys(DIGIT).find((d) => DIGIT[d] === lit)
}

// Presses are [from, to] in simulated ms. The button reads LOW (0) while pressed.
const pressedDuring = (presses) => (ms) => presses.some(([a, b]) => ms >= a && ms < b)
const inputsFor = (presses) => {
  const pressed = pressedDuring(presses)
  return (ms) => ({ 23: pressed(ms) ? 0 : 1 })
}

test('a debounced counter adds one for each press and keeps its count between presses', () => {
  const presses = [[1000, 1200], [2000, 2200], [3000, 3200]]
  const run = runSketch(COUNTER, { inputsAt: inputsFor(presses), maxMs: 4500 })
  assert.equal(run.error, undefined, run.error)
  assert.equal(shownAt(run, 900), '0', 'before any press')
  assert.equal(shownAt(run, 1500), '1', 'after the first press')
  assert.equal(shownAt(run, 2500), '2', 'after the second press, the first is kept')
  assert.equal(shownAt(run, 4000), '3', 'after the third press')
})

test('a release does not count, and a short bounce under the debounce window is ignored', () => {
  // A 10 ms bounce, then a real press
  const presses = [[500, 510], [1000, 1200]]
  const run = runSketch(COUNTER, { inputsAt: inputsFor(presses), maxMs: 2000 })
  assert.equal(shownAt(run, 1800), '1', 'only the real press counts')
})

test('a button held down counts once, not on every loop', () => {
  const run = runSketch(COUNTER, { inputs: { 23: 0 }, maxMs: 3000 })
  assert.equal(run.error, undefined, run.error)
  assert.equal(shownAt(run, 2900), '1')
})

test('a loop that polls a pin without delay() runs to the end of the time budget, with no error', () => {
  const run = runSketch(COUNTER, { inputs: { 23: 1 }, maxMs: 10000 })
  assert.equal(run.error, undefined, run.error)
  assert.equal(run.duration, 10000)
})
