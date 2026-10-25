import { spawn } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Runs the local Claude Code CLI as the Surge chat model. The CLI uses the
// account signed in on this machine, so no API key is needed. No tools are
// enabled, and the model only returns the reply JSON, so a prompt cannot make
// it touch files or run commands.

export interface ClaudeCliOptions {
  command?: string       // the executable, `claude` by default
  commandArgs?: string[] // arguments placed before the CLI's own (used by tests)
  model?: string         // an alias such as `opus` or `sonnet`, or a full model name
}

export interface ClaudeRequest {
  system: string
  prompt: string
  schema: object
  signal?: AbortSignal
}

export class ClaudeUnavailableError extends Error {}

const MAX_OUTPUT = 4 * 1024 * 1024

// A folder with no project files, so the CLI does not pick up a repo's CLAUDE.md.
function workdir() {
  const dir = join(tmpdir(), 'surge-claude')
  mkdirSync(dir, { recursive: true })
  return dir
}

export async function askClaude(request: ClaudeRequest, options: ClaudeCliOptions = {}): Promise<unknown> {
  const args = [
    '-p', '--output-format', 'json',
    '--json-schema', JSON.stringify(request.schema),
    '--system-prompt', request.system,
    '--model', options.model || 'opus',
    '--tools', '',
    '--no-session-persistence',
    '--setting-sources', '',
  ]
  const stdout = await run(options.command || 'claude', [...(options.commandArgs || []), ...args], request.prompt, request.signal)
  let envelope: { is_error?: boolean; subtype?: string; result?: string; structured_output?: unknown }
  try { envelope = JSON.parse(stdout) }
  catch { throw new Error('Claude Code returned output that is not JSON.') }
  if (envelope.is_error || envelope.subtype !== 'success') throw new Error('Claude Code did not finish the reply.')
  if (envelope.structured_output !== undefined) return envelope.structured_output
  return JSON.parse(envelope.result || '')
}

function run(command: string, args: string[], input: string, signal?: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new Error('aborted')); return }
    const child = spawn(command, args, { cwd: workdir(), windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    let settled = false
    const finish = (error: Error | null, value = '') => {
      if (settled) return
      settled = true
      signal?.removeEventListener('abort', onAbort)
      if (error) reject(error); else resolve(value)
    }
    const onAbort = () => { child.kill(); finish(new Error('aborted')) }
    signal?.addEventListener('abort', onAbort)
    child.stdout.on('data', (chunk) => {
      stdout += chunk
      if (stdout.length > MAX_OUTPUT) { child.kill(); finish(new Error('Claude Code returned too much output.')) }
    })
    child.stderr.on('data', (chunk) => { if (stderr.length < 4000) stderr += chunk })
    child.stdin.on('error', () => { /* the process may exit before reading the whole prompt */ })
    child.on('error', (error: NodeJS.ErrnoException) => {
      finish(error.code === 'ENOENT'
        ? new ClaudeUnavailableError('Claude Code is not installed on this machine. Install it, or set SURGE_PROVIDER=gemini.')
        : error)
    })
    child.on('close', (code) => {
      if (code === 0) finish(null, stdout)
      else finish(new Error(`Claude Code exited with code ${code}: ${stderr.trim().slice(0, 300)}`))
    })
    child.stdin.end(input)
  })
}
