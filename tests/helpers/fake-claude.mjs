// Stands in for the Claude Code CLI in tests. It takes the prompt from stdin,
// records the flags Surge depends on, and prints a CLI-shaped result. The
// FAKE_CLAUDE_MODE variable picks the answer: ok, result-only, error, garbage,
// crash or hang.
import process from 'node:process'

let input = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => { input += chunk })
process.stdin.on('end', () => {
  const args = process.argv.slice(2)
  const flag = (name) => args[args.indexOf(name) + 1]
  const mode = process.env.FAKE_CLAUDE_MODE || 'ok'
  const seen = {
    model: flag('--model'),
    tools: flag('--tools'),
    hasSchema: args.includes('--json-schema') && JSON.parse(flag('--json-schema')).required.includes('actions'),
    systemPrompt: flag('--system-prompt'),
    promptLength: input.length,
    promptTail: input.slice(-120),
  }
  const reply = { reply: 'Fake Claude answered. History: ' + input.includes('Earlier in this chat:'), actions: [], seen }
  if (mode === 'hang') { setInterval(() => {}, 1000); return }
  if (mode === 'crash') { process.stderr.write('simulated crash'); process.exit(3) }
  if (mode === 'garbage') { process.stdout.write('not json at all'); return }
  if (mode === 'error') { process.stdout.write(JSON.stringify({ type: 'result', subtype: 'error_max_turns', is_error: true, result: '' })); return }
  if (mode === 'result-only') { process.stdout.write(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: JSON.stringify(reply) })); return }
  process.stdout.write(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: '', structured_output: reply }))
})
