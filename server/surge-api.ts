import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Plugin } from 'vite'
import { applyCircuitActions, parseAgentReply } from '../src/agent/actions.ts'
import { validateDesign } from '../src/data/project-file.ts'
import { createWorkbenchHandler } from './workbench-api.ts'
import type { ClaudeCliOptions } from './claude-cli.ts'
import type { CodexCliOptions } from './codex-cli.ts'

// provider 'claude' and 'codex' answer chat through the local CLI signed in on this machine; 'gemini' (the default) calls the Gemini API.
export interface SurgeOptions { apiKey?: string; model?: string; fetch?: typeof globalThis.fetch; provider?: 'gemini' | 'claude' | 'codex'; claude?: ClaudeCliOptions; codex?: CodexCliOptions }
export const DEFAULT_MODEL = 'gemini-2.5-flash'

const string = { type: 'string' }
const actionSchema = (type: string, properties: Record<string, unknown>, required: string[]) => ({
  type: 'object', properties: { type: { type: 'string', enum: [type] }, id: string, ...properties },
  required: ['type', 'id', ...required], additionalProperties: false,
})
const responseSchema = {
  type: 'object',
  properties: {
    reply: string,
    actions: { type: 'array', maxItems: 30, items: { anyOf: [
      actionSchema('add_component', {
        kind: { type: 'string', enum: ['power', 'resistor', 'capacitor', 'led', 'ic', 'sensor', 'switch', 'ground'] },
        label: string, value: string, x: { type: 'number' }, z: { type: 'number' },
      }, ['kind', 'label', 'value', 'x', 'z']),
      actionSchema('update_component', { label: string, value: string }, []),
      actionSchema('remove_component', {}, []),
      actionSchema('add_wire', { from: string, to: string, layer: { type: 'string', enum: ['power', 'signal', 'ground'] } }, ['from', 'to', 'layer']),
      actionSchema('remove_wire', {}, []),
    ] } },
  },
  required: ['reply', 'actions'],
  additionalProperties: false,
}

const instruction = `You are Surge, a practical electronics design assistant in a 3D breadboard editor.
Help the user understand and revise the CURRENT circuit. Answer questions directly; only propose edits when requested.
Return JSON with reply (plain text) and actions (small, incremental edits, at most 30).
For analysis-only questions return an empty actions array. Never claim changes have already been applied.
Use the exact existing IDs for edits; use unique short IDs for new parts and wires.
Preserve unrelated parts and wires. Removing a component automatically removes its attached wires.
Only supported component kinds are power, resistor, capacitor, led, ic, sensor, switch, ground.
Values include units. Component pins and colors are assigned by the editor.
Placement: 30 columns, x from -5.22 to 5.22 spaced 0.36. Body socket rows z=-1.95,-1.59,-1.23,-0.87,-0.51,0.51,0.87,1.23,1.59,1.95.
Choose free socket locations. The center channel has no sockets. New component coordinates must be on or near a socket.
Wires currently connect COMPONENT IDs, not individual pins. The editor does not yet model pin-level connectivity or simulate a physical breadboard.
The metrics shown are rough estimates, not a SPICE solution. Never claim full electrical verification, exact current, or efficiency from this editor.
Do not invent unavailable components or pretend motor controllers or amplifiers work without pin-level modeling.
Reply concisely, explain assumptions, and keep your identity and product name Surge.`

function json(response: ServerResponse, status: number, value: unknown) {
  response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' })
  response.end(JSON.stringify(value))
}

async function readBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    size += Buffer.byteLength(chunk)
    if (size > 1024 * 1024) throw new Error('The circuit request is too large.')
    chunks.push(Buffer.from(chunk))
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) }
  catch { throw new Error('Send a valid JSON circuit request.') }
}

export function createSurgeHandler(options: SurgeOptions) {
  const workbench = createWorkbenchHandler(options)
  const model = options.model || DEFAULT_MODEL
  const fetcher = options.fetch || globalThis.fetch
  return async (request: IncomingMessage, response: ServerResponse, next = () => json(response, 404, { error: 'Not found.' })) => {
    const path = request.url?.split('?')[0]
    if (path !== '/api/surge/status' && path !== '/api/surge/chat' && path !== '/api/surge/workbench') { next(); return }
    if (!/^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(request.headers.host ?? '')) {
      json(response, 403, { error: 'Use the local editor address to reach Surge.' }); return
    }
    const origin = request.headers.origin
    if (origin && origin !== `http://${request.headers.host}`) {
      json(response, 403, { error: 'Only requests from this local editor are allowed.' }); return
    }
    if (path === '/api/surge/workbench') { await workbench(request, response); return }
    if (path === '/api/surge/status' && request.method === 'GET') {
      const provider = options.provider ?? 'gemini'
      const label = { claude: 'Claude Code', codex: 'Codex', gemini: 'Gemini' }[provider]
      const modelName = provider === 'claude' ? (options.claude?.model || 'opus') : provider === 'codex' ? (options.codex?.model || 'Codex default') : model
      json(response, 200, { configured: provider !== 'gemini' || Boolean(options.apiKey), provider: label, model: modelName }); return
    }
    if (path !== '/api/surge/chat' || request.method !== 'POST') {
      json(response, 405, { error: 'Method not allowed.' }); return
    }
    if (!request.headers['content-type']?.startsWith('application/json')) {
      json(response, 415, { error: 'Send the request as application/json.' }); return
    }

    let contents: Array<{ role: string; parts: Array<{ text: string }> }>
    let design: ReturnType<typeof validateDesign>
    try {
      const body = await readBody(request) as Record<string, unknown>
      if (!body || typeof body.message !== 'string' || !body.message.trim() || body.message.length > 6000) throw new Error('Enter a message under 6,000 characters.')
      design = validateDesign(body.design)
      const history = body.history ?? []
      if (!Array.isArray(history) || history.length > 12) throw new Error('Chat history is too long.')
      contents = history.map((entry) => {
        if (!entry || !['user', 'assistant'].includes(entry.role) || typeof entry.text !== 'string' || entry.text.length > 16000) throw new Error('Invalid chat history.')
        return { role: entry.role === 'assistant' ? 'model' : 'user', parts: [{ text: entry.text }] }
      })
      contents.push({ role: 'user', parts: [{ text: `Current circuit:\n${JSON.stringify(design)}\n\nUser request:\n${body.message}` }] })
    } catch (error) {
      json(response, 400, { error: error instanceof Error ? error.message : 'Invalid circuit request.' }); return
    }
    if (!options.apiKey) {
      json(response, 503, { error: 'Gemini is not connected. Configure GEMINI_API_KEY on the local server to use Surge.' }); return
    }

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 45000)
    const cancel = () => { if (!response.writableEnded) controller.abort() }
    response.on('close', cancel)
    try {
      const upstream = await fetcher(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': options.apiKey },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: instruction }] },
          contents,
          generationConfig: { responseMimeType: 'application/json', responseJsonSchema: responseSchema, temperature: 0.25, maxOutputTokens: 8192 },
        }),
        signal: controller.signal,
      })
      if (!upstream.ok) {
        const status = upstream.status === 402 || upstream.status === 429 ? upstream.status : 502
        const error = upstream.status === 402
          ? 'Gemini cannot respond because its project has no prepaid credits. Add credits in Google AI Studio or configure a funded Gemini key, then try again.'
          : upstream.status === 429
            ? 'Gemini has reached its request limit. Try again shortly.'
            : 'Gemini could not complete the request. Check the server credential and model configuration.'
        json(response, status, { error })
        return
      }
      const payload = await upstream.json()
      const output = payload.candidates?.[0]?.content?.parts?.filter((part: { text?: string; thought?: boolean }) => part.text && !part.thought).map((part: { text: string }) => part.text).join('')
      if (!output) throw new Error('Empty model response')
      const result = parseAgentReply(JSON.parse(output))
      applyCircuitActions(design, result.actions)
      json(response, 200, result)
    } catch {
      if (!response.destroyed) json(response, controller.signal.aborted ? 504 : 502, { error: controller.signal.aborted ? 'Surge timed out. Try a smaller request.' : 'Surge could not produce a valid circuit response. Your circuit has not changed.' })
    } finally {
      clearTimeout(timeout)
      response.off('close', cancel)
    }
  }
}

export function surgeApi(options: SurgeOptions): Plugin {
  return {
    name: 'surge-local-api',
    configureServer(server) { server.middlewares.use(createSurgeHandler(options)) },
    configurePreviewServer(server) { server.middlewares.use(createSurgeHandler(options)) },
  }
}
