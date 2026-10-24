import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import test from 'node:test'

const source = readFileSync(new URL('../public/editor/chat.js', import.meta.url), 'utf8')
function setup(fetcher) {
  const nodes = new Map()
  const element = () => ({ value: '', style: {}, children: [], classList: { add() {}, remove() {} },
    addEventListener() {}, setAttribute() {}, removeAttribute() {}, remove() {},
    appendChild(child) { this.children.push(child) }, querySelectorAll() { return [] },
    textContent: '', innerHTML: '', scrollHeight: 0, scrollTop: 0,
  })
  const get = (id) => { if (!nodes.has(id)) nodes.set(id, element()); return nodes.get(id) }
  let board = { components: [], wires: [] }
  const context = vm.createContext({
    document: { getElementById: get, createElement: element },
    App: { onReady: (callback) => callback(), exportBoard: () => board, exportMarkdown: () => 'Empty board', state: { components: [] } },
    BoardModel: {}, fetch: fetcher, console,
  })
  context.window = context
  vm.runInContext(source, context)
  return { context, nodes, get, setBoard: (next) => { board = next } }
}

test('modern chat initializes after dynamic loading and prevents concurrent submissions', async () => {
  let release, calls = 0
  const state = setup(async () => {
    calls++
    await new Promise((resolve) => { release = resolve })
    return Response.json({ reply: 'Ready.', actions: [] })
  })
  const first = state.context.surgeAsk('First request')
  await state.context.surgeAsk('Duplicate request')
  assert.equal(calls, 1)
  release()
  await first
  assert.ok(state.get('surge-messages').children.some((message) => message.innerHTML.includes('Ready.')))
})

test('a board edit during generation discards the outdated modern proposal', async () => {
  let release
  const state = setup(async () => {
    await new Promise((resolve) => { release = resolve })
    return Response.json({ reply: 'New proposal.', actions: [{ tool: 'place_battery' }] })
  })
  const pending = state.context.surgeAsk('Add a battery')
  state.setBoard({ components: [{ type: 'led', holes: ['a1', 'a3'] }], wires: [] })
  release()
  await pending
  assert.ok(state.get('surge-messages').children.some((message) => message.textContent.includes('board changed')))
  assert.ok(!state.get('surge-messages').children.some((message) => message.innerHTML.includes('New proposal.')))
})
