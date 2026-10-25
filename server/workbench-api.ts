import type { IncomingMessage, ServerResponse } from 'node:http'
import Anthropic, { APIError } from '@anthropic-ai/sdk'
import type { SurgeOptions } from './surge-api.js'
// The CLI adapters load only when their provider is chosen. The hosted function calls
// the Anthropic API, and Vercel's build keeps these .ts paths, which would fail to load there.
const loadClaude = () => import('./claude-cli.ts')
const loadCodex = () => import('./codex-cli.ts')

const kinds = ['resistor', 'led', 'battery', 'buzzer', 'button', 'esp32', 'seg7']
const tools = ['place_resistor', 'place_led', 'place_buzzer', 'place_button', 'place_battery', 'place_seg7', 'add_wire', 'remove_component', 'remove_wire', 'delete_all', 'write_sketch', 'set_value', 'place_esp32', 'connect_pin']
// The ESP32 DevKit's pins, in header order (EN ... VIN, then D23 ... 3V3)
const ESP32_PINS = ['EN', 'VP', 'VN', 'D34', 'D35', 'D32', 'D33', 'D25', 'D26', 'D27', 'D14', 'D12', 'D13', 'GND', 'VIN',
  'D23', 'D22', 'TX0', 'RX0', 'D21', 'D19', 'D18', 'D5', 'TX2', 'RX2', 'D4', 'D2', 'D15', 'GND', '3V3']
const ledColors = ['red', 'yellow', 'green', 'blue', 'white']
const SKETCH_LIMIT = 20000
const holePattern = /^(?:[a-j]|(?:tp|tn|bn|bp)_)([1-9]|[1-4][0-9]|50)$/
const pinPattern = /^(resistor|led|battery|buzzer|button)_(\d+)_pin([01])$/
const colors = ['red', 'yellow', 'green', 'blue', 'black', 'white']

export function validateWorkbenchActions(actions: unknown, board: { components: Array<{ type: string; id?: string }>; sketches?: Array<{ name: string; code: string }> }) {
  if (!Array.isArray(actions) || actions.length > 50) throw new Error('Invalid action list.')
  const counts = Object.fromEntries(kinds.map((kind) => [kind, board.components.filter((part) => part.type.toLowerCase() === kind).length]))
  for (const action of actions) {
    if (!action || typeof action !== 'object' || !tools.includes(action.tool)) throw new Error('Unsupported circuit action.')
    const endpoint = (value: unknown) => {
      if (typeof value !== 'string') return false
      if (holePattern.test(value)) return true
      const match = value.match(pinPattern)
      return Boolean(match && Number(match[2]) < counts[match[1]])
    }
    if (action.tool === 'delete_all') { for (const kind of kinds) counts[kind] = 0 }
    else if (action.tool === 'place_battery') counts.battery++
    else if (action.tool === 'place_seg7') {
      // holeA is pin 1 of the display, in row e, with four more columns to its right
      if (typeof action.holeA !== 'string' || !/^e([1-9]|[1-3][0-9]|4[0-6])$/.test(action.holeA)) throw new Error('Invalid 7-segment placement.')
      counts.seg7++
    }
    else if (action.tool.startsWith('place_') && action.tool !== 'place_esp32') {
      if (typeof action.holeA !== 'string' || typeof action.holeB !== 'string' || !holePattern.test(action.holeA) || !holePattern.test(action.holeB) || action.holeA === action.holeB) throw new Error('Invalid component placement.')
      counts[action.tool.slice(6)]++
    } else if (action.tool === 'add_wire' || action.tool === 'remove_wire') {
      if (!endpoint(action.from) || !endpoint(action.to) || action.from === action.to) throw new Error('Invalid wire endpoint.')
      if (action.color !== undefined && !colors.includes(action.color)) throw new Error('Invalid wire color.')
    } else if (action.tool === 'remove_component') {
      const match = typeof action.id === 'string' && action.id.match(/^(resistor|led|battery|buzzer|button|seg7)_(\d+)$/)
      if (!match || Number(match[2]) >= counts[match[1]]) throw new Error('Invalid component reference.')
      counts[match[1]]--
    } else if (action.tool === 'write_sketch') {
      // The whole text of one sketch file the board sent; never a partial edit
      const known = typeof action.file === 'string' && (board.sketches || []).some((s) => s.name === action.file)
      if (!known || typeof action.code !== 'string' || action.code.length > SKETCH_LIMIT || action.code.includes('\0')) throw new Error('Invalid sketch edit.')
    } else if (action.tool === 'place_esp32') {
      // holeA is the hole in row i and holeB the hole in row b of one column, 1 to 35
      const column = (value: unknown) => typeof value === 'string' && /^[ib]([1-9]|[12][0-9]|3[0-5])$/.test(value)
      if (!column(action.holeA) || !column(action.holeB) || action.holeA[0] !== 'i' || action.holeB[0] !== 'b' || action.holeA.slice(1) !== action.holeB.slice(1)) throw new Error('Invalid ESP32 placement.')
      if (action.code !== undefined && (typeof action.code !== 'string' || action.code.length > SKETCH_LIMIT || action.code.includes('\0'))) throw new Error('Invalid sketch edit.')
      counts.esp32++
    } else if (action.tool === 'connect_pin') {
      // A pin of an ESP32 on the board, to a breadboard hole
      const match = typeof action.pin === 'string' && action.pin.match(/^esp32_(\d+)_([A-Za-z0-9]+)$/)
      if (!match || Number(match[1]) >= counts.esp32 || !ESP32_PINS.includes(match[2])) throw new Error('Invalid ESP32 pin.')
      if (typeof action.to !== 'string' || !holePattern.test(action.to)) throw new Error('Invalid wire endpoint.')
      if (!colors.includes(action.color)) throw new Error('Invalid wire color.')
    } else if (action.tool === 'set_value') {
      // A resistor's resistance in ohms, or an LED's colour
      const match = typeof action.id === 'string' && action.id.match(/^(resistor|led)_(\d+)$/)
      if (!match || Number(match[2]) >= counts[match[1]]) throw new Error('Invalid part reference.')
      const hasOhms = action.resistance !== undefined, hasColour = action.color !== undefined
      if (!hasOhms && !hasColour) throw new Error('Nothing to set.')
      if (hasOhms && (match[1] !== 'resistor' || !(action.resistance > 0 && action.resistance <= 1e9))) throw new Error('Invalid resistance.')
      if (hasColour && (match[1] !== 'led' || !ledColors.includes(action.color))) throw new Error('Invalid colour.')
    }
  }
  return actions
}

const action = (tool: string, props: Record<string, unknown> = {}, required: string[] = []) => ({
  type: 'object', properties: { tool: { type: 'string', enum: [tool] }, ...props }, required: ['tool', ...required], additionalProperties: false,
})
const string = { type: 'string' }
export const schema = {
  type: 'object',
  properties: {
    reply: string,
    // Enforce the 50-action limit locally; bounding this union at the provider
    // expands Gemini's response constraint beyond its serving state limit.
    actions: { type: 'array', items: { anyOf: [
      ...['resistor', 'led', 'buzzer', 'button'].map((kind) => action('place_' + kind, {
        holeA: string, holeB: string,
        ...(kind === 'resistor' ? { resistance: { type: 'number', minimum: 1, maximum: 1000000000 } } : {}),
        ...(kind === 'led' ? { color: { type: 'string', enum: ['red', 'yellow', 'green', 'blue', 'white'] } } : {}),
      }, ['holeA', 'holeB'])),
      action('place_battery'),
      action('place_seg7', { holeA: string }, ['holeA']),
      action('add_wire', { from: string, to: string, color: { type: 'string', enum: colors } }, ['from', 'to', 'color']),
      action('remove_wire', { from: string, to: string }, ['from', 'to']),
      action('remove_component', { id: string }, ['id']),
      action('delete_all'),
      action('write_sketch', { file: string, code: string }, ['file', 'code']),
      action('place_esp32', { holeA: string, holeB: string, code: string }, ['holeA', 'holeB']),
      action('connect_pin', { pin: string, to: string, color: { type: 'string', enum: colors } }, ['pin', 'to', 'color']),
      action('set_value', {
        id: string,
        resistance: { type: 'number', minimum: 1, maximum: 1000000000 },
        color: { type: 'string', enum: ledColors },
      }, ['id']),
    ] } },
  },
  required: ['reply', 'actions'],
  additionalProperties: false,
}

// Claude's structured outputs reject numeric limits. validateWorkbenchActions checks them after the reply.
function withoutNumericLimits(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutNumericLimits)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => key !== 'minimum' && key !== 'maximum')
    .map(([key, item]) => [key, withoutNumericLimits(item)]))
}
const claudeSchema = withoutNumericLimits(schema) as Record<string, unknown>

export const instruction = `You are Surge, an electronics assistant controlling a 3D solderless breadboard.
Return JSON with reply and actions. For explanations and analysis only, return no actions.
Propose complete working circuits when asked to build; preserve existing work unless the user requests a new circuit or a clear.
Supported parts: resistor (470 ohms by default), LED (red, yellow, green, blue or white), 9 V battery, active buzzer, momentary push button, 7-segment display (place_seg7, common cathode, 10 pins), and ESP32 DevKit (place_esp32, programmed by a sketch). A resistor placement may include resistance in ohms, and an LED placement may include color. Anything not in this list is unsupported: say so plainly, and never invent it.
The board has columns 1-50. Rows a-e in the SAME column share a node; rows f-j share a different node. Adjacent columns are NOT connected.
The center channel separates rows e and f. Rails tp (top positive), tn (top negative), bn (bottom positive), bp (bottom negative) are four independent buses.
Body hole names: a1 through j50. Rail hole names: tp_1, tn_1, bn_1, bp_1 through _50.
place_resistor/led/buzzer/button use holeA and holeB. Prefer same-row placements with spans 4,2,2,3 columns respectively. A resistor across a1/e1 is shorted, not in series.
LED pin0/holeA is CATHODE (-), pin1/holeB is ANODE (+). Battery pin0 is +9V, pin1 is negative.
Off-board battery endpoints: battery_0_pin0, battery_0_pin1, etc. Component indices are per TYPE, not across all parts.
Connect both battery terminals explicitly: e.g. battery_0_pin0 -> tp_3, battery_0_pin1 -> tn_3. Rails do not power body rows until wired.
For a simple LED circuit, use resistor a3-a7, LED b9-b7 (cathode b9, anode b7), then wire tp_3-a3, a9-tn_9 and both battery terminals to the rails.
All add_wire endpoints must resolve to existing or earlier proposed parts. Use red, yellow, green, blue, black or white.
The DC solver supports resistor networks, LED forward voltage, button switches and 7-segment displays (each segment is an LED). An ESP32 pin that a sketch drives HIGH is a 3.3 V source, and LOW is 0 V, so a lit segment is a DC answer at that step. It does not simulate analog timing or arbitrary ICs.
Sketches: the board lists its ESP32 sketch files under board.sketches, each with its full text. For an ESP32 you place in this reply, put its sketch in place_esp32's code field; write_sketch only edits a file already listed in board.sketches. To change code, return write_sketch with the file name and the whole new text, keeping what the user did not ask to change. Sketches are Arduino C++. A sketch drives a pin by its GPIO number, and a wire to a pin is labelled with its name: esp32_0_D2 is GPIO 2. Keep pinMode and digitalWrite on the pins the wires use.
Values: set_value changes a resistor's resistance in ohms (resistor_0) or an LED's colour (led_0).
ESP32: place_esp32 puts an ESP32 DevKit on the board. holeA is i<column> and holeB is b<column> for one column from 1 to 35, and its 30 pins run along the columns from there. Its sketch is the optional code field, a whole Arduino C++ file. connect_pin wires a pin to a breadboard hole: pin is esp32_<n>_<NAME> (n counts ESP32s from 0), where NAME is one of ${ESP32_PINS.join(', ')}; to is a hole such as b12 or a7. Pin names are the ones a sketch uses: a wire to D2 is GPIO 2.
7-segment display: place_seg7 takes holeA, the pin 1 hole in row e at column S (S from 1 to 46). Pins 1 to 5 run along row e from S to S+4, and pins 6 to 10 run back along row f from S+4 to S. The segment pins are: a is f(S+3), b is f(S+4), c is e(S+3), d is e(S+1), e is e(S), f is f(S+1), g is f(S), dp is e(S+4). Pins 3 and 8 are the common cathode at e(S+2) and f(S+2), joined inside the part, so one connect to a GND pin is enough. A segment lights when its GPIO is HIGH, so every segment needs its own series resistor of about 330 ohms, or the board reports it over its rating.
Worked layout with S = 20, the ESP32 at place_esp32 holeA i1, holeB b1 (its pins use columns 1 to 15), and no other parts there. The wires land two or more columns past the display's body, so each one can curve down smoothly: place_resistor a20-a27 and wire e27 to the GPIO for segment e; resistor b21-b28 and wire e28 for d; resistor c23-c30 and wire e30 for c; resistor j20-j27 and wire f27 for g; resistor i21-i28 and wire f28 for f; resistor h23-h30 and wire f30 for a; resistor g24-g31 and wire f31 for b. Connect the ESP32 GND pin to a22 with connect_pin. For a counting sketch use GPIOs D13 for a, D12 for b, D14 for c, D27 for d, D26 for e, D25 for f and D33 for g, each connected with connect_pin to the hole listed above, and write the sketch with those pins.
Sketch language: sketches run in a small C++ interpreter, not a full compiler. It has functions, global and static variables, arrays (also 2D), pointers, reference parameters, enums, #define, const, millis(), delay(), random(), min, max, constrain, map and bitRead. It has no struct, class, String, templates, lambdas or std:: types: keep per-button state in globals or parallel arrays, and print with Serial.print of numbers and text literals.
Sketch timing: the simulator's clock moves with delay() and with each digitalRead, so a polling loop still finishes. Even so, put delay(5) inside loop(), and for a button counter count one press per change in the reading: keep the last reading, wait about 30 ms with millis() or delay() to debounce, and count only when the stable reading goes LOW. Count each press once and show the digit after each count. The simulator keeps each button's presses over time while it runs, so a counter keeps its count between presses.
Changes are previewed and applied by the user; never claim they are already applied. Keep replies practical and concise.`

// A model sometimes writes the sketch for an ESP32 it is placing to a file name of its
// own, which does not exist yet. That code belongs in the new board's code field.
export function sketchesIntoNewBoards(actions: unknown, board: { sketches?: Array<{ name: string }> }) {
  if (!Array.isArray(actions)) return actions
  const known = new Set((board.sketches || []).map((s) => s.name))
  const fresh = actions.filter((a) => a && a.tool === 'place_esp32' && typeof a.code !== 'string')
  return actions.filter((a) => {
    if (!a || a.tool !== 'write_sketch' || known.has(a.file) || typeof a.code !== 'string') return true
    const target = fresh.shift()
    if (!target) return true
    target.code = a.code
    return false
  })
}

// The CLI takes one prompt, so earlier turns go in as text ahead of the request.
function transcript(history: Array<{ role: string; text: string }> | undefined, request: string) {
  const earlier = (history || []).map((entry) => `${entry.role === 'user' ? 'User' : 'Surge'}: ${entry.text}`).join('\n\n')
  return earlier ? `Earlier in this chat:\n${earlier}\n\n${request}` : request
}

function anthropicFailure(error: APIError): [number, string] {
  if (error.status === 429) return [429, 'Claude has reached its request limit. Try again shortly.']
  if (/credit balance/i.test(error.message)) return [402, 'The Anthropic account is out of credits. Add credits in the Claude Console, then try again.']
  if (error.status === 401 || error.status === 403) return [502, 'The Anthropic key on the server was rejected. Check ANTHROPIC_API_KEY.']
  return [502, 'Claude could not complete the request. Check the server configuration.']
}

function json(response: ServerResponse, status: number, body: unknown) {
  response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
  response.end(JSON.stringify(body))
}

// Vercel may read the body before the handler runs and expose it as request.body.
async function readInput(request: IncomingMessage): Promise<string> {
  const parsed = (request as IncomingMessage & { body?: unknown }).body
  if (typeof parsed === 'string') return parsed
  if (parsed && typeof parsed === 'object') return JSON.stringify(parsed)
  let input = ''
  for await (const chunk of request) { input += chunk.toString(); if (input.length > 500000) throw new Error() }
  return input
}

export function createWorkbenchHandler(options: SurgeOptions) {
  return async (request: IncomingMessage, response: ServerResponse) => {
    if (request.method !== 'POST') { json(response, 405, { error: 'Method not allowed.' }); return }
    if (!request.headers['content-type']?.startsWith('application/json')) { json(response, 415, { error: 'Send application/json.' }); return }
    let body: { message: string; markdown: string; history?: Array<{ role: string; text: string }>; board: { components: Array<{ type: string; id?: string }>; wires: unknown[]; sketches?: Array<{ name: string; code: string }> } }
    try {
      body = JSON.parse(await readInput(request))
      if (!body || typeof body.message !== 'string' || !body.message.trim() || body.message.length > 6000 || typeof body.markdown !== 'string' || body.markdown.length > 250000) throw new Error()
      if (!body.board || !Array.isArray(body.board.components) || body.board.components.length > 300 || !Array.isArray(body.board.wires) || body.board.wires.length > 1000) throw new Error()
      // Any part may be on the board as context; the model only edits the kinds it knows.
      if (body.board.components.some((part) => !part || typeof part.type !== 'string' || (part.id !== undefined && typeof part.id !== 'string'))) throw new Error()
      if (body.board.sketches !== undefined && (!Array.isArray(body.board.sketches) || body.board.sketches.length > 8 || body.board.sketches.some((s) => !s || typeof s.name !== 'string' || s.name.length > 40 || typeof s.code !== 'string' || s.code.length > SKETCH_LIMIT))) throw new Error()
      if (body.history !== undefined && (!Array.isArray(body.history) || body.history.length > 12 || body.history.some((entry) => !entry || !['user', 'model'].includes(entry.role) || typeof entry.text !== 'string' || entry.text.length > 16000))) throw new Error()
    } catch { json(response, 400, { error: 'Invalid board or message. Your circuit has not changed.' }); return }
    const provider = options.provider ?? 'gemini'
    if (provider === 'gemini' && !options.apiKey) { json(response, 503, { error: 'Connect a Gemini key on the local server to use Surge.' }); return }
    if (provider === 'anthropic' && !options.apiKey) { json(response, 503, { error: 'Connect an Anthropic API key on the server to use Surge.' }); return }
    const controller = new AbortController()
    // A Claude Code turn can take a minute on a large board. The hosted function stops at 60 s,
    // so the Anthropic call is cut at 55 s, and a Gemini call at 45 s.
    const timeout = setTimeout(() => controller.abort(), provider === 'claude' || provider === 'codex' ? 180000 : provider === 'anthropic' ? 55000 : 45000)
    const cancel = () => { if (!response.writableEnded) controller.abort() }
    response.on('close', cancel)
    const turn = `Board state:\n${body.markdown}\n\nStructured state:\n${JSON.stringify(body.board)}\n\nRequest:\n${body.message}`
    try {
      let result: { reply?: unknown; actions?: unknown }
      if (provider === 'claude') {
        const { askClaude } = await loadClaude()
        result = await askClaude({ system: instruction, prompt: transcript(body.history, turn), schema, signal: controller.signal }, options.claude) as { reply?: unknown; actions?: unknown }
      } else if (provider === 'codex') {
        const { askCodex, dropNulls, strictSchema } = await loadCodex()
        result = dropNulls(await askCodex({ system: instruction, prompt: transcript(body.history, turn), schema: strictSchema(schema), signal: controller.signal }, options.codex)) as { reply?: unknown; actions?: unknown }
      } else if (provider === 'anthropic') {
        try {
          const client = new Anthropic({ apiKey: options.apiKey, fetch: options.fetch, maxRetries: 1 })
          // The API wants the first turn from the user, so an opening editor reply is dropped.
          const earlier = (body.history || []).map((entry) => ({ role: entry.role === 'model' ? 'assistant' : 'user', content: entry.text })) as Anthropic.MessageParam[]
          while (earlier.length && earlier[0].role !== 'user') earlier.shift()
          const message = await client.messages.create({
            model: options.model || 'claude-opus-5-5',
            max_tokens: 16000,
            system: instruction,
            thinking: { type: 'adaptive' },
            output_config: { effort: 'medium', format: { type: 'json_schema', schema: claudeSchema } },
            messages: [...earlier, { role: 'user', content: turn }],
          }, { signal: controller.signal })
          if (message.stop_reason !== 'end_turn') throw new Error(`Claude stopped with ${message.stop_reason}`)
          result = JSON.parse(message.content.flatMap((block) => block.type === 'text' ? [block.text] : []).join('')) as { reply?: unknown; actions?: unknown }
        } catch (error) {
          if (controller.signal.aborted || !(error instanceof APIError)) throw error
          const [status, message] = anthropicFailure(error)
          if (!response.destroyed) json(response, status, { error: message })
          return
        }
      } else {
        const upstream = await (options.fetch || globalThis.fetch)(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(options.model || 'gemini-2.5-flash')}:generateContent`, {
          method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': options.apiKey as string },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: instruction }] },
            contents: [
              ...(body.history || []).map((entry) => ({ role: entry.role, parts: [{ text: entry.text }] })),
              { role: 'user', parts: [{ text: turn }] },
            ],
            generationConfig: { responseMimeType: 'application/json', responseJsonSchema: schema, maxOutputTokens: 8192, temperature: 0.2 },
          }), signal: controller.signal,
        })
        if (!upstream.ok) {
          json(response, [402, 429].includes(upstream.status) ? upstream.status : 502, { error: upstream.status === 402 ? 'Gemini prepaid credits are depleted. Add credits in Google AI Studio or configure a funded key.' : upstream.status === 429 ? 'Gemini request limit reached. Try again shortly.' : 'Gemini could not complete the request. Check the local server configuration.' }); return
        }
        const payload = await upstream.json()
        const text = payload.candidates?.[0]?.content?.parts?.filter((part: { text?: string; thought?: boolean }) => part.text && !part.thought).map((part: { text: string }) => part.text).join('')
        result = JSON.parse(text || '')
      }
      if (typeof result.reply !== 'string' || !result.reply.trim() || result.reply.length > 16000) throw new Error()
      result.actions = sketchesIntoNewBoards(result.actions, body.board)
      validateWorkbenchActions(result.actions, body.board)
      json(response, 200, { reply: result.reply, actions: result.actions })
    } catch (error) {
      if (error instanceof Error && /^(Claude|Codex)UnavailableError$/.test(error.name)) { if (!response.destroyed) json(response, 503, { error: error.message }); return }
      if (!response.destroyed) json(response, controller.signal.aborted ? 504 : 502, { error: 'Surge could not return a valid proposal. Your circuit has not changed.' })
    } finally { clearTimeout(timeout); response.off('close', cancel) }
  }
}
