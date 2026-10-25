// Stands in for the Codex CLI in tests. It reads the prompt from stdin, checks
// the flags Surge relies on, and writes the reply to the -o file. FAKE_CODEX_MODE
// picks the behaviour: ok, no-file, crash or hang.
import { readFileSync, writeFileSync } from 'node:fs'
import process from 'node:process'

let input = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => { input += chunk })
process.stdin.on('end', () => {
  const args = process.argv.slice(2)
  const flag = (name) => { const i = args.indexOf(name); return i < 0 ? undefined : args[i + 1] }
  const mode = process.env.FAKE_CODEX_MODE || 'ok'
  if (mode === 'hang') { setInterval(() => {}, 1000); return }
  if (mode === 'crash') { process.stderr.write('codex boom'); process.exit(2) }
  if (mode === 'no-file') { process.stdout.write('done'); return }
  const schema = JSON.parse(readFileSync(flag('--output-schema'), 'utf8'))
  const reply = {
    reply: 'Fake Codex answered. History: ' + input.includes('Earlier in this chat:'),
    actions: [],
    seen: {
      readOnly: flag('-s') === 'read-only',
      ephemeral: args.includes('--ephemeral'),
      schemaRequires: schema.required,
      model: flag('-m') ?? null,
      systemFirst: input.startsWith('You are Surge'),
    },
  }
  writeFileSync(flag('-o'), JSON.stringify(reply))
  process.stdout.write('ran')
})
