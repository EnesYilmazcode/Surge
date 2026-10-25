// Hard prompts for the chat, each with a check on what the built circuit really does.
//
// A case either reads a trace (what the display and LEDs show over simulated time,
// worked out from the sketch run) or presses buttons in the live editor and reads the
// digit after each press. The checks look at behavior only, never at the reply text.

// Digits as the lit segments of a common-cathode display, sorted.
export const DIGITS = { abcdef: 0, bc: 1, abdeg: 2, abcdg: 3, bcfg: 4, acdfg: 5, acdefg: 6, abc: 7, abcdefg: 8, abcdfg: 9 }

// The runs of a trace: [{ value, from, ms }], merging equal neighbours.
export function runsOf(samples, key) {
  const out = []
  for (const s of samples) {
    const v = key(s)
    const last = out[out.length - 1]
    if (last && last.value === v) last.ms = s.t - last.from + s.step
    else out.push({ value: v, from: s.t, ms: s.step })
  }
  return out
}

const digitOf = s => (s.digits[0] === undefined ? 'none' : s.digits[0] === '' ? ' ' : DIGITS[s.digits[0]] ?? '?')
const near = (ms, want, tol = 0.15) => Math.abs(ms - want) <= want * tol

// Checks that the display shows `want` in order, each for about `each` ms. Blanks between digits are allowed.
function sequence(want, each, { blanks = true } = {}) {
  return samples => {
    const runs = runsOf(samples, digitOf).filter(r => !(blanks && r.value === ' ' && r.ms < each))
    const at = runs.findIndex((_, i) => want.every((d, k) => runs[i + k] && runs[i + k].value === d))
    if (at < 0) return { pass: false, why: `display showed ${runs.slice(0, 24).map(r => r.value).join(' ')}` }
    // The runs inside the match (not the first or last, which the trace may cut) should each last about `each`
    const inner = runs.slice(at + 1, at + want.length - 1)
    const off = inner.find(r => !near(r.ms, each))
    if (off) return { pass: false, why: `${off.value} showed for ${off.ms} ms, wanted about ${each}` }
    return { pass: true, why: `showed ${want.join(' ')}` }
  }
}

export const CASES = [
  {
    id: 'count-0-9',
    prompt: 'Make the ESP32 count from 0 to 9 on a 7-segment display, one number per second, then start over at 0.',
    traceMs: 24000,
    check: sequence([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 0], 1000),
    // The live display, not just the worked-out trace: this is where a counter used to stop at 4
    watch: { ms: 13000, see: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9] },
  },
  {
    id: 'countdown',
    prompt: 'Use an ESP32 and a 7-segment display to count down from 9 to 0, one step per second, and then stay on 0.',
    traceMs: 16000,
    check: samples => {
      const seq = sequence([9, 8, 7, 6, 5, 4, 3, 2, 1, 0], 1000)(samples)
      if (!seq.pass) return seq
      const end = samples.slice(-20).map(digitOf)
      return end.every(d => d === 0) ? seq : { pass: false, why: `did not stay on 0, ended with ${end.join('')}` }
    },
  },
  {
    id: 'evens-fast',
    prompt: 'Show only the even digits 0, 2, 4, 6, 8 on a 7-segment display driven by an ESP32, half a second each, looping forever.',
    traceMs: 8000,
    check: sequence([0, 2, 4, 6, 8, 0, 2], 500),
  },
  {
    id: 'fibonacci',
    prompt: 'Have the ESP32 show the one-digit Fibonacci numbers 0 1 1 2 3 5 8 on a 7-segment display, one per second, then repeat. Blank the display for a short moment between numbers so the two 1s are visible as separate numbers.',
    traceMs: 16000,
    check: samples => {
      const shown = runsOf(samples, digitOf).filter(r => r.value !== ' ').map(r => r.value)
      return shown.join(' ').includes('0 1 1 2 3 5 8 0') ? { pass: true, why: 'showed 0 1 1 2 3 5 8 0' } : { pass: false, why: `display showed ${shown.slice(0, 20).join(' ')}` }
    },
  },
  {
    id: 'traffic-light',
    prompt: 'Build a traffic light on the ESP32 with a red, a yellow and a green LED: green for 3 seconds, yellow for 1 second, red for 3 seconds, then repeat.',
    traceMs: 16000,
    check: samples => {
      const runs = runsOf(samples, s => s.leds.slice().sort().join('+') || 'off')
      const want = [['green', 3000], ['yellow', 1000], ['red', 3000], ['green', 3000]]
      const names = runs.map(r => r.value)
      const at = names.findIndex((v, i) => want.every(([c], k) => names[i + k] === c))
      if (at < 0) return { pass: false, why: `lights went ${runs.slice(0, 10).map(r => `${r.value} ${r.ms}ms`).join(', ')}` }
      const off = want.slice(0, 3).map(([c, ms], k) => [runs[at + k], ms]).find(([r, ms]) => !near(r.ms, ms))
      return off ? { pass: false, why: `${off[0].value} lasted ${off[0].ms} ms, wanted ${off[1]}` } : { pass: true, why: 'green 3 s, yellow 1 s, red 3 s' }
    },
  },
  {
    id: 'blink-and-count',
    prompt: 'With one ESP32: blink an LED on for half a second and off for half a second, and at the same time count seconds 0 to 9 on a 7-segment display, looping.',
    traceMs: 12000,
    check: samples => {
      const seq = sequence([0, 1, 2, 3, 4, 5, 6, 7, 8, 9], 1000)(samples)
      if (!seq.pass) return seq
      const led = runsOf(samples, s => (s.leds.length ? 'on' : 'off')).slice(1, -1)
      const off = led.find(r => !near(r.ms, 500, 0.2))
      if (led.length < 8) return { pass: false, why: `the LED changed only ${led.length} times` }
      return off ? { pass: false, why: `LED ${off.value} for ${off.ms} ms, wanted 500` } : { pass: true, why: 'counts and blinks' }
    },
  },
  {
    id: 'press-counter',
    prompt: 'Build a counter: each press of a push button adds one to the number on a 7-segment display, starting at 0 and wrapping from 9 back to 0. Use an ESP32.',
    presses: Array(11).fill(0),
    check: digits => {
      const want = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 0, 1]
      return digits.join() === want.join() ? { pass: true, why: 'counted 11 presses, wrapping at 9' } : { pass: false, why: `after each press: ${digits.join(' ')}, wanted ${want.join(' ')}` }
    },
  },
  {
    id: 'up-down',
    prompt: 'Two push buttons and a 7-segment display on an ESP32: the button further left on the board counts up, the other counts down. Start at 5 and never go below 0 or above 9.',
    presses: [0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
    check: digits => {
      const want = [5, 6, 7, 8, 9, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0, 0, 0]
      return digits.join() === want.join() ? { pass: true, why: 'up to 9, down to 0, clamped' } : { pass: false, why: `after each press: ${digits.join(' ')}, wanted ${want.join(' ')}` }
    },
  },
  {
    id: 'dice',
    prompt: 'Make an electronic die: pressing a push button shows a random number from 1 to 6 on a 7-segment display. Use an ESP32.',
    presses: Array(12).fill(0),
    check: digits => {
      const rolls = digits.slice(1)
      const bad = rolls.find(d => !(d >= 1 && d <= 6))
      if (bad !== undefined) return { pass: false, why: `rolled ${rolls.join(' ')}` }
      // Twelve fair rolls show four or more faces about 98% of the time, and both odd and even ones
      const fair = new Set(rolls).size >= 4 && rolls.some(d => d % 2) && rolls.some(d => d % 2 === 0)
      return fair ? { pass: true, why: `rolled ${rolls.join(' ')}` } : { pass: false, why: `not random enough: ${rolls.join(' ')}` }
    },
  },
  {
    id: 'follow-up-faster',
    prompt: 'Make the ESP32 count from 0 to 9 on a 7-segment display, one number per second, looping.',
    followUp: 'Now make it count twice as fast.',
    traceMs: 8000,
    check: sequence([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 0], 500),
    watch: { ms: 8000, see: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9] },
  },
]
