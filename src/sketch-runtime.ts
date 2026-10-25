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
  reads: number                      // how many times it read a pin, so whether its result depends on inputs
  ended: 'max' | 'events' | 'slow' | 'done'  // reached maxMs, too many pin changes, out of interpreter time, or returned
  error?: string
}

export interface SketchOptions {
  inputs?: Record<number, 0 | 1 | null>  // what digitalRead sees; null means unconnected
  inputsAt?: (ms: number) => Record<number, 0 | 1 | null>  // the same, at a moment of simulated time
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
#define min(a, b) ((a) < (b) ? (a) : (b))
#define max(a, b) ((a) > (b) ? (a) : (b))
#define abs(x) ((x) < 0 ? -(x) : (x))
#define constrain(x, lo, hi) ((x) < (lo) ? (lo) : ((x) > (hi) ? (hi) : (x)))
#define map(x, inMin, inMax, outMin, outMax) (((x) - (inMin)) * ((outMax) - (outMin)) / ((inMax) - (inMin)) + (outMin))
#define bit(b) (1 << (b))
#define bitRead(v, b) (((v) >> (b)) & 1)
#define bitSet(v, b) ((v) |= (1 << (b)))
#define bitClear(v, b) ((v) &= ~(1 << (b)))
#define bitWrite(v, b, x) ((x) ? bitSet(v, b) : bitClear(v, b))
// The last line is code, not a macro: hoisted statics are added to it
typedef bool boolean;
`
const SHIM_LINES = SHIM.split('\n').length - 1
const STOP = '__surge_stop__'
// Simulated time one digitalRead takes, in ms. A polling loop moves the clock by this much per read.
const READ_MS = 20
// Simulated time one millis() or micros() call takes. A loop timed by millis() alone moves forward by this.
const CLOCK_MS = 20
// A run that hits the interpreter's time limit keeps what it worked out, if it got this far.
const MIN_PARTIAL_MS = 2000

// JSCPP has no reference parameters. `void bump(int &n)` becomes `void bump(int *n)`,
// each use of n inside it becomes (*n), and each call passes &(its argument).
function referencesToPointers(source: string): string {
  // The index of the bracket that closes the one at `open`.
  const closing = (text: string, open: number) => {
    const pair: Record<string, string> = { '(': ')', '{': '}' }
    let depth = 0
    for (let i = open; i < text.length; i++) {
      if (text[i] === text[open]) depth++
      else if (text[i] === pair[text[open]] && --depth === 0) return i
    }
    return -1
  }
  const refs = new Map<string, number[]>()   // function name -> argument positions taken by reference
  let text = source
  const header = /\b(\w+)\s*\(([^()]*&[^()]*)\)\s*(\{|;)/g
  let m: RegExpExecArray | null
  while ((m = header.exec(text))) {
    const [whole, name, params, end] = m
    if (/^(if|while|for|switch|return)$/.test(name)) continue
    const names: string[] = []
    const positions: number[] = []
    const rewritten = params.split(',').map((param, k) => {
      const ref = /^(\s*(?:const\s+)?[\w\s]*?\w)\s*&\s*(\w+)\s*$/.exec(param)
      if (!ref) return param
      positions.push(k)
      names.push(ref[2])
      return `${ref[1]} *${ref[2]}`
    }).join(',')
    if (!positions.length) continue
    refs.set(name, positions)
    let head = whole.replace(params, rewritten)
    let tail = ''
    let stop = m.index + whole.length
    if (end === '{') {
      const close = closing(text, m.index + whole.length - 1)
      if (close < 0) continue
      let body = text.slice(m.index + whole.length, close)
      for (const n of names) body = body.replace(new RegExp(`(?<![.>]\\s*)\\b${n}\\b`, 'g'), `(*${n})`)
      tail = body
      stop = close
    }
    text = text.slice(0, m.index) + head + tail + text.slice(stop)
    header.lastIndex = m.index + head.length + tail.length
  }
  for (const [name, positions] of refs) {
    const call = new RegExp(`\\b${name}\\s*\\(`, 'g')
    let c: RegExpExecArray | null
    while ((c = call.exec(text))) {
      const open = c.index + c[0].length - 1
      const close = closing(text, open)
      if (close < 0) break
      const inside = text.slice(open + 1, close)
      // A definition or prototype already has pointer parameters; leave it
      if (/\*\s*\w+\s*(,|$)/.test(inside) && /\b(int|long|bool|byte|char|float|double|unsigned)\b/.test(inside)) { call.lastIndex = close; continue }
      const args: string[] = []
      let depth = 0, start = 0
      for (let i = 0; i <= inside.length; i++) {
        const ch = inside[i]
        if (ch === '(' || ch === '[') depth++
        else if (ch === ')' || ch === ']') depth--
        else if ((ch === ',' && depth === 0) || i === inside.length) { args.push(inside.slice(start, i)); start = i + 1 }
      }
      const fixed = args.map((arg, k) => positions.includes(k) && arg.trim() ? `&(${arg.trim()})` : arg).join(',')
      text = text.slice(0, open + 1) + fixed + text.slice(close)
      call.lastIndex = open + 1 + fixed.length
    }
  }
  return text
}

// JSCPP cannot overload random() by its number of arguments, so random(lo, hi)
// is renamed random_between(lo, hi).
function twoArgRandom(source: string): string {
  return source.replace(/\brandom\s*\(/g, (call, offset: number) => {
    let depth = 0
    for (let i = offset + call.length; i < source.length; i++) {
      const c = source[i]
      if (c === '(' || c === '[') depth++
      else if (c === ')' || c === ']') { if (depth-- === 0) return call }
      else if (c === ',' && depth === 0) return 'random_between('
    }
    return call
  })
}

// JSCPP has no enums. `enum Mode { UP, DOWN };` becomes an int type and int constants,
// on the same lines, and `Mode::UP` from an enum class becomes UP.
function plainEnums(source: string): string {
  const scoped: string[] = []
  const out = source.replace(/\benum\s+(class\s+|struct\s+)?(\w+)?\s*(?::\s*\w+\s*)?\{([^{}]*)\}\s*(\w+)?\s*;/g, (whole, isScoped, name, list, variable) => {
    let value = -1
    const consts = String(list).split(',').map((item: string) => item.trim()).filter(Boolean).map((item: string) => {
      const [id, init] = item.split('=').map(t => t.trim())
      value = init !== undefined && /^-?\d+$/.test(init) ? Number(init) : value + 1
      return `const int ${id} = ${value};`
    })
    if (isScoped && name) scoped.push(name)
    const lines = '\n'.repeat((whole.match(/\n/g) || []).length)
    return (name ? `typedef int ${name}; ` : '') + consts.join(' ') + (variable ? ` int ${variable};` : '') + lines
  })
  return scoped.reduce((text, name) => text.replace(new RegExp(`\\b${name}::`, 'g'), ''), out)
}

// JSCPP starts a function's static variables over on every call, so a counter kept
// in `static int n` never gets past its first value. Each one becomes a global with
// a name of its own, renamed inside its function.
const STATIC_DECL = /\bstatic\s+((?:unsigned\s+|signed\s+)?(?:long\s+long|long|int|short|char|bool|boolean|byte|float|double|u?int(?:8|16|32)_t))\s+(\w+)\s*(?:=\s*([^;,{}]+))?;/g
function hoistStatics(source: string): { text: string; globals: string } {
  const globals: string[] = []
  let out = ''
  let depth = 0
  let start = -1          // where the current top-level body began in `source`
  for (let i = 0; i < source.length; i++) {
    const c = source[i]
    if (c === '"' || c === "'") {   // skip a string or char literal
      let j = i + 1
      while (j < source.length && source[j] !== c && source[j] !== '\n') j += source[j] === '\\' ? 2 : 1
      if (depth === 0) out += source.slice(i, j + 1)
      i = j
      continue
    }
    if (c === '/' && (source[i + 1] === '/' || source[i + 1] === '*')) {   // skip a comment
      const end = source[i + 1] === '/' ? source.indexOf('\n', i) : source.indexOf('*/', i + 2) + 1
      const j = end <= 0 ? source.length - 1 : end - (source[i + 1] === '/' ? 1 : 0)
      if (depth === 0) out += source.slice(i, j + 1)
      i = j
      continue
    }
    if (c === '{') { if (depth++ === 0) { start = i; out += c } continue }
    if (c === '}' && depth > 0 && --depth === 0) {
      let fn = source.slice(start + 1, i)
      const renames: Array<[string, string]> = []
      // Only a literal start value is hoisted; anything else could name something declared later.
      fn = fn.replace(STATIC_DECL, (decl, type, name, init) => {
        if (init !== undefined && !/^\s*(?:-?[\d.]+[uUlLfF]*|true|false|HIGH|LOW|'(?:\\.|[^'])')\s*$/.test(init)) return decl
        const global = `__static_${globals.length}_${name}`
        globals.push(`${type} ${global} = ${init !== undefined ? init.trim() : '0'};`)
        renames.push([name, global])
        return ''
      })
      for (const [name, global] of renames) fn = fn.replace(new RegExp(`\\b${name}\\b`, 'g'), global)
      out += fn + c
      continue
    }
    if (depth === 0) out += c
  }
  if (depth > 0) return { text: source, globals: '' }   // unbalanced braces: leave it for the parser to report
  return { text: out, globals: globals.join(' ') }
}

export function runSketch(sketch: string, options: SketchOptions = {}): SketchRun {
  const maxMs = options.maxMs ?? 10000
  const events: PinEvent[] = []
  const modes = new Map<number, number>()
  const levels = new Map<number, 0 | 1>()
  let serial = ''
  let now = 0
  let seed = 12345
  let reads = 0
  let ended: SketchRun['ended'] = 'done'

  const record = (pin: number, level: 0 | 1) => {
    if (levels.get(pin) === level) return
    levels.set(pin, level)
    events.push({ t: now, pin, level })
    if (events.length > 20000) { ended = 'events'; throw new Error(STOP) }
  }
  const wait = (ms: number) => {
    now += ms
    if (now > maxMs) { ended = 'max'; throw new Error(STOP) }
  }

  // Serial.begin( -> Serial_begin(, and so on. Comments and strings are left alone.
  const body = sketch.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*|"(?:\\.|[^"\\\n])*"|\bSerial\.(begin|print|println)\s*\(/g,
    (m, call) => call ? `Serial_${call}(` : m)
  const { text, globals } = hoistStatics(plainEnums(referencesToPointers(twoArgRandom(body))))
  // The hoisted globals share the shim's last line, so error line numbers stay right.
  const code = SHIM.slice(0, -1) + ' ' + globals + '\n' + text + '\nint main() { setup(); while (true) { loop(); } return 0; }\n'

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
            // A read takes READ_MS of simulated time. A loop that polls a pin without
            // delay() would otherwise never move the clock, and never end.
            reads++
            wait(READ_MS)
            const wired = options.inputsAt ? options.inputsAt(now)[pin.v] : options.inputs?.[pin.v]
            const level = wired ?? (modes.get(pin.v) === 2 ? 1 : 0)
            return r.val(int, level)
          })
          def('analogWrite', [int, int], none, (_r: any, _t: any, pin: any, value: any) => {
            if (modes.get(pin.v) === 1) record(pin.v, value.v > 0 ? 1 : 0)
          })
          def('analogRead', [int], int, (r: any) => r.val(int, 0))
          def('delay', [int], none, (_r: any, _t: any, ms: any) => wait(Math.max(0, ms.v)))
          def('delayMicroseconds', [int], none, (_r: any, _t: any, us: any) => wait(Math.max(0, us.v) / 1000))
          // Reading the clock takes a moment too, so a loop that waits on millis() moves forward.
          def('millis', [], ulong, (r: any) => { wait(CLOCK_MS); return r.val(ulong, Math.floor(now)) })
          def('micros', [], ulong, (r: any) => { wait(CLOCK_MS); return r.val(ulong, Math.floor(now * 1000)) })
          // The low bits of this generator alternate, so the result comes from its high bits.
          const next = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed >>> 16 }
          def('random', [int], int, (r: any, _t: any, max: any) => r.val(int, max.v > 0 ? next() % max.v : 0))
          def('random_between', [int, int], int, (r: any, _t: any, lo: any, hi: any) => r.val(int, hi.v > lo.v ? lo.v + next() % (hi.v - lo.v) : lo.v))
          def('randomSeed', [ulong], none, (_r: any, _t: any, s: any) => { seed = Math.abs(Math.floor(Number(s.v))) & 0x7fffffff })

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

  const finish = (error?: string): SketchRun => ({ events, duration: Math.min(now, maxMs), serial, reads, ended, ...(error ? { error } : {}) })

  let JSCPP: { run(code: string, input: string, config?: Record<string, unknown>): number }
  try {
    JSCPP = jscpp()
    JSCPP.run(code, '', config)
    return finish()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (message.includes(STOP)) return finish()
    // Out of interpreter time after a good stretch: keep what it worked out.
    if (/time limit|timeout|timed out/i.test(message) && now >= MIN_PARTIAL_MS) { ended = 'slow'; return finish() }
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
