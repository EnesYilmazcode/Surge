import type { IncomingMessage, ServerResponse } from 'node:http'
import type { SurgeOptions } from './surge-api'

const kinds = ['resistor', 'led', 'battery', 'buzzer', 'button']
const tools = ['place_resistor', 'place_led', 'place_buzzer', 'place_button', 'place_battery', 'add_wire', 'remove_component', 'remove_wire', 'delete_all']
const holePattern = /^(?:[a-j]|(?:tp|tn|bn|bp)_)([1-9]|[1-4][0-9]|50)$/
const pinPattern = /^(resistor|led|battery|buzzer|button)_(\d+)_pin([01])$/
const colors = ['red', 'yellow', 'green', 'blue', 'black', 'white']

export function validateWorkbenchActions(actions: unknown, board: { components: Array<{ type: string; id?: string }> }) {
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
    else if (action.tool.startsWith('place_')) {
      if (typeof action.holeA !== 'string' || typeof action.holeB !== 'string' || !holePattern.test(action.holeA) || !holePattern.test(action.holeB) || action.holeA === action.holeB) throw new Error('Invalid component placement.')
      counts[action.tool.slice(6)]++
    } else if (action.tool === 'add_wire' || action.tool === 'remove_wire') {
      if (!endpoint(action.from) || !endpoint(action.to) || action.from === action.to) throw new Error('Invalid wire endpoint.')
      if (action.color !== undefined && !colors.includes(action.color)) throw new Error('Invalid wire color.')
    } else if (action.tool === 'remove_component') {
      const match = typeof action.id === 'string' && action.id.match(/^(resistor|led|battery|buzzer|button)_(\d+)$/)
      if (!match || Number(match[2]) >= counts[match[1]]) throw new Error('Invalid component reference.')
      counts[match[1]]--
    }
  }
  return actions
}

const action = (tool: string, props: Record<string, unknown> = {}, required: string[] = []) => ({
  type: 'object', properties: { tool: { type: 'string', enum: [tool] }, ...props }, required: ['tool', ...required], additionalProperties: false,
})
const string = { type: 'string' }
const schema = {
  type: 'object',
  properties: {
    reply: string,
    actions: { type: 'array', maxItems: 50, items: { anyOf: [
      ...['resistor', 'led', 'buzzer', 'button'].map((kind) => action('place_' + kind, {
        holeA: string, holeB: string,
        ...(kind === 'resistor' ? { resistance: { type: 'number', minimum: 1, maximum: 1000000000 } } : {}),
        ...(kind === 'led' ? { color: { type: 'string', enum: ['red', 'yellow', 'green', 'blue', 'white'] } } : {}),
      }, ['holeA', 'holeB'])),
      action('place_battery'),
      action('add_wire', { from: string, to: string, color: { type: 'string', enum: colors } }, ['from', 'to', 'color']),
      action('remove_wire', { from: string, to: string }, ['from', 'to']),
      action('remove_component', { id: string }, ['id']),
      action('delete_all'),
    ] } },
  },
  required: ['reply', 'actions'],
  additionalProperties: false,
}

const instruction = `You are Surge, an electronics assistant controlling a 3D solderless breadboard.
Return JSON with reply and actions. For explanations and analysis only, return no actions.
Propose complete working circuits when asked to build; preserve existing work unless the user requests a new circuit or a clear.
Supported parts: resistor (470 ohms by default), LED (red, yellow, green, blue or white), 9 V battery, active buzzer, momentary push button. A resistor placement may include resistance in ohms, and an LED placement may include color. Do not invent unsupported parts.
The board has columns 1-50. Rows a-e in the SAME column share a node; rows f-j share a different node. Adjacent columns are NOT connected.
The center channel separates rows e and f. Rails tp (top positive), tn (top negative), bn (bottom positive), bp (bottom negative) are four independent buses.
Body hole names: a1 through j50. Rail hole names: tp_1, tn_1, bn_1, bp_1 through _50.
place_resistor/led/buzzer/button use holeA and holeB. Prefer same-row placements with spans 4,2,2,3 columns respectively. A resistor across a1/e1 is shorted, not in series.
LED pin0/holeA is CATHODE (-), pin1/holeB is ANODE (+). Battery pin0 is +9V, pin1 is negative.
Off-board battery endpoints: battery_0_pin0, battery_0_pin1, etc. Component indices are per TYPE, not across all parts.
Connect both battery terminals explicitly: e.g. battery_0_pin0 -> tp_3, battery_0_pin1 -> tn_3. Rails do not power body rows until wired.
For a simple LED circuit, use resistor a3-a7, LED b9-b7 (cathode b9, anode b7), then wire tp_3-a3, a9-tn_9 and both battery terminals to the rails.
All add_wire endpoints must resolve to existing or earlier proposed parts. Use red, yellow, green, blue, black or white.
The DC solver supports resistor networks, LED forward voltage and button switches. It does not simulate arbitrary ICs or time-domain electronics.
Changes are previewed and applied by the user; never claim they are already applied. Keep replies practical and concise.`

function json(response: ServerResponse, status: number, body: unknown) {
  response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
  response.end(JSON.stringify(body))
}

export function createWorkbenchHandler(options: SurgeOptions) {
  return async (request: IncomingMessage, response: ServerResponse) => {
    if (request.method !== 'POST') { json(response, 405, { error: 'Method not allowed.' }); return }
    if (!request.headers['content-type']?.startsWith('application/json')) { json(response, 415, { error: 'Send application/json.' }); return }
    let body: { message: string; markdown: string; history?: Array<{ role: string; text: string }>; board: { components: Array<{ type: string; id?: string }>; wires: unknown[] } }
    try {
      let input = ''
      for await (const chunk of request) { input += chunk.toString(); if (input.length > 500000) throw new Error() }
      body = JSON.parse(input)
      if (!body || typeof body.message !== 'string' || !body.message.trim() || body.message.length > 6000 || typeof body.markdown !== 'string' || body.markdown.length > 250000) throw new Error()
      if (!body.board || !Array.isArray(body.board.components) || body.board.components.length > 300 || !Array.isArray(body.board.wires) || body.board.wires.length > 1000) throw new Error()
      if (body.board.components.some((part) => !part || typeof part.type !== 'string' || !kinds.includes(part.type.toLowerCase()) || (part.id !== undefined && typeof part.id !== 'string'))) throw new Error()
      if (body.history !== undefined && (!Array.isArray(body.history) || body.history.length > 12 || body.history.some((entry) => !entry || !['user', 'model'].includes(entry.role) || typeof entry.text !== 'string' || entry.text.length > 16000))) throw new Error()
    } catch { json(response, 400, { error: 'Invalid board or message. Your circuit has not changed.' }); return }
    if (!options.apiKey) { json(response, 503, { error: 'Connect a Gemini key on the local server to use Surge.' }); return }
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 45000)
    const cancel = () => { if (!response.writableEnded) controller.abort() }
    response.on('close', cancel)
    try {
      const upstream = await (options.fetch || globalThis.fetch)(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(options.model || 'gemini-2.5-flash')}:generateContent`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': options.apiKey },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: instruction }] },
          contents: [
            ...(body.history || []).map((entry) => ({ role: entry.role, parts: [{ text: entry.text }] })),
            { role: 'user', parts: [{ text: `Board state:\n${body.markdown}\n\nStructured state:\n${JSON.stringify(body.board)}\n\nRequest:\n${body.message}` }] },
          ],
          generationConfig: { responseMimeType: 'application/json', responseJsonSchema: schema, maxOutputTokens: 8192, temperature: 0.2 },
        }), signal: controller.signal,
      })
      if (!upstream.ok) {
        json(response, [402, 429].includes(upstream.status) ? upstream.status : 502, { error: upstream.status === 402 ? 'Gemini prepaid credits are depleted. Add credits in Google AI Studio or configure a funded key.' : upstream.status === 429 ? 'Gemini request limit reached. Try again shortly.' : 'Gemini could not complete the request. Check the local server configuration.' }); return
      }
      const payload = await upstream.json()
      const text = payload.candidates?.[0]?.content?.parts?.filter((part: { text?: string; thought?: boolean }) => part.text && !part.thought).map((part: { text: string }) => part.text).join('')
      const result = JSON.parse(text || '')
      if (typeof result.reply !== 'string' || !result.reply.trim() || result.reply.length > 16000) throw new Error()
      validateWorkbenchActions(result.actions, body.board)
      json(response, 200, { reply: result.reply, actions: result.actions })
    } catch {
      if (!response.destroyed) json(response, controller.signal.aborted ? 504 : 502, { error: 'Surge could not return a valid proposal. Your circuit has not changed.' })
    } finally { clearTimeout(timeout); response.off('close', cancel) }
  }
}
