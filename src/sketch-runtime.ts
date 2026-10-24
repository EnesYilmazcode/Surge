// Runs an Arduino sketch on a virtual clock and records what its pins do.
//
// The sketch goes through JSCPP, a C++ interpreter written in JavaScript. It
// has no classes, so `Serial.println(x)` is rewritten to a plain function
// call, and the Arduino functions are supplied here. delay() does not wait:
// it moves a clock forward, so ten seconds of blinking is worked out at once
// and then replayed in real time by the simulation.

export interface PinEvent { t: number; pin: number; level: 0 | 1 }

export interface SketchRun {
  events: PinEvent[]                 // every change to an OUTPUT pin, in time order
  duration: number                   // virtual milliseconds that were run
  serial: string                     // everything the sketch printed
  error?: string
}

export interface SketchOptions {
  inputs?: Record<number, 0 | 1 | null>  // what digitalRead sees; null means unconnected
  maxMs?: number
}

const SHIM = `#include <arduino>
#define HIGH 1
#define LOW 0
#define INPUT 0
#define OUTPUT 1
#define INPUT_PULLUP 2
#define LED_BUILTIN 2
#define byte int
#define uint8_t int
#define uint16_t int
#define uint32_t unsigned long
#define int8_t int
#define int16_t int
#define int32_t int
typedef bool boolean;
`
const SHIM_LINES = SHIM.split('\n').length - 1
const STOP = '__surge_stop__'

export function runSketch(sketch: string, options: SketchOptions = {}): SketchRun {
  const maxMs = options.maxMs ?? 10000
  const events: PinEvent[] = []
  const modes = new Map<number, number>()
  const levels = new Map<number, 0 | 1>()
  let serial = ''
  let now = 0
  let seed = 12345

  const record = (pin: number, level: 0 | 1) => {
    if (levels.get(pin) === level) return
    levels.set(pin, level)
    events.push({ t: now, pin, level })
    if (events.length > 20000) throw new Error(STOP)
  }
  const wait = (ms: number) => {
    now += ms
    if (now > maxMs) throw new Error(STOP)
  }

  // Serial.begin( -> Serial_begin(, and so on. Comments and strings are left alone.
  const body = sketch.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*|"(?:\\.|[^"\\\n])*"|\bSerial\.(begin|print|println)\s*\(/g,
    (m, call) => call ? `Serial_${call}(` : m)
  const code = SHIM + body + '\nint main() { setup(); while (true) { loop(); } return 0; }\n'

  const config = {
    maxTimeout: 1500,
    stdio: { write() {} },
    includes: {
      arduino: {
        load(rt: any) {
          const int = rt.intTypeLiteral, none = rt.voidTypeLiteral
          const dbl = rt.doubleTypeLiteral, text = rt.normalPointerType(rt.charTypeLiteral)
          const ulong = rt.primitiveType('unsigned long')
          const def = (name: string, args: unknown[], ret: unknown, fn: (...a: any[]) => unknown) =>
            rt.regFunc(fn, 'global', name, args, ret)

          def('pinMode', [int, int], none, (_r: any, _t: any, pin: any, mode: any) => {
            modes.set(pin.v, mode.v)
            if (mode.v === 1) record(pin.v, levels.get(pin.v) ?? 0)
          })
          def('digitalWrite', [int, int], none, (_r: any, _t: any, pin: any, level: any) => {
            if (modes.get(pin.v) === 1) record(pin.v, level.v ? 1 : 0)
          })
          def('digitalRead', [int], int, (r: any, _t: any, pin: any) => {
            const wired = options.inputs?.[pin.v]
            const level = wired ?? (modes.get(pin.v) === 2 ? 1 : 0)
            return r.val(int, level)
          })
          def('analogWrite', [int, int], none, (_r: any, _t: any, pin: any, value: any) => {
            if (modes.get(pin.v) === 1) record(pin.v, value.v > 0 ? 1 : 0)
          })
          def('analogRead', [int], int, (r: any) => r.val(int, 0))
          def('delay', [int], none, (_r: any, _t: any, ms: any) => wait(Math.max(0, ms.v)))
          def('delayMicroseconds', [int], none, (_r: any, _t: any, us: any) => wait(Math.max(0, us.v) / 1000))
          def('millis', [], ulong, (r: any) => r.val(ulong, Math.floor(now)))
          def('micros', [], ulong, (r: any) => r.val(ulong, Math.floor(now * 1000)))
          def('random', [int], int, (r: any, _t: any, max: any) => {
            seed = (seed * 1103515245 + 12345) & 0x7fffffff
            return r.val(int, max.v > 0 ? seed % max.v : 0)
          })

          def('Serial_begin', [int], none, () => {})
          // One number type: an int argument converts to double, and two overloads would be ambiguous.
          def('Serial_print', [dbl], none, (_r: any, _t: any, v: any) => { serial += String(v.v) })
          def('Serial_println', [dbl], none, (_r: any, _t: any, v: any) => { serial += String(v.v) + '\n' })
          def('Serial_print', [text], none, (r: any, _t: any, s: any) => { serial += r.getStringFromCharArray(s) })
          def('Serial_println', [text], none, (r: any, _t: any, s: any) => { serial += r.getStringFromCharArray(s) + '\n' })
        },
      },
    },
  }

  const finish = (error?: string): SketchRun => ({ events, duration: Math.min(now, maxMs), serial, ...(error ? { error } : {}) })

  let JSCPP: { run(code: string, input: string, config?: Record<string, unknown>): number }
  try {
    JSCPP = jscpp()
    JSCPP.run(code, '', config)
    return finish()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (message.includes(STOP)) return finish()
    return finish(describe(message, sketch))
  }
}

// JSCPP is a CommonJS package, so the browser build imports it once up top and
// the Node tests reach it through the same binding.
import JSCPPModule from 'JSCPP'
function jscpp() { return JSCPPModule }

// Turn a JSCPP failure into one line pointing at the user's own line number.
function describe(message: string, sketch: string): string {
  const where = /line (\d+) \(column \d+\)/.exec(message)
  const line = where ? Number(where[1]) - SHIM_LINES : 0
  if (/time limit|timeout|timed out/i.test(message)) return 'The sketch ran too long without a delay().'
  if (/Parsing Failure/.test(message)) {
    const source = (sketch.split('\n')[line - 1] ?? '').trim().slice(0, 60)
    return `Line ${line}: ${source ? '"' + source + '" is' : 'this is'} not supported yet.`
  }
  return message.replace(/^ERROR:\s*/, '').split('\n')[0].slice(0, 220)
}

// The pin level at a point in the replay, for every pin the sketch drives.
export function levelsAt(run: SketchRun, ms: number): Record<number, 0 | 1> {
  const out: Record<number, 0 | 1> = {}
  for (const event of run.events) {
    if (event.t > ms) break
    out[event.pin] = event.level
  }
  return out
}
