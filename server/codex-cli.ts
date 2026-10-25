import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Runs the local Codex CLI as the Surge chat model. It uses the account signed
// in on this machine (Codex's own login), not an API key. The sandbox is
// read-only and runs in an empty folder, and the reply shape is enforced with
// --output-schema, so the model only returns the reply JSON.

export interface CodexCliOptions {
  command?: string       // the executable, `codex` by default
  commandArgs?: string[] // arguments placed before the CLI's own (used by tests)
  model?: string         // a model name the account can use; the CLI default when omitted
}

export interface CodexRequest {
  system: string
  prompt: string
  schema: object
  signal?: AbortSignal
}

export class CodexUnavailableError extends Error {}

// Codex's structured output is strict: every property must be listed in `required`,
// so an optional field becomes a required field that may be null. dropNulls then
// removes those nulls from the reply, so validators see only the fields the model meant.
export function strictSchema(node: any): any {
  if (!node || typeof node !== 'object') return node
  if (Array.isArray(node.anyOf)) return { ...node, anyOf: node.anyOf.map(strictSchema) }
  if (node.type === 'array' && node.items) return { ...node, items: strictSchema(node.items) }
  if (node.type === 'object' && node.properties) {
    const required = new Set(node.required || [])
    const properties: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(node.properties)) {
      const inner = strictSchema(value)
      properties[key] = required.has(key) ? inner : { anyOf: [inner, { type: 'null' }] }
    }
    return { ...node, properties, required: Object.keys(node.properties), additionalProperties: false }
  }
  return node
}

export function dropNulls(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(dropNulls)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== null).map(([k, v]) => [k, dropNulls(v)]))
  }
  return value
}

const MAX_OUTPUT = 4 * 1024 * 1024

function workdir() {
  const dir = join(tmpdir(), 'surge-codex')
  mkdirSync(dir, { recursive: true })
  return dir
}

export async function askCodex(request: CodexRequest, options: CodexCliOptions = {}): Promise<unknown> {
  const dir = workdir()
  const id = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const schemaPath = join(dir, `schema-${id}.json`)
  const replyPath = join(dir, `reply-${id}.json`)
  writeFileSync(schemaPath, JSON.stringify(request.schema))
  const args = [
    'exec',
    '--ephemeral', '--ignore-user-config', '--skip-git-repo-check',
    '-s', 'read-only',
    '-C', dir,
    '--output-schema', schemaPath,
    '-o', replyPath,
    ...(options.model ? ['-m', options.model] : []),
  ]
  // The system instructions have no flag of their own in `codex exec`, so they go first on stdin.
  const input = `${request.system}\n\n${request.prompt}`
  try {
    await run(options.command || 'codex', [...(options.commandArgs || []), ...args], input, request.signal)
    let text: string
    try { text = readFileSync(replyPath, 'utf8') }
    catch { throw new Error('Codex finished without a reply.') }
    try { return JSON.parse(text) }
    catch { throw new Error('Codex returned a reply that is not JSON.') }
  } finally {
    for (const path of [schemaPath, replyPath]) { try { unlinkSync(path) } catch { /* already gone */ } }
  }
}

function run(command: string, args: string[], input: string, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new Error('aborted')); return }
    // On Windows the npm install is a .cmd shim, which only a shell can start. The
    // arguments are plain paths and words, so the shell adds no quoting risk.
    const child = spawn(command, args, {
      cwd: workdir(),
      windowsHide: true,
      shell: process.platform === 'win32',
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    let settled = false
    const finish = (error: Error | null) => {
      if (settled) return
      settled = true
      signal?.removeEventListener('abort', onAbort)
      if (error) reject(error); else resolve()
    }
    const onAbort = () => { stop(child); finish(new Error('aborted')) }
    signal?.addEventListener('abort', onAbort)
    child.stdout.on('data', (chunk) => {
      stdout += chunk
      if (stdout.length > MAX_OUTPUT) { stop(child); finish(new Error('Codex printed too much output.')) }
    })
    child.stderr.on('data', (chunk) => { if (stderr.length < 4000) stderr += chunk })
    child.stdin.on('error', () => { /* the process may exit before reading the whole prompt */ })
    child.on('error', (error: NodeJS.ErrnoException) => {
      finish(error.code === 'ENOENT'
        ? new CodexUnavailableError('Codex is not installed on this machine. Install it and sign in, or set SURGE_PROVIDER=claude.')
        : error)
    })
    child.on('close', (code) => {
      if (code === 0) return finish(null)
      // A shell reports a missing program as exit 9009 or "not recognized" rather than ENOENT
      if (code === 9009 || /not recognized|not found/i.test(stderr)) {
        return finish(new CodexUnavailableError('Codex is not installed on this machine. Install it and sign in, or set SURGE_PROVIDER=claude.'))
      }
      finish(new Error(`Codex exited with code ${code}: ${(stderr || stdout).trim().slice(-300)}`))
    })
    child.stdin.end(input)
  })
}

// On Windows the shell is the direct child, so stopping it alone leaves Codex running.
// taskkill with /T stops the whole tree.
function stop(child: ChildProcess) {
  if (process.platform === 'win32' && child.pid) execFile('taskkill', ['/pid', String(child.pid), '/T', '/F'], () => {})
  else child.kill()
}
