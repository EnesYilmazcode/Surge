import type { IncomingMessage, ServerResponse } from 'node:http'
import { createWorkbenchHandler } from '../../server/workbench-api.js'

// Only the hosted editor may call this route, so the key is not a public proxy.
const EDITORS = ['https://surge-flow.web.app', 'https://surge-flow.firebaseapp.com']

const workbench = createWorkbenchHandler({
  provider: 'anthropic',
  apiKey: process.env.ANTHROPIC_API_KEY,
  model: process.env.ANTHROPIC_MODEL,
})

export default async function handler(request: IncomingMessage, response: ServerResponse) {
  const origin = request.headers.origin ?? ''
  if (!EDITORS.includes(origin)) {
    response.writeHead(403, { 'Content-Type': 'application/json' })
    response.end(JSON.stringify({ error: 'Only the Surge editor can use this endpoint.' }))
    return
  }
  response.setHeader('Access-Control-Allow-Origin', origin)
  response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  response.setHeader('Vary', 'Origin')
  if (request.method === 'OPTIONS') {
    response.writeHead(204)
    response.end()
    return
  }
  await workbench(request, response)
}
