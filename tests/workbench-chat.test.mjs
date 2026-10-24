import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import test from 'node:test'

const source = readFileSync(new URL('../public/editor/chat.js', import.meta.url), 'utf8')
function setup(fetcher) {
  const input = { value: '', style: {}, addEventListener() {} }
  let board = { components: [], wires: [] }
  const messages = []
  const context = vm.createContext({
    document: { getElementById: () => input },
    App: { exportState: () => board, exportMarkdown: () => 'Empty board', state: { components: [] } },
    fetch: fetcher, console,
  })
  vm.runInContext(source, context)
  context.surgeAddMsg = (text, role) => messages.push({ text, role })
  context.surgeTyping = () => ({ remove() {} })
  return { context, messages, setBoard: (next) => { board = next } }
}

test('chat initializes after dynamic loading and prevents concurrent submissions', async () => {
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
  assert.ok(state.messages.some((message) => message.text === 'Ready.'))
  assert.equal(vm.runInContext('surgeRequestInProgress', state.context), false)
})

test('a board edit during generation discards the outdated proposal', async () => {
  let release, previews = 0
  const state = setup(async () => {
    await new Promise((resolve) => { release = resolve })
    return Response.json({ reply: 'New proposal.', actions: [{ tool: 'place_battery' }] })
  })
  state.context.surgePreviewActions = () => { previews++ }
  const pending = state.context.surgeAsk('Add a battery')
  state.setBoard({ components: [{ type: 'LED', id: 'led_0' }], wires: [] })
  release()
  await pending
  assert.equal(previews, 0)
  assert.ok(state.messages.some((message) => message.text.includes('board changed')))
})

test('component removal resolves per-type IDs and uses the editor deletion path', () => {
  const state = setup()
  const led = { type: 'led' }, battery = { type: 'battery' }
  state.context.App.state.components = [led, battery]
  let removed
  state.context.App.selectItem = (item) => { removed = item }
  state.context.App.deleteSelected = () => {}
  assert.equal(state.context.execRemoveComponent('battery_0'), true)
  assert.equal(removed, battery)
  assert.equal(state.context.execRemoveComponent('battery_7'), false)
})
